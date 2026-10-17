from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_full_candidate_to_employer_vault_flow():
    # 1. Candidate Audits GitHub Profile
    audit_resp = client.post("/api/candidate/audit", json={"github_username": "iiitd-dev"})
    assert audit_resp.status_code == 200
    candidate = audit_resp.json()
    assert candidate["github_username"] == "iiitd-dev"
    assert candidate["commit_topology_status"] == "verified_human"
    assert candidate["fast_track_qualified"] is True
    cand_id = candidate["id"]

    # 2. Get Available Jobs
    jobs_resp = client.get("/api/employer/jobs")
    assert jobs_resp.status_code == 200
    jobs_data = jobs_resp.json()
    assert len(jobs_data) >= 1
    target_job_id = jobs_data[0]["job"]["id"]

    # 3. Start 5-Minute Micro-Assessment
    start_resp = client.post("/api/candidate/assessment/start", json={
        "candidate_id": cand_id,
        "job_id": target_job_id
    })
    assert start_resp.status_code == 200
    challenge = start_resp.json()
    assert challenge["duration_seconds"] == 300
    assert challenge["completed"] is False
    chal_id = challenge["id"]

    # 4. Submit Solved Assessment
    submit_resp = client.post("/api/candidate/assessment/submit", json={
        "challenge_id": chal_id,
        "self_repo_explanation": (
            "We handled WebSocket disconnection backpressure by pairing Redis pub/sub with an asyncio "
            "bounded queue and exponential backoff reconnection logic."
        ),
        "fixed_code": (
            "import asyncio\n"
            "from fastapi import HTTPException\n\n"
            "class TokenBucket:\n"
            "    def __init__(self, capacity: int = 10):\n"
            "        self.tokens = capacity\n"
            "        self.lock = asyncio.Lock()\n\n"
            "    async def consume(self) -> bool:\n"
            "        async with self.lock:\n"
            "            if self.tokens > 0:\n"
            "                self.tokens -= 1\n"
            "                return True\n"
            "            raise HTTPException(status_code=429, detail='Rate limit exceeded')\n"
        )
    })
    assert submit_resp.status_code == 200
    sub_data = submit_resp.json()
    assert sub_data["evaluation"]["passed"] is True
    assert sub_data["application"]["queue_type"] == "fast_track"
    app_id = sub_data["application"]["application_id"]

    # 5. Employer Checks Job Applications
    apps_resp = client.get(f"/api/employer/jobs/{target_job_id}/applications")
    assert apps_resp.status_code == 200
    apps_data = apps_resp.json()
    fast_track = apps_data["fast_track_queue"]
    
    # Verify candidate is vaulted into fast track queue
    vaulted_ids = [item["application"]["id"] for item in fast_track]
    assert app_id in vaulted_ids
    assert apps_data["cold_queue_total"] == 2140

    # 6. Employer Dispositions Candidate (1-Click Interview Scheduling)
    disp_resp = client.post("/api/employer/disposition", json={
        "application_id": app_id,
        "action": "schedule_interview",
        "note": "Exceptional concurrency and architecture response.",
        "interview_time": "Friday 4:00 PM IST"
    })
    assert disp_resp.status_code == 200
    disp_data = disp_resp.json()
    assert disp_data["new_status"] == "interview_scheduled"
    assert disp_data["interview_time"] == "Friday 4:00 PM IST"
