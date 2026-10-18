"""Supabase Integration Service.

Provides seamless connectivity to Supabase Auth (GoTrue), PostgreSQL (PostgREST),
and Realtime synchronization with offline fallback for local hackathon demo execution.
"""

import logging
from typing import Optional, Dict, Any, List
import httpx

from app.config import settings
from app.db.datastore import db

logger = logging.getLogger("proofhired.supabase")

# Pre-seeded test users for Company and Candidate
TEST_USERS = {
    "recruiter@acmesystems.io": {
        "email": "recruiter@acmesystems.io",
        "password": "Password123!",
        "role": "employer",
        "company_id": "comp-acme",
        "company_name": "Acme Systems",
        "display_name": "Sarah Jenkins",
        "title": "Lead Technical Recruiter",
    },
    "aarav@iiitd.ac.in": {
        "email": "aarav@iiitd.ac.in",
        "password": "Password123!",
        "role": "candidate",
        "candidate_id": "cand_iiitd-dev",
        "github_username": "iiitd-dev",
        "display_name": "Aarav Sharma",
        "title": "Verified Developer (IIIT Delhi)",
    },
}


class SupabaseService:
    def __init__(self):
        self.url = settings.supabase_url.rstrip("/")
        self.anon_key = settings.supabase_anon_key
        self.service_key = settings.supabase_service_role_key or self.anon_key
        self.enabled = settings.is_supabase_enabled

    def _headers(self, use_service_key: bool = False) -> Dict[str, str]:
        key = self.service_key if use_service_key else self.anon_key
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    async def authenticate_user(
        self, email: str, password: str
    ) -> Optional[Dict[str, Any]]:
        """Authenticates user via Supabase Auth or test user credentials."""
        clean_email = email.strip().lower()

        # 1. Check pre-seeded test users first (fast path for live demo & offline testing)
        if clean_email in TEST_USERS:
            user = TEST_USERS[clean_email]
            if password == user["password"]:
                return {
                    "status": "authenticated",
                    "auth_source": "test_user_credential",
                    "role": user["role"],
                    "email": user["email"],
                    "display_name": user["display_name"],
                    "company_id": user.get("company_id"),
                    "company_name": user.get("company_name"),
                    "github_username": user.get("github_username"),
                    "candidate_id": user.get("candidate_id"),
                    "title": user.get("title"),
                }

        # 2. If Supabase is configured, authenticate with Supabase GoTrue Auth
        if self.enabled:
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    res = await client.post(
                        f"{self.url}/auth/v1/token?grant_type=password",
                        headers=self._headers(),
                        json={"email": clean_email, "password": password},
                    )
                    if res.status_code == 200:
                        data = res.json()
                        user_meta = data.get("user", {}).get("user_metadata", {})
                        role = user_meta.get("role", "candidate")
                        return {
                            "status": "authenticated",
                            "auth_source": "supabase_auth",
                            "access_token": data.get("access_token"),
                            "role": role,
                            "email": clean_email,
                            "display_name": user_meta.get("display_name", clean_email.split("@")[0]),
                            "company_id": user_meta.get("company_id", "comp-acme"),
                            "github_username": user_meta.get("github_username", "iiitd-dev"),
                        }
            except Exception as e:
                logger.warning(f"Supabase auth attempt failed: {e}. Falling back.")

        return None

    def get_test_users(self) -> List[Dict[str, Any]]:
        """Returns the available test user credentials for 1-click login."""
        return [
            {
                "email": u["email"],
                "password": u["password"],
                "role": u["role"],
                "display_name": u["display_name"],
                "badge": "Company Recruiter" if u["role"] == "employer" else "Developer Candidate",
                "entity": u.get("company_name") or f"@{u.get('github_username')}",
            }
            for u in TEST_USERS.values()
        ]


supabase_service = SupabaseService()
