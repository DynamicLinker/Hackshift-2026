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


def test_employer_post_job_candidate_match_and_apply_flow():
    # 1. Employer submits a new job opening in the Employer Cockpit
    job_payload = {
        "company_id": "comp-acme",
        "title": "Real-Time Distributed Streaming Architect",
        "stack_tags": ["Go", "Distributed Systems", "gRPC", "WebSockets"],
        "experience_level": "Senior",
        "salary_range": "INR 24 - 36 LPA",
        "description": "Design zero-packet-drop streaming ingestion pipelines with exponential backoff resilience.",
    }
    resp = client.post("/api/employer/jobs", json=job_payload)
    assert resp.status_code == 200
    new_job = resp.json()
    job_id = new_job["id"]
    assert new_job["title"] == job_payload["title"]
    assert "Go" in new_job["stack_tags"]

    # 2. Candidate side lists jobs - newly submitted job is at index 0 (newest first)
    list_resp = client.get("/api/employer/jobs")
    assert list_resp.status_code == 200
    jobs_data = list_resp.json()
    assert len(jobs_data) >= 1
    assert jobs_data[0]["job"]["id"] == job_id

    # 3. Candidate audits their GitHub
    audit_resp = client.post("/api/candidate/audit", json={"github_username": "iiitd-dev"})
    assert audit_resp.status_code == 200
    candidate = audit_resp.json()
    assert candidate["commit_topology_status"] == "verified_human"
    assert candidate["fast_track_qualified"] is True

    # 4. Candidate takes the 5-minute micro-assessment tailored to this new role
    start_resp = client.post(
        "/api/candidate/assessment/start",
        json={"candidate_id": candidate["id"], "job_id": job_id},
    )
    assert start_resp.status_code == 200
    challenge = start_resp.json()
    assert challenge["job_id"] == job_id
    assert "Real-Time Distributed Streaming Architect" in challenge["self_repo_prompt"]
    assert challenge["completed"] is False

    # 5. Candidate submits the code fix & self-repo defense
    fixed_code = (
        "import asyncio\n\n"
        "async def dispatch_webhook_with_retry(client, url: str, max_retries: int = 4):\n"
        "    for attempt in range(max_retries):\n"
        "        try:\n"
        "            return await client.post(url)\n"
        "        except Exception:\n"
        "            if attempt == max_retries - 1:\n"
        "                raise\n"
        "            delay = min(2.0, 0.1 * (2 ** attempt))\n"
        "            await asyncio.sleep(delay)\n"
    )
    submit_resp = client.post(
        "/api/candidate/assessment/submit",
        json={
            "challenge_id": challenge["id"],
            "self_repo_explanation": "Defended consensus and distributed resilience in micro-raft-consensus with jittered exponential backoff and lock recovery.",
            "fixed_code": fixed_code,
        },
    )
    assert submit_resp.status_code == 200
    sub_data = submit_resp.json()
    assert sub_data["evaluation"]["passed"] is True
    assert sub_data["application"] is not None
    app_id = sub_data["application"]["application_id"]
    assert sub_data["application"]["queue_type"] == "fast_track"
    assert sub_data["application"]["fast_track_rank"] == 1

    # 6. Employer Cockpit reflects the candidate in the Fast-Track Queue for the new job
    emp_queue_resp = client.get(f"/api/employer/jobs/{job_id}/applications")
    assert emp_queue_resp.status_code == 200
    queue_data = emp_queue_resp.json()
    assert queue_data["fast_track_total"] >= 1
    top_cand = queue_data["fast_track_queue"][0]
    assert top_cand["application"]["id"] == app_id
    assert top_cand["candidate"]["github_username"] == "iiitd-dev"
    assert top_cand["sla"]["status"] == "within_sla"
    assert top_cand["sla"]["is_breached"] is False

    # 7. Employer issues 1-click offer disposition
    disp_resp = client.post(
        "/api/employer/disposition",
        json={
            "application_id": app_id,
            "action": "approve_offer",
            "note": "Exceptional distributed systems backoff fix. Approved for immediate offer.",
        },
    )
    assert disp_resp.status_code == 200
    assert disp_resp.json()["success"] is True
    assert disp_resp.json()["new_status"] == "approved_offer"

