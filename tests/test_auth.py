from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_auth_session_options():
    resp = client.get("/api/auth/session")
    assert resp.status_code == 200
    data = resp.json()
    assert "companies" in data
    assert "candidates" in data
    assert "test_users" in data
    assert len(data["companies"]) >= 1
    assert any(c["id"] == "comp-acme" for c in data["companies"])
    assert any(cand["username"] == "iiitd-dev" for cand in data["candidates"])

def test_auth_config_endpoint():
    resp = client.get("/api/auth/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "is_supabase_enabled" in data
    assert "test_users" in data
    assert len(data["test_users"]) == 2

def test_auth_login_company_test_user():
    resp = client.post("/api/auth/login", json={
        "email": "recruiter@acmesystems.io",
        "password": "Password123!"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "authenticated"
    assert data["role"] == "employer"
    assert data["company_id"] == "comp-acme"
    assert "Acme" in data["company_name"]
    assert "Sarah Jenkins" in data["user_name"]

def test_auth_login_candidate_test_user():
    resp = client.post("/api/auth/login", json={
        "email": "aarav@iiitd.ac.in",
        "password": "Password123!"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "authenticated"
    assert data["role"] == "candidate"
    assert data["github_username"] == "iiitd-dev"
    assert "Aarav" in data["full_name"]

def test_auth_login_invalid_password():
    resp = client.post("/api/auth/login", json={
        "email": "recruiter@acmesystems.io",
        "password": "WrongPassword!"
    })
    assert resp.status_code == 401

def test_auth_login_employer_direct():
    resp = client.post("/api/auth/login", json={
        "role": "employer",
        "identifier": "comp-acme",
        "name": "Acme Systems Hiring Lead"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "authenticated"
    assert data["role"] == "employer"
    assert data["company_id"] == "comp-acme"
    assert "Acme" in data["company_name"]

def test_auth_login_candidate_direct():
    resp = client.post("/api/auth/login", json={
        "role": "candidate",
        "identifier": "iiitd-dev"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "authenticated"
    assert data["role"] == "candidate"
    assert data["github_username"] == "iiitd-dev"
    assert data["git_provenance_score"] > 80

def test_auth_login_invalid_role():
    resp = client.post("/api/auth/login", json={
        "role": "superadmin",
        "identifier": "root"
    })
    assert resp.status_code == 400
