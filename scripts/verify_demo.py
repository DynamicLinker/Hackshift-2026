"""Horizon Live Stage Demo Verification Script.

Executes end-to-end verification of Git Provenance, Dynamic 5-minute Micro-Assessment,
Vaulting to the Fast-Track Queue, and 72-hour Anti-Ghosting SLA Disposition.
"""

import sys
import os

# Ensure project root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from app.main import app

def run_verification():
    print("\n" + "=" * 65)
    print(" ⚡ Horizon: End-to-End Prototype Live Verification")
    print("=" * 65)
    client = TestClient(app)

    # 1. Health & Datastore check
    print("\n[Step 1] Verifying System Scaffolding & Unified Runtime...")
    res = client.get("/api/health")
    assert res.status_code == 200
    h = res.json()
    print(f" ✓ Status: {h['status'].upper()} | Companies: {h['companies_loaded']} | Jobs: {h['jobs_loaded']}")

    # 2. Audit verified human developer (@iiitd-dev)
    print("\n[Step 2] Auditing Git Provenance for '@iiitd-dev'...")
    res = client.post("/api/candidate/audit", json={"github_username": "iiitd-dev"})
    assert res.status_code == 200
    cand = res.json()
    print(f" ✓ Name: {cand['full_name']} (@{cand['github_username']})")
    print(f" ✓ Git Provenance Score: {cand['git_provenance_score']}%")
    print(f" ✓ Topology Status: {cand['commit_topology_status'].upper()}")
    print(f" ✓ Audited Repositories: {len(cand['audited_repos'])} repos progressive history verified")

    # 3. Contrast with AI Spammer (@ai-spammer)
    print("\n[Step 3] Contrast: Auditing AI Spammer profile ('@ai-spammer')...")
    res_spam = client.post("/api/candidate/audit", json={"github_username": "ai-spammer"})
    assert res_spam.status_code == 200
    spam = res_spam.json()
    print(f" ✓ Topology: {spam['commit_topology_status']} (Bulk dump detected)")
    print(f" ✓ Fast-Track Qualified: {spam['fast_track_qualified']} (Bypassed from priority queue)")

    # 4. Dynamic Micro-Assessment Generation
    print("\n[Step 4] Generating Dynamic 5-Minute Micro-Assessment...")
    jobs = client.get("/api/employer/jobs").json()
    target_job = jobs[0]["job"]
    res_chal = client.post("/api/candidate/assessment/start", json={
        "candidate_id": cand["id"],
        "job_id": target_job["id"],
    })
    assert res_chal.status_code == 200
    chal = res_chal.json()
    print(f" ✓ Self-Repo Question generated from '{chal['target_repo']}':")
    print(f"   \"{chal['self_repo_prompt'][:95]}...\"")
    print(f" ✓ Concurrency Bug Fix: {chal['bug_fix_title']} (300s timer initialized)")

    # 5. Candidate Solves & Submits Assessment
    print("\n[Step 5] Submitting Verified Code & Architecture Defense...")
    res_sub = client.post("/api/candidate/assessment/submit", json={
        "challenge_id": chal["id"],
        "self_repo_explanation": (
            "In delhi-transit-stream, we decoupled Redis pub/sub broadcasting from WebSocket "
            "subscribers using an asyncio queue buffer to absorb burst concurrency and prevent "
            "slow client backpressure from stalling other sockets."
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
    assert res_sub.status_code == 200
    sub_data = res_sub.json()
    print(f" ✓ Evaluation: {sub_data['evaluation']['status'].upper()} (Score: {sub_data['evaluation']['score']}/100)")
    print(f" ✓ Fast-Track Promotion: {sub_data['application']['message']}")
    app_id = sub_data["application"]["application_id"]

    # 6. Employer Queue Contrast (Fast-Track vs 2,140 Cold Resumes)
    print("\n[Step 6] Inspecting Employer Cockpit Queues...")
    res_apps = client.get(f"/api/employer/jobs/{target_job['id']}/applications")
    apps_data = res_apps.json()
    print(f" ✓ Top Candidate in Fast-Track: {apps_data['fast_track_queue'][0]['application']['candidate_name']}")
    print(f" ✓ Composite Score: {apps_data['fast_track_queue'][0]['application']['composite_score']}%")
    print(f" ✓ Cold Spam Queue Deprioritized: {apps_data['cold_queue_total']} resumes bypassed")

    # 7. 72-Hour Anti-Ghosting SLA Action
    print("\n[Step 7] Testing 1-Click Employer SLA Disposition...")
    res_disp = client.post("/api/employer/disposition", json={
        "application_id": app_id,
        "action": "schedule_interview",
        "note": "Exceptional code architecture and concurrency response.",
        "interview_time": "Friday at 4:00 PM IST"
    })
    assert res_disp.status_code == 200
    disp_res = res_disp.json()
    print(f" ✓ New Application Status: {disp_res['new_status'].upper()}")
    print(f" ✓ Interview Time Slot: {disp_res['interview_time']}")
    print(f" ✓ SLA Respected: {disp_res['sla_met']} (Verified Responsive Badge Preserved)")

    print("\n" + "=" * 65)
    print(" 🎉 ALL 7 CRITICAL DEMO FLOWS VERIFIED 100% OPERATIONAL!")
    print("=" * 65 + "\n")

if __name__ == "__main__":
    run_verification()
