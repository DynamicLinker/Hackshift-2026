"""Candidate Experience Router.

Handles zero-resume GitHub provenance audit, dynamic 5-minute micro-assessment
challenge generation, and automated promotion to the Fast-Track Queue upon passing.
"""

from datetime import datetime, timezone, timedelta
import uuid
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from app.db.datastore import db
from app.models import CandidateProfile, AssessmentChallenge, AssessmentSubmission, Application
from app.services.git_analyzer import analyze_github_user
from app.services.assessment_engine import generate_challenge, evaluate_submission

router = APIRouter(prefix="/api/candidate", tags=["Candidate"])


class AuditRequest(BaseModel):
    github_username: str = Field(..., description="GitHub username without @ prefix")


class StartAssessmentRequest(BaseModel):
    candidate_id: str
    job_id: str


class SubmitAssessmentRequest(BaseModel):
    challenge_id: str
    self_repo_explanation: str
    fixed_code: str


@router.post("/audit", response_model=CandidateProfile)
async def audit_candidate_github(payload: AuditRequest):
    """Audits repository commit topology, history, and tech stack provenance."""
    username = payload.github_username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="GitHub username is required.")

    profile = await analyze_github_user(username)
    db.save_candidate(profile)
    return profile


@router.get("/{candidate_id}", response_model=CandidateProfile)
def get_candidate_profile(candidate_id: str):
    """Retrieves an audited candidate profile."""
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail=f"Candidate {candidate_id} not found.")
    return candidate


@router.post("/assessment/start", response_model=AssessmentChallenge)
def start_assessment_challenge(payload: StartAssessmentRequest):
    """Generates a dynamic 5-minute micro-assessment for the candidate."""
    candidate = db.get_candidate(payload.candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    job = db.get_job(payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Target job opening not found.")

    challenge = generate_challenge(candidate, job)
    db.save_assessment(challenge)
    return challenge


@router.post("/assessment/submit")
def submit_assessment_challenge(payload: SubmitAssessmentRequest):
    """Evaluates the 5-minute challenge and vaults the candidate into the Fast-Track Queue."""
    challenge = db.get_assessment(payload.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Assessment session not found.")

    if challenge.completed:
        raise HTTPException(status_code=400, detail="This assessment has already been submitted.")

    candidate = db.get_candidate(challenge.candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate profile not found.")

    submission = AssessmentSubmission(
        challenge_id=payload.challenge_id,
        self_repo_explanation=payload.self_repo_explanation,
        fixed_code=payload.fixed_code,
    )

    now = datetime.now(timezone.utc)
    eval_result = evaluate_submission(challenge, submission, now.isoformat())
    db.save_assessment(challenge)

    application_data = None
    if eval_result["passed"]:
        # Candidate passed! Create Fast-Track application with 72h SLA
        candidate.fast_track_qualified = True
        db.save_candidate(candidate)

        app_id = f"app-{uuid.uuid4().hex[:8]}"
        composite = round((candidate.git_provenance_score * 0.4) + (eval_result["score"] * 0.6), 1)
        
        application = Application(
            id=app_id,
            job_id=challenge.job_id,
            candidate_id=candidate.id,
            candidate_name=candidate.full_name,
            github_username=candidate.github_username,
            queue_type="fast_track",
            composite_score=composite,
            submitted_at=now.isoformat(),
            sla_deadline=(now + timedelta(hours=72)).isoformat(),
            status="pending",
        )
        db.save_application(application)
        
        application_data = {
            "application_id": application.id,
            "queue_type": "fast_track",
            "composite_score": composite,
            "sla_deadline": application.sla_deadline,
            "fast_track_rank": 1,
            "message": "Passed! Vaulted directly to #1 on the employer's Fast-Track Queue.",
        }

    return {
        "evaluation": eval_result,
        "application": application_data,
    }
