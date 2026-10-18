"""Authentication & Session Router.

Provides fast dual-portal session logins for Candidate and Employer roles.
"""

from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.datastore import db
from app.services.git_analyzer import analyze_github_user

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    role: str = Field(..., description="'employer' or 'candidate'")
    identifier: str = Field(..., description="company_id or github_username")
    name: Optional[str] = None


@router.post("/login")
async def login(payload: LoginRequest):
    """Authenticates a portal session for Candidate or Employer."""
    role = payload.role.lower().strip()
    identifier = payload.identifier.strip().lstrip("@")

    if role == "employer":
        company = db.get_company(identifier) or db.get_company("comp-acme")
        if not company:
            raise HTTPException(status_code=404, detail=f"Company '{identifier}' not found.")
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
        candidate = db.get_candidate(f"cand_{identifier}") or db.get_candidate(identifier)
        if not candidate or not candidate.topology_graph:
            candidate = await analyze_github_user(identifier)
            db.save_candidate(candidate)

        return {
            "status": "authenticated",
            "role": "candidate",
            "candidate_id": candidate.id,
            "github_username": candidate.github_username,
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
    """Returns available demo personas and companies for instantaneous login selection."""
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
            "full_name": "AutoCoder 9000",
            "tag": "Flagged AI Bot (Bulk Dump)",
            "status": "flagged_bulk_dump",
        },
    ]
    return {
        "companies": companies,
        "candidates": candidates,
    }
