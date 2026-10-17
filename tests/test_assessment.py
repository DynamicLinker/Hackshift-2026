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


def test_job_specific_assessment_matching(sample_candidate):
    """Verify that each job opening generates a tailored assessment relevant to its description and stack."""
    from app.db.datastore import db

    # 1. Acme Systems (Concurrency)
    job_acme = db.get_job("job-backend-fastapi")
    chal_acme = generate_challenge(sample_candidate, job_acme)
    assert chal_acme.filename == "token_bucket.py"
    assert "concurrency" in chal_acme.bug_fix_title.lower()
    assert "Acme Systems" in chal_acme.self_repo_prompt
    assert "delhi-transit-stream" in chal_acme.self_repo_prompt

    # 2. Nova Labs (Database Connection Pools)
    job_nova = db.get_job("job-mlops-nova")
    chal_nova = generate_challenge(sample_candidate, job_nova)
    assert chal_nova.filename == "db_repository.py"
    assert "database connection leak" in chal_nova.bug_fix_title.lower()
    assert "Nova Labs" in chal_nova.self_repo_prompt
    assert "delhi-transit-stream" in chal_nova.self_repo_prompt

    # 3. Phantom Corp (Distributed Resilience / Retry Storm)
    job_phantom = db.get_job("job-devops-phantom")
    chal_phantom = generate_challenge(sample_candidate, job_phantom)
    assert chal_phantom.filename == "resilience_client.py"
    assert "retry storm" in chal_phantom.bug_fix_title.lower()
    assert "Phantom Corp" in chal_phantom.self_repo_prompt
    assert "delhi-transit-stream" in chal_phantom.self_repo_prompt


def test_evaluate_submission_retry_storm_passed(sample_candidate):
    """Verify that submitting exponential backoff passes the retry storm evaluation."""
    from app.db.datastore import db

    job_phantom = db.get_job("job-devops-phantom")
    challenge = generate_challenge(sample_candidate, job_phantom)

    fixed_code = """
import asyncio

async def dispatch_webhook_with_retry(client, url: str, max_retries: int = 4):
    for attempt in range(max_retries):
        try:
            return await client.post(url)
        except Exception:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(min(2 ** attempt, 8))
"""
    submission = AssessmentSubmission(
        challenge_id=challenge.id,
        self_repo_explanation="In my transit stream repo, I implemented exponential backoff and jittered retries to protect downstream systems.",
        fixed_code=fixed_code
    )
    result = evaluate_submission(challenge, submission)
    assert result["passed"] is True
    assert result["score"] >= 80.0
    assert "Exponential backoff" in result["feedback"]

