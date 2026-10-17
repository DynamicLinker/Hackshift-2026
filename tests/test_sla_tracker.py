from datetime import datetime, timezone, timedelta
import pytest
from app.db.datastore import DataStore
from app.models import Company, Job, Application
from app.services.sla_tracker import (
    calculate_sla_status,
    process_disposition,
    audit_company_reputation,
)

def test_calculate_sla_status_tiers():
    now = datetime.now(timezone.utc)
    sub = now - timedelta(hours=24)
    deadline = now + timedelta(hours=48)
    
    # 48 hours left -> Within SLA
    res1 = calculate_sla_status(sub.isoformat(), deadline.isoformat(), now.isoformat())
    assert res1["status"] == "within_sla"
    assert res1["badge_color"] == "emerald"
    assert res1["remaining_hours"] == 48.0
    assert res1["is_breached"] is False

    # 10 hours left -> Urgent
    sub_urgent = now - timedelta(hours=62)
    deadline_urgent = now + timedelta(hours=10)
    res2 = calculate_sla_status(sub_urgent.isoformat(), deadline_urgent.isoformat(), now.isoformat())
    assert res2["status"] == "sla_urgent"
    assert res2["badge_color"] == "amber"
    assert res2["remaining_hours"] == 10.0

    # Overdue by 4 hours -> Breached
    sub_breached = now - timedelta(hours=76)
    deadline_breached = now - timedelta(hours=4)
    res3 = calculate_sla_status(sub_breached.isoformat(), deadline_breached.isoformat(), now.isoformat())
    assert res3["status"] == "sla_breached"
    assert res3["badge_color"] == "rose"
    assert res3["is_breached"] is True
    assert res3["overdue_hours"] == 4.0

def test_process_disposition_interview():
    ds = DataStore()
    app = ds.get_application("app-1")
    assert app is not None
    assert app.status == "pending"

    res = process_disposition(
        app_id="app-1",
        action="schedule_interview",
        interview_time="Tomorrow at 2:00 PM IST",
        db_instance=ds,
    )
    assert res["success"] is True
    assert res["new_status"] == "interview_scheduled"
    assert res["interview_time"] == "Tomorrow at 2:00 PM IST"
    
    updated_app = ds.get_application("app-1")
    assert updated_app.status == "interview_scheduled"

def test_process_disposition_rejection_with_feedback():
    ds = DataStore()
    res = process_disposition(
        app_id="app-2",
        action="reject_with_feedback",
        note="Candidate needs more depth in distributed caching architectures.",
        db_instance=ds,
    )
    assert res["success"] is True
    assert res["new_status"] == "rejected_with_feedback"
    
    app2 = ds.get_application("app-2")
    assert app2.disposition_note == "Candidate needs more depth in distributed caching architectures."

def test_audit_company_reputation():
    ds = DataStore()
    company = ds.get_company("comp-acme")
    assert company is not None
    
    audit = audit_company_reputation("comp-acme", db_instance=ds)
    assert audit["company_name"] == "Acme Systems"
    assert audit["response_rate"] >= 85.0
    assert audit["is_verified_responsive"] is True
