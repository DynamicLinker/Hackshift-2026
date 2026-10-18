"""Authentication & Session Router.

Provides Supabase Auth integration, dual-portal session logins, and test user management.
"""

from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.db.datastore import db
from app.services.git_analyzer import analyze_github_user
from app.services.supabase_service import supabase_service

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    role: Optional[str] = Field(None, description="'employer' or 'candidate'")
    identifier: Optional[str] = Field(None, description="company_id or github_username")
    email: Optional[str] = Field(None, description="Test user or Supabase email")
    password: Optional[str] = Field(None, description="Account password")
    name: Optional[str] = None


@router.get("/config")
def get_auth_config():
    """Returns Supabase client configuration and demo test users for the frontend."""
    return {
        "supabase_url": settings.supabase_url,
        "supabase_anon_key": settings.supabase_anon_key,
        "is_supabase_enabled": settings.is_supabase_enabled,
        "test_users": supabase_service.get_test_users(),
    }


@router.post("/login")
async def login(payload: LoginRequest):
    """Authenticates a portal session via Supabase, test user credentials, or direct role persona."""
    # 1. Email + Password Flow (Supabase & Test User Authentication)
    if payload.email and payload.password:
        auth_user = await supabase_service.authenticate_user(payload.email, payload.password)
        if not auth_user:
            raise HTTPException(status_code=401, detail="Invalid email or password.")

        role = auth_user["role"]
        if role == "employer":
            company_id = auth_user.get("company_id") or "comp-acme"
            company = db.get_company(company_id) or db.get_company("comp-acme")
            return {
                "status": "authenticated",
                "role": "employer",
                "auth_source": auth_user.get("auth_source", "test_user_credential"),
                "email": auth_user["email"],
                "company_id": company.id,
                "company_name": company.name,
                "user_name": auth_user.get("display_name") or f"{company.name} Hiring Team",
                "popularity_score": company.popularity_score,
                "is_verified_responsive": company.is_verified_responsive,
                "total_openings": len([j for j in db.list_jobs() if j.company_id == company.id]),
            }
        else:
            raw_input = (payload.identifier or "").strip()
            if not raw_input:
                raw_input = auth_user.get("github_username") or "iiitd-dev"

            is_repo_url = "/" in raw_input or raw_input.startswith("http")
            if is_repo_url:
                repo_url = raw_input
                parts = raw_input.rstrip("/").split("/")
                clean_user = parts[-2] if len(parts) >= 2 and parts[-2] not in ["github.com", "http:", "https:"] else "developer"
            else:
                repo_url = None
                clean_user = raw_input.lstrip("@")

            candidate = await analyze_github_user(clean_user, repo_url=repo_url)
            db.save_candidate(candidate)

            return {
                "status": "authenticated",
                "role": "candidate",
                "auth_source": auth_user.get("auth_source", "test_user_credential"),
                "email": auth_user["email"],
                "candidate_id": candidate.id,
                "github_username": candidate.github_username,
                "audit_target": raw_input,
                "repo_url": repo_url,
                "full_name": auth_user.get("display_name") or candidate.full_name,
                "avatar_url": candidate.avatar_url,
                "git_provenance_score": candidate.git_provenance_score,
                "commit_topology_status": candidate.commit_topology_status,
                "fast_track_qualified": candidate.fast_track_qualified,
                "audited_repos_count": len(candidate.audited_repos),
            }

    # 2. Direct Role/Identifier Flow (For URL shortcuts ?role=employer and quick testing)
    if not payload.role or not payload.identifier:
        raise HTTPException(status_code=400, detail="Must provide either email/password or role/identifier.")

    role = payload.role.lower().strip()
    identifier = payload.identifier.strip()

    if role == "employer":
        comp_id = identifier.lstrip("@")
        company = db.get_company(comp_id) or db.get_company("comp-acme")
        if not company:
            raise HTTPException(status_code=404, detail=f"Company '{comp_id}' not found.")
        return {
            "status": "authenticated",
            "role": "employer",
            "company_id": company.id,
            "company_name": company.name,
            "user_name": payload.name or f"{company.name} Hiring Team",
            "popularity_score": company.popularity_score,
            "is_verified_responsive": company.is_verified_responsive,
            "total_openings": len([j for j in db.list_jobs() if j.company_id == company.id]),
        }

    elif role == "candidate":
        raw_input = identifier
        is_repo_url = "/" in raw_input or raw_input.startswith("http")
        if is_repo_url:
            repo_url = raw_input
            parts = raw_input.rstrip("/").split("/")
            clean_user = parts[-2] if len(parts) >= 2 and parts[-2] not in ["github.com", "http:", "https:"] else "developer"
        else:
            repo_url = None
            clean_user = raw_input.lstrip("@")

        candidate = await analyze_github_user(clean_user, repo_url=repo_url)
        db.save_candidate(candidate)

        return {
            "status": "authenticated",
            "role": "candidate",
            "candidate_id": candidate.id,
            "github_username": candidate.github_username,
            "audit_target": raw_input,
            "repo_url": repo_url,
            "full_name": candidate.full_name,
            "avatar_url": candidate.avatar_url,
            "git_provenance_score": candidate.git_provenance_score,
            "commit_topology_status": candidate.commit_topology_status,
            "fast_track_qualified": candidate.fast_track_qualified,
            "audited_repos_count": len(candidate.audited_repos),
        }

    else:
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'employer' or 'candidate'.")


@router.get("/session")
def get_session_options():
    """Returns available demo personas, test users, and companies for instantaneous login selection."""
    companies = [
        {
            "id": c.id,
            "name": c.name,
            "popularity_score": c.popularity_score,
            "is_verified_responsive": c.is_verified_responsive,
        }
        for c in db.companies.values()
    ]
    candidates = [
        {
            "username": "iiitd-dev",
            "full_name": "Aarav Sharma",
            "tag": "Verified Developer (IIIT Delhi)",
            "status": "verified_human",
        },
        {
            "username": "ai-spammer",
            "full_name": "Benchmark Profile",
            "tag": "Flagged Bulk Dump (Synthetic Ingestion)",
            "status": "flagged_bulk_dump",
        },
    ]
    return {
        "companies": companies,
        "candidates": candidates,
        "test_users": supabase_service.get_test_users(),
    }
