import pytest
from app.services.git_analyzer import (
    analyze_github_user,
    _evaluate_commits_topology,
    _synthesize_fallback_profile,
    DEMO_PROFILES,
)

@pytest.mark.anyio
async def test_demo_profile_iiitd_dev():
    profile = await analyze_github_user("iiitd-dev")
    assert profile.github_username == "iiitd-dev"
    assert profile.commit_topology_status == "verified_human"
    assert profile.git_provenance_score > 90.0
    assert profile.fast_track_qualified is True
    assert profile.is_bot is False
    assert len(profile.audited_repos) == 3
    assert profile.audited_repos[0].commit_distribution == "progressive_iterative"

@pytest.mark.anyio
async def test_demo_profile_ai_spammer():
    profile = await analyze_github_user("ai-spammer")
    assert profile.github_username == "ai-spammer"
    assert profile.commit_topology_status == "flagged_bulk_dump"
    assert profile.git_provenance_score < 30.0
    assert profile.fast_track_qualified is False
    assert profile.is_bot is True
    assert len(profile.audited_repos) >= 1
    assert profile.audited_repos[0].commit_distribution == "single_bulk_dump"

def test_evaluate_commits_topology():
    single_commit = [{"commit": {"message": "Initial commit"}}]
    dist, rating = _evaluate_commits_topology(single_commit)
    assert dist == "single_bulk_dump"
    assert rating <= 35.0

    multi_commits = [
        {"commit": {"message": "feat: add user authentication endpoints"}},
        {"commit": {"message": "fix: race condition in session tokens"}},
        {"commit": {"message": "refactor: optimize database connection pooling"}},
        {"commit": {"message": "test: add integration test suite"}},
    ]
    dist, rating = _evaluate_commits_topology(multi_commits)
    assert dist == "progressive_iterative"
    assert rating >= 80.0

@pytest.mark.anyio
async def test_fallback_synthesis():
    profile = await analyze_github_user("arbitrary_unknown_developer_42")
    assert profile.id.startswith("cand_")
    assert profile.git_provenance_score >= 0.0
    assert len(profile.audited_repos) > 0
    assert profile.commit_topology_status in ["verified_human", "flagged_bulk_dump"]
