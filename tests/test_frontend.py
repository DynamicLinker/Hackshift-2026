from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_frontend_index_serving():
    resp = client.get("/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    html = resp.text
    assert "ProofHired" in html
    assert "Candidate" in html
    assert "Employer" in html
    assert "Zero-Resume" in html
    assert "Anti-Ghost" in html or "72h" in html or "ghosting" in html.lower()

def test_static_js_serving():
    resp = client.get("/static/app.js")
    assert resp.status_code == 200
    js = resp.text
    assert "runCandidateAudit" in js
    assert "submitChallenge" in js
    assert "loadEmployerCockpit" in js
