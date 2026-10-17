import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db.datastore import db
from app.models import Job
from app.services.assessment_engine import generate_challenge
from app.services.sla_tracker import process_disposition, audit_company_reputation

client = TestClient(app)


def test_employer_post_new_job_api():
    payload = {
        "company_id": "comp-acme",
        "title": "Senior Distributed Systems Engineer (Rust / Go)",
        "stack_tags": ["Rust", "Go", "Distributed Systems", "WebSockets"],
        "experience_level": "Mid / Senior",
        "salary_range": "INR 20 - 30 LPA",
        "description": "Architect high-throughput streaming pipelines and prevent cascading network retry storms.",
    }
    resp = client.post("/api/employer/jobs", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Senior Distributed Systems Engineer (Rust / Go)"
    assert data["company_id"] == "comp-acme"
    assert "Rust" in data["stack_tags"]
    assert "Distributed Systems" in data["stack_tags"]
    assert data["active"] is True

    # Verify datastore has the job
    job = db.get_job(data["id"])
    assert job is not None
    assert job.title == payload["title"]

    # Verify company total_openings was incremented
    company = db.get_company("comp-acme")
    assert company.total_openings >= 3


def test_dynamically_posted_job_assessment_generation():
    # Post a new job requiring distributed resilience
    job = Job(
        id="job-custom-sre",
        company_id="comp-nova",
        company_name="Nova Labs",
        title="Staff SRE (Retry Storms & Backoff)",
        stack_tags=["Distributed Systems", "AWS", "CI/CD"],
        description="Mitigate network retry storms and enforce backpressure under load.",
    )
    db.add_job(job)
    candidate = db.get_candidate("cand_iiitd-dev")
    assert candidate is not None

    challenge = generate_challenge(candidate, job)
    assert challenge.job_id == job.id
    assert "network" in challenge.id.lower() or "retry" in challenge.bug_fix_title.lower()
    assert "Nova Labs" in challenge.self_repo_prompt
    assert "Staff SRE" in challenge.self_repo_prompt


def test_approve_offer_disposition_flow():
    # Aarav Sharma's application app-1 is currently pending
    res = process_disposition(
        app_id="app-1",
        action="approve_offer",
        note="Approved! Outstanding performance on FastAPI concurrency micro-assessment.",
        db_instance=db,
    )
    assert res["success"] is True
    assert res["new_status"] == "approved_offer"
    assert "Approved!" in res["disposition_note"]

    # Verify datastore state
    app1 = db.get_application("app-1")
    assert app1.status == "approved_offer"

    # Verify company audit considers approved_offer as resolved (not pending/breached)
    audit = audit_company_reputation("comp-acme", db_instance=db)
    assert audit["response_rate"] >= 85.0


def test_candidate_ownership_verification_status():
    # 1. Verified human developer
    resp_legit = client.post("/api/candidate/audit", json={"github_username": "iiitd-dev"})
    assert resp_legit.status_code == 200
    legit_data = resp_legit.json()
    assert legit_data["ownership_status"] == "verified_contributor"
    assert legit_data["author_match_rate"] == 100.0

    # 2. Flagged AI bulk dump profile
    resp_bot = client.post("/api/candidate/audit", json={"github_username": "ai-spammer"})
    assert resp_bot.status_code == 200
    bot_data = resp_bot.json()
    assert "unverified" in bot_data["ownership_status"].lower()
    assert bot_data["author_match_rate"] < 50.0
