"""Anti-Ghosting 72-Hour SLA Tracker.

Manages application SLAs, tracks review turnarounds, awards the "Verified Responsive"
badge, and penalizes administrative silence while encouraging fast candidate disposition.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
from app.models import Application, Company
from app.db.datastore import db as default_db


def calculate_sla_status(
    submitted_at_iso: str,
    sla_deadline_iso: str,
    current_time_iso: Optional[str] = None
) -> Dict[str, Any]:
    """Calculates remaining hours, percentage, and alert badge status against 72h SLA."""
    now = datetime.fromisoformat(current_time_iso) if current_time_iso else datetime.now(timezone.utc)
    sub_dt = datetime.fromisoformat(submitted_at_iso)
    deadline_dt = datetime.fromisoformat(sla_deadline_iso)

    total_window_seconds = max((deadline_dt - sub_dt).total_seconds(), 1.0)
    remaining_seconds = (deadline_dt - now).total_seconds()
    remaining_hours = round(remaining_seconds / 3600.0, 1)

    if remaining_seconds <= 0:
        overdue_hours = round(abs(remaining_seconds) / 3600.0, 1)
        return {
            "status": "sla_breached",
            "is_breached": True,
            "badge_color": "rose",
            "badge_label": f"SLA Breached ({overdue_hours}h overdue)",
            "remaining_hours": 0.0,
            "overdue_hours": overdue_hours,
            "percent_remaining": 0.0,
        }
    elif remaining_hours <= 24.0:
        pct = max(0.0, min(100.0, (remaining_seconds / total_window_seconds) * 100.0))
        return {
            "status": "sla_urgent",
            "is_breached": False,
            "badge_color": "amber",
            "badge_label": f"Action Required ({remaining_hours}h left)",
            "remaining_hours": remaining_hours,
            "overdue_hours": 0.0,
            "percent_remaining": round(pct, 1),
        }
    else:
        pct = max(0.0, min(100.0, (remaining_seconds / total_window_seconds) * 100.0))
        return {
            "status": "within_sla",
            "is_breached": False,
            "badge_color": "emerald",
            "badge_label": f"Within SLA ({remaining_hours}h left)",
            "remaining_hours": remaining_hours,
            "overdue_hours": 0.0,
            "percent_remaining": round(pct, 1),
        }


def process_disposition(
    app_id: str,
    action: str,  # "schedule_interview" or "reject_with_feedback"
    note: Optional[str] = None,
    interview_time: Optional[str] = None,
    db_instance = None
) -> Dict[str, Any]:
    """Processes candidate disposition (Interview / Rejection with constructive note).
    
    Rewards swift turnaround. Note: Rejecting with feedback does NOT penalize
    company rating; only silence/ghosting past 72h incurs penalties.
    """
    datastore = db_instance or default_db
    application = datastore.get_application(app_id)
    if not application:
        raise ValueError(f"Application {app_id} not found")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    sla_info = calculate_sla_status(application.submitted_at, application.sla_deadline, now_iso)

    if action == "schedule_interview":
        application.status = "interview_scheduled"
        application.disposition_at = now_iso
        application.disposition_note = note or "Invited for 48-hour direct engineering round."
        application.interview_time = interview_time or (now + timedelta(days=2)).strftime("%A at 3:00 PM IST")
    elif action == "reject_with_feedback":
        application.status = "rejected_with_feedback"
        application.disposition_at = now_iso
        application.disposition_note = note or "Constructive feedback: Strengthen concurrency control."
    else:
        raise ValueError(f"Unknown action: {action}. Use 'schedule_interview' or 'reject_with_feedback'.")

    datastore.save_application(application)

    # Update company reputation metrics
    job = datastore.get_job(application.job_id)
    if job:
        company = datastore.get_company(job.company_id)
        if company:
            if not sla_info["is_breached"]:
                # Fast response bonus
                company.popularity_score = min(100.0, round(company.popularity_score + 0.3, 1))
                company.response_rate = min(100.0, round(company.response_rate + 0.2, 1))
            else:
                # Breached SLA penalty
                company.popularity_score = max(50.0, round(company.popularity_score - 2.5, 1))
                company.response_rate = max(50.0, round(company.response_rate - 3.0, 1))
            company.is_verified_responsive = company.response_rate >= 85.0

    return {
        "success": True,
        "application_id": app_id,
        "new_status": application.status,
        "disposition_note": application.disposition_note,
        "interview_time": application.interview_time,
        "sla_met": not sla_info["is_breached"],
    }


def audit_company_reputation(company_id: str, db_instance = None) -> Dict[str, Any]:
    """Audits company's overall responsiveness across all active candidate queues."""
    datastore = db_instance or default_db
    company = datastore.get_company(company_id)
    if not company:
        raise ValueError(f"Company {company_id} not found")

    company_jobs = [j for j in datastore.list_jobs() if j.company_id == company_id]
    total_apps = 0
    resolved_apps = 0
    breached_apps = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for job in company_jobs:
        apps = datastore.list_applications_for_job(job.id)
        total_apps += len(apps)
        for a in apps:
            if a.status in ["interview_scheduled", "rejected_with_feedback"]:
                resolved_apps += 1
            else:
                sla = calculate_sla_status(a.submitted_at, a.sla_deadline, now_iso)
                if sla["is_breached"]:
                    breached_apps += 1

    if total_apps > 0:
        effective_rate = round(((total_apps - breached_apps) / total_apps) * 100.0, 1)
    else:
        effective_rate = 98.0

    company.response_rate = effective_rate
    company.is_verified_responsive = effective_rate >= 85.0 and breached_apps <= 1
    if breached_apps > 0:
        company.popularity_score = max(50.0, round(98.0 - (breached_apps * 3.5), 1))

    return {
        "company_id": company.id,
        "company_name": company.name,
        "popularity_score": company.popularity_score,
        "response_rate": company.response_rate,
        "is_verified_responsive": company.is_verified_responsive,
        "total_applications": total_apps,
        "active_breaches": breached_apps,
    }
