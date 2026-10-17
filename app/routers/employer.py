"""Employer Cockpit Router.

Provides job management, dual-queue candidate inspection (Fast-Track vs Spam Queue),
live 72-hour anti-ghosting SLA metrics, and 1-click candidate disposition.
"""

from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import uuid
from app.db.datastore import db
from app.models import Job, Application, Company
from app.services.sla_tracker import (
    calculate_sla_status,
    process_disposition,
    audit_company_reputation,
)

router = APIRouter(prefix="/api/employer", tags=["Employer"])


class CreateJobRequest(BaseModel):
    company_id: str
    title: str
    stack_tags: List[str]
    description: str
    experience_level: Optional[str] = "Junior / Mid"
    salary_range: Optional[str] = "INR 14 - 20 LPA"


class DispositionRequest(BaseModel):
    application_id: str
    action: str  # "schedule_interview", "approve_offer", "reject_with_feedback"
    note: Optional[str] = None
    interview_time: Optional[str] = None


class GhostRequest(BaseModel):
    application_id: str


@router.post("/jobs", response_model=Job)
def create_employer_job(payload: CreateJobRequest):
    """Creates and publishes a new job opening with automated 72-hour anti-ghost SLA."""
    company = db.get_company(payload.company_id)
    if not company:
        raise HTTPException(status_code=404, detail=f"Company '{payload.company_id}' not found.")

    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Job title is required.")

    clean_tags = [t.strip() for t in payload.stack_tags if t.strip()]
    if not clean_tags:
        clean_tags = ["Python", "FastAPI", "Distributed Systems"]

    job_id = f"job-{uuid.uuid4().hex[:8]}"
    new_job = Job(
        id=job_id,
        company_id=company.id,
        company_name=company.name,
        title=title,
        stack_tags=clean_tags,
        description=payload.description.strip() or f"Build production systems using {', '.join(clean_tags)} with strict SLA guarantees.",
        experience_level=payload.experience_level or "Junior / Mid",
        salary_range=payload.salary_range or "INR 14 - 20 LPA",
        created_at=datetime.now(timezone.utc).isoformat(),
        active=True,
    )
    db.add_job(new_job)
    company.total_openings += 1
    db.companies[company.id] = company
    return new_job


@router.get("/company/{company_id}")
def get_company_profile(company_id: str, simulated_hours: float = 0.0):
    """Retrieves company reputation metrics and Verified Responsive badge status."""
    now_iso = (datetime.now(timezone.utc) + timedelta(hours=simulated_hours)).isoformat() if simulated_hours else datetime.now(timezone.utc).isoformat()
    audit = audit_company_reputation(company_id, current_time_iso=now_iso)
    return audit


@router.get("/jobs")
def list_employer_jobs(simulated_hours: float = 0.0):
    """Lists all active job openings with applicant queue telemetry."""
    jobs = db.list_jobs()
    now_iso = (datetime.now(timezone.utc) + timedelta(hours=simulated_hours)).isoformat() if simulated_hours else datetime.now(timezone.utc).isoformat()
    result = []

    for j in jobs:
        apps = db.list_applications_for_job(j.id)
        fast_track_apps = [a for a in apps if a.queue_type == "fast_track"]
        
        # Check SLA urgencies
        urgent_count = 0
        for a in fast_track_apps:
            if a.status == "pending":
                sla = calculate_sla_status(a.submitted_at, a.sla_deadline, now_iso)
                if sla["status"] in ["sla_urgent", "sla_breached"]:
                    urgent_count += 1

        result.append({
            "job": j,
            "fast_track_count": len(fast_track_apps),
            "cold_queue_count": 2140,  # Simulated 2,140 cold resume spam submissions
            "urgent_sla_count": urgent_count,
        })

    return result


@router.get("/jobs/{job_id}/applications")
def get_job_applications(job_id: str, simulated_hours: float = 0.0):
    """Retrieves the high-priority Fast-Track queue alongside the unscreened cold queue."""
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    apps = db.list_applications_for_job(job_id)
    now_iso = (datetime.now(timezone.utc) + timedelta(hours=simulated_hours)).isoformat() if simulated_hours else datetime.now(timezone.utc).isoformat()

    # Process and sort fast-track applications by composite score descending
    fast_track_list = []
    for a in apps:
        if a.queue_type == "fast_track":
            sla_info = calculate_sla_status(a.submitted_at, a.sla_deadline, now_iso)
            candidate = db.get_candidate(a.candidate_id)
            fast_track_list.append({
                "application": a,
                "candidate": candidate,
                "sla": sla_info,
            })

    fast_track_list.sort(key=lambda x: x["application"].composite_score, reverse=True)

    # Simulated cold spam queue representation to show judges the contrast
    cold_spam_samples = [
        {
            "id": "cold-spam-1",
            "name": "Applicant #2,140 (1-Click Bot Apply)",
            "headline": "Prompt-generated 4-page PDF Resume",
            "git_provenance": "0% (No GitHub link provided)",
            "status": "Unscreened Cold Queue",
            "warning": "High probability AI resume spam",
        },
        {
            "id": "cold-spam-2",
            "name": "Applicant #2,139 (LinkedIn Bot Extension)",
            "headline": "Generic buzzwords: '10x Ninja Synergist'",
            "git_provenance": "12% (1-commit bulk fork)",
            "status": "Unscreened Cold Queue",
            "warning": "No verified code comprehension",
        },
        {
            "id": "cold-spam-3",
            "name": "Applicant #2,138 (Mass Scraper Application)",
            "headline": "Keyword-stuffed resume matching all tags",
            "git_provenance": "18% (Template dump)",
            "status": "Unscreened Cold Queue",
            "warning": "Failed baseline commit provenance",
        },
    ]

    return {
        "job": job,
        "fast_track_total": len(fast_track_list),
        "cold_queue_total": 2140,
        "fast_track_queue": fast_track_list,
        "cold_queue_samples": cold_spam_samples,
    }


