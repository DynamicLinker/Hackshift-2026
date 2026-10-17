import os
import subprocess
from fastapi.testclient import TestClient
from app.main import app
from app.services.git_analyzer import clone_and_inspect_repo

client = TestClient(app)

def test_clone_and_inspect_local_repo(tmp_path):
    # Initialize a temporary git repository with 3 progressive commits
    repo_dir = tmp_path / "test_mini_repo"
    repo_dir.mkdir()
    subprocess.run(["git", "init"], cwd=repo_dir, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test Dev"], cwd=repo_dir, check=True)
    subprocess.run(["git", "config", "user.email", "dev@test.org"], cwd=repo_dir, check=True)

    # Commit 1
    (repo_dir / "requirements.txt").write_text("fastapi==0.110.0\npydantic>=2.0\n")
    subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)
    subprocess.run(["git", "commit", "-m", "feat: initial commit with fastapi dependencies"], cwd=repo_dir, check=True)

    # Commit 2
    (repo_dir / "main.py").write_text("from fastapi import FastAPI\napp = FastAPI()\n")
    subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)
    subprocess.run(["git", "commit", "-m", "feat: scaffold basic routes"], cwd=repo_dir, check=True)

    # Commit 3
    (repo_dir / "test_main.py").write_text("def test_dummy(): assert True\n")
    subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)
    subprocess.run(["git", "commit", "-m", "test: add unit tests for handlers"], cwd=repo_dir, check=True)

    audit, log_sample, repo_name = clone_and_inspect_repo(str(repo_dir))
    assert audit.primary_language == "Python"
    assert "FastAPI" in audit.key_technologies
    assert audit.total_commits >= 3
    assert audit.commit_distribution == "progressive_iterative"
    assert audit.provenance_rating >= 70.0


def test_candidate_audit_with_repo_url(tmp_path):
    repo_dir = tmp_path / "candidate_sample_repo"
    repo_dir.mkdir()
    subprocess.run(["git", "init"], cwd=repo_dir, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Tester"], cwd=repo_dir, check=True)
    subprocess.run(["git", "config", "user.email", "tester@test.com"], cwd=repo_dir, check=True)
    (repo_dir / "package.json").write_text('{"name": "frontend", "dependencies": {"react": "^18.0"}}')
    subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)
    subprocess.run(["git", "commit", "-m", "feat: initialize react application"], cwd=repo_dir, check=True)

    resp = client.post("/api/candidate/audit", json={
        "github_username": "react-dev",
        "repo_url": str(repo_dir)
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["github_username"] == "react-dev"
    assert len(data["audited_repos"]) == 1
    assert data["cloned_locally"] is True


def test_time_simulation_slider_affects_sla():
    # Query with normal time
    res_now = client.get("/api/employer/jobs/job-backend-fastapi/applications?simulated_hours=0")
    assert res_now.status_code == 200
    apps_now = res_now.json()["fast_track_queue"]
    
    # Query with +75 hours simulated (crossing 72h SLA window)
    res_sim = client.get("/api/employer/jobs/job-backend-fastapi/applications?simulated_hours=75")
    assert res_sim.status_code == 200
    apps_sim = res_sim.json()["fast_track_queue"]

    # Under +75 hours, any pending application without disposition should be breached
    for item in apps_sim:
        if item["application"]["status"] == "pending":
            assert item["sla"]["status"] == "sla_breached"
            assert item["sla"]["is_breached"] is True
            assert item["sla"]["overdue_hours"] > 0


def test_time_simulation_slider_penalizes_company():
    # At 0 hours, Acme is verified responsive
    res_0 = client.get("/api/employer/company/comp-acme?simulated_hours=0")
    assert res_0.status_code == 200

    # At +80 hours, inactive pending applications breach SLA and affect reputation
    res_80 = client.get("/api/employer/company/comp-acme?simulated_hours=80")
    assert res_80.status_code == 200
    data_80 = res_80.json()
    assert data_80["active_breaches"] >= 1
