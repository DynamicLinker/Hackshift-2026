from datetime import datetime, timezone, timedelta
import pytest
from app.models import CandidateProfile, Job, AssessmentChallenge, AssessmentSubmission, RepositoryAudit
from app.services.assessment_engine import generate_challenge, evaluate_submission

@pytest.fixture
def sample_candidate():
    return CandidateProfile(
        id="cand_test_aarav",
        github_username="iiitd-dev",
        full_name="Aarav Sharma",
        avatar_url="https://example.com/avatar.png",
        bio="CS Undergrad",
        is_bot=False,
        git_provenance_score=95.0,
        commit_topology_status="verified_human",
        audited_repos=[
            RepositoryAudit(
                repo_name="delhi-transit-stream",
                primary_language="Python",
                total_commits=45,
                commit_distribution="progressive_iterative",
                key_technologies=["Python", "FastAPI", "Redis"],
                provenance_rating=96.0,
            )
        ],
        credibility_score=95.0,
        fast_track_qualified=True,
    )

@pytest.fixture
def sample_job():
    return Job(
        id="job_backend_sde",
        company_id="comp_razorpay",
        company_name="Razorpay",
        title="Backend SDE - Core Payments",
        stack_tags=["Python", "FastAPI", "PostgreSQL", "Redis"],
        description="Build high-throughput payment processing APIs.",
        experience_level="Junior / Mid",
        salary_range="INR 18 - 25 LPA",
    )

def test_generate_challenge(sample_candidate, sample_job):
    challenge = generate_challenge(sample_candidate, sample_job)
    assert challenge.id.startswith("chal_")
    assert challenge.candidate_id == sample_candidate.id
    assert challenge.job_id == sample_job.id
    assert challenge.duration_seconds == 300
    assert "delhi-transit-stream" in challenge.self_repo_prompt
    assert "TokenBucket" in challenge.buggy_code_snippet
    assert challenge.completed is False
    assert challenge.status == "pending"

def test_evaluate_submission_passed(sample_candidate, sample_job):
    challenge = generate_challenge(sample_candidate, sample_job)
    
    # Valid submission within 90 seconds
    submission = AssessmentSubmission(
        challenge_id=challenge.id,
        self_repo_explanation=(
            "In delhi-transit-stream, we decoupled WebSocket subscriber management from Redis pub/sub "
            "using an asyncio queue buffer to prevent slow consumer backpressure from blocking "
            "concurrent socket broadcasts."
        ),
        fixed_code=(
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
    )
    
    # Simulate 75 seconds later
    sub_dt = datetime.fromisoformat(challenge.started_at) + timedelta(seconds=75)
    result = evaluate_submission(challenge, submission, sub_dt.isoformat())

    assert result["passed"] is True
    assert result["status"] == "passed"
    assert result["score"] >= 85.0
    assert challenge.completed is True
    assert challenge.status == "passed"

def test_evaluate_submission_timed_out(sample_candidate, sample_job):
    challenge = generate_challenge(sample_candidate, sample_job)
    
    submission = AssessmentSubmission(
        challenge_id=challenge.id,
        self_repo_explanation="Valid explanation with async queue and redis.",
        fixed_code="async with self.lock:\n    pass\n"
    )
    
    # Simulate 325 seconds later (exceeds 300s + 15s grace buffer)
    sub_dt = datetime.fromisoformat(challenge.started_at) + timedelta(seconds=325)
    result = evaluate_submission(challenge, submission, sub_dt.isoformat())

    assert result["passed"] is False
    assert result["status"] == "timed_out"
    assert challenge.status == "timed_out"
    assert "exceeded" in result["feedback"]

def test_evaluate_submission_syntax_error(sample_candidate, sample_job):
    challenge = generate_challenge(sample_candidate, sample_job)
    
    submission = AssessmentSubmission(
        challenge_id=challenge.id,
        self_repo_explanation="Quick answer.",
        fixed_code="def broken_syntax(:\n   this is not valid python"
    )
    
    sub_dt = datetime.fromisoformat(challenge.started_at) + timedelta(seconds=40)
    result = evaluate_submission(challenge, submission, sub_dt.isoformat())

    assert result["code_score"] == 10.0
    assert result["passed"] is False