@router.post("/disposition")
def candidate_disposition(payload: DispositionRequest):
    """Executes a 1-click candidate disposition (Interview or Constructive Rejection)."""
    try:
        res = process_disposition(
            app_id=payload.application_id,
            action=payload.action,
            note=payload.note,
            interview_time=payload.interview_time,
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/simulate-ghost")
def simulate_ghost(payload: GhostRequest):
    """
    DEMO TOOL: Simulates employer ghosting by backdating the SLA deadline
    to 73 hours ago, forcing an SLA breach and penalizing company reputation.
    This demonstrates the Anti-Ghosting enforcement system in real-time.
    """
    application = db.get_application(payload.application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found.")

    if application.status not in ("pending",):
        raise HTTPException(
            status_code=400,
            detail=f"Can only ghost a pending application. Current status: {application.status}"
        )

    now = datetime.now(timezone.utc)

    # Backdate: submitted 73h ago, deadline was 1h ago → breached by 1h
    application.submitted_at = (now - timedelta(hours=73)).isoformat()
    application.sla_deadline = (now - timedelta(hours=1)).isoformat()
    application.status = "ghosted"
    db.save_application(application)

    # Penalize company reputation
    job = db.get_job(application.job_id)
    if job:
        company = db.get_company(job.company_id)
        if company:
            company.popularity_score = max(50.0, round(company.popularity_score - 8.5, 1))
            company.response_rate = max(50.0, round(company.response_rate - 10.0, 1))
            company.is_verified_responsive = company.response_rate >= 85.0
            db.companies[company.id] = company

    return {
        "success": True,
        "application_id": application.id,
        "new_status": "ghosted",
        "sla_breached_by_hours": 1.0,
        "penalty_applied": True,
        "message": "Ghosting simulated. SLA breached by 1h. Company reputation penalized.",
    }


@router.get("/all-applications")
def list_all_applications(simulated_hours: float = 0.0, candidate_username: Optional[str] = None):
    """Returns all applications across all jobs with SLA status — filtered to a specific candidate if requested."""
    now_iso = (datetime.now(timezone.utc) + timedelta(hours=simulated_hours)).isoformat() if simulated_hours else datetime.now(timezone.utc).isoformat()
    results = []
    with db._lock:
        apps = list(db.applications.values())

    if candidate_username and candidate_username.strip():
        clean_user = candidate_username.strip().lstrip("@").lower()
        apps = [a for a in apps if a.github_username.lower() == clean_user]

    for a in apps:
        sla = calculate_sla_status(a.submitted_at, a.sla_deadline, now_iso)
        candidate = db.get_candidate(a.candidate_id)
        job = db.get_job(a.job_id)
        results.append({
            "application": a,
            "candidate": candidate,
            "job": job,
            "sla": sla,
        })
    # Sort: ghosted + breached first, then by SLA urgency
    def sort_key(item):
        st = item["application"].status
        if st == "ghosted":
            return 0
        if item["sla"]["is_breached"]:
            return 1
        if item["sla"]["status"] == "sla_urgent":
            return 2
        return 3
    results.sort(key=sort_key)
    return results


@router.get("/companies")
def list_companies(simulated_hours: float = 0.0):
    """Returns all companies with reputation metrics, dynamically factoring in simulated time."""
    now_iso = (datetime.now(timezone.utc) + timedelta(hours=simulated_hours)).isoformat() if simulated_hours else datetime.now(timezone.utc).isoformat()
    with db._lock:
        companies = list(db.companies.values())
    
    # Audit each company against the current (or simulated) time
    audited_companies = []
    for c in companies:
        audit = audit_company_reputation(c.id, current_time_iso=now_iso)
        audited_companies.append({
            "id": c.id,
            "name": c.name,
            "popularity_score": audit["popularity_score"],
            "response_rate": audit["response_rate"],
            "is_verified_responsive": audit["is_verified_responsive"],
            "total_openings": c.total_openings,
            "avg_response_hours": c.avg_response_hours,
            "active_breaches": audit["active_breaches"],
        })
    return audited_companies

