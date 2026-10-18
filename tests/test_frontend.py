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
    assert "section-topology-graph-container" in html
    assert "topology-health-badge" in html
    assert "view-login" in html
    assert "view-app" in html
    assert "session-active-pill" in html
    assert "btn-login-employer-submit" in html
    assert "btn-login-candidate-submit" in html
    assert "supabase" in html.lower()
    assert "theme-employer" in html
    assert "theme-candidate" in html

def test_static_js_serving():
    resp = client.get("/static/app.js")
    assert resp.status_code == 200
    js = resp.text
    assert "runCandidateAudit" in js
    assert "submitChallenge" in js
    assert "loadEmployerCockpit" in js
    assert "renderTopologyGraph" in js
    assert "selectTopologyCommit" in js
    assert "openTopologyModalForCandidate" in js
    assert "initAuthSession" in js
    assert "loginAsEmployer" in js
    assert "loginAsCandidate" in js
    assert "logoutSession" in js
    assert "broadcastSyncEvent" in js
    assert "initSupabaseClient" in js
    assert "fillTestUser" in js
