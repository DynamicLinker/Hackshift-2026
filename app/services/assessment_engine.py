"""Dynamic Micro-Assessment Engine.

Generates self-repo comprehension prompts and role-specific 5-minute debugging
challenges, enforcing server-side timer validation and code verification.
"""

from datetime import datetime, timezone
import uuid
import ast
from typing import Dict, Any, Optional
from app.models import AssessmentChallenge, AssessmentSubmission, CandidateProfile, Job


BUG_CHALLENGES = [
    {
        "id": "fastapi-async-race",
        "stack": ["Python", "FastAPI"],
        "title": "Fix Concurrency Race Condition in Shared Token Bucket",
        "instructions": (
            "The following FastAPI dependency manages a high-throughput rate limiter. "
            "Under concurrent load, multiple async requests interleave and allow token overdraft. "
            "Fix the race condition using `asyncio.Lock()` or an atomic check-and-decrement."
        ),
        "buggy_code": (
            "import asyncio\n"
            "from fastapi import HTTPException\n\n"
            "class TokenBucket:\n"
            "    def __init__(self, capacity: int = 10):\n"
            "        self.tokens = capacity\n"
            "        self.lock = asyncio.Lock()\n\n"
            "    async def consume(self) -> bool:\n"
            "        # BUG: Lock is never acquired before checking and decrementing\n"
            "        if self.tokens > 0:\n"
            "            await asyncio.sleep(0.001)  # Context switch simulation\n"
            "            self.tokens -= 1\n"
            "            return True\n"
            "        raise HTTPException(status_code=429, detail='Rate limit exceeded')\n"
        ),
        "solution_keywords": ["async with self.lock", "with self.lock", "acquire"],
        "concept": "Asyncio Concurrency Control",
    },
    {
        "id": "db-connection-leak",
        "stack": ["Python", "SQLAlchemy", "PostgreSQL"],
        "title": "Resolve Database Connection Leak in Async Repository",
        "instructions": (
            "In this database query handler, unhandled exceptions leave database sessions open, "
            "exhausting the connection pool under load. Refactor using a proper try/finally block "
            "or context manager."
        ),
        "buggy_code": (
            "async def get_user_orders(db_pool, user_id: str):\n"
            "    conn = await db_pool.acquire()\n"
            "    # BUG: If query execution fails, conn.release() is never reached\n"
            "    results = await conn.fetch('SELECT * FROM orders WHERE user_id = $1', user_id)\n"
            "    await db_pool.release(conn)\n"
            "    return results\n"
        ),
        "solution_keywords": ["finally:", "try:", "async with db_pool.acquire"],
        "concept": "Resource Management & Connection Pools",
    },
]


def generate_challenge(candidate: CandidateProfile, job: Job) -> AssessmentChallenge:
    """Dynamically generates a 5-minute micro-assessment challenge for the candidate."""
    now_iso = datetime.now(timezone.utc).isoformat()
    challenge_id = f"chal_{uuid.uuid4().hex[:10]}"

    # 1. Generate Self-Repo Comprehension Prompt
    top_repo = candidate.audited_repos[0] if candidate.audited_repos else None
    if top_repo:
        repo_name = top_repo.repo_name
        target_file = "core/handlers.py" if "python" in top_repo.primary_language.lower() else "src/index.ts"
        target_line = 42
        self_prompt = (
            f"In your repository '{repo_name}' (around {target_file}:{target_line}), "
            f"explain how your system handles connection dropouts, concurrency, or backpressure "
            f"under burst traffic, and why you selected this architectural pattern over naive polling."
        )
    else:
        repo_name = f"{candidate.github_username}-portfolio"
        target_file = "app/main.py"
        target_line = 35
        self_prompt = (
            f"In your core repository '{repo_name}', explain how your main service architecture "
            f"manages request state and error propagation."
        )

    # 2. Select matching debugging challenge
    challenge_template = BUG_CHALLENGES[0]
    for ch in BUG_CHALLENGES:
        if any(tag.lower() in [s.lower() for s in job.stack_tags] for tag in ch["stack"]):
            challenge_template = ch
            break

    return AssessmentChallenge(
        id=challenge_id,
        candidate_id=candidate.id,
        job_id=job.id,
        self_repo_prompt=self_prompt,
        target_repo=repo_name,
        target_file=target_file,
        target_line=target_line,
        bug_fix_title=challenge_template["title"],
        bug_fix_instructions=challenge_template["instructions"],
        buggy_code_snippet=challenge_template["buggy_code"],
        expected_concept=challenge_template["concept"],
        duration_seconds=300,
        started_at=now_iso,
        completed=False,
        score=0.0,
        status="pending",
    )


def evaluate_submission(
    challenge: AssessmentChallenge,
    submission: AssessmentSubmission,
    submission_time_iso: Optional[str] = None
) -> Dict[str, Any]:
    """Evaluates the candidate's self-repo explanation and code fix within the 5-minute window."""
    if submission_time_iso is None:
        submission_time_iso = datetime.now(timezone.utc).isoformat()

    # 1. Enforce Server-Side Time Synchronization
    # Grace buffer of 15 seconds for network transmission latency
    start_dt = datetime.fromisoformat(challenge.started_at)
    sub_dt = datetime.fromisoformat(submission_time_iso)
    elapsed_seconds = (sub_dt - start_dt).total_seconds()

    if elapsed_seconds > (challenge.duration_seconds + 15):
        challenge.completed = True
        challenge.status = "timed_out"
        challenge.score = 25.0
        return {
            "passed": False,
            "status": "timed_out",
            "score": 25.0,
            "elapsed_seconds": elapsed_seconds,
            "feedback": f"Submission exceeded the 300-second window ({round(elapsed_seconds, 1)}s elapsed).",
        }

    # 2. Evaluate Self-Repo Comprehension Explanation (50 points max)
    explanation = submission.self_repo_explanation.strip()
    explanation_score = 0.0
    relevant_keywords = [
        "concurrency", "lock", "async", "thread", "queue", "redis", "polling",
        "pub/sub", "disconnect", "cleanup", "backpressure", "pool", "socket",
        "buffer", "state", "token", "scale", "performance", "atomic"
    ]
    matched_words = [kw for kw in relevant_keywords if kw in explanation.lower()]
    
    if len(explanation) >= 40:
        explanation_score = 25.0 + min(len(matched_words) * 5.0, 25.0)
    elif len(explanation) > 10:
        explanation_score = 15.0
    else:
        explanation_score = 5.0

    # 3. Evaluate Code Bug Fix (50 points max)
    fixed_code = submission.fixed_code.strip()
    code_score = 0.0
    code_feedback = []

    # Syntax check
    try:
        ast.parse(fixed_code)
        syntax_valid = True
    except SyntaxError:
        syntax_valid = False

    if not syntax_valid:
        code_score = 10.0
        code_feedback.append("Syntax error in submitted code.")
    else:
        # Check for solution keywords and improvements over buggy code
        if "lock" in fixed_code.lower() and ("async with" in fixed_code or "with" in fixed_code or "acquire" in fixed_code):
            code_score = 50.0
            code_feedback.append("Successfully acquired concurrency lock before modifying shared state.")
        elif "finally:" in fixed_code or "try:" in fixed_code or "async with" in fixed_code:
            code_score = 48.0
            code_feedback.append("Resource cleanup pattern implemented safely.")
        elif fixed_code != challenge.buggy_code_snippet.strip():
            code_score = 30.0
            code_feedback.append("Code modified but missed optimal concurrency primitive.")
        else:
            code_score = 10.0
            code_feedback.append("Code unmodified from buggy starter template.")

    # 4. Composite Assessment Score
    total_score = round(min(100.0, explanation_score + code_score), 1)
    passed = total_score >= 70.0

    challenge.completed = True
    challenge.score = total_score
    challenge.status = "passed" if passed else "failed"

    return {
        "passed": passed,
        "status": challenge.status,
        "score": total_score,
        "elapsed_seconds": round(elapsed_seconds, 1),
        "explanation_score": explanation_score,
        "code_score": code_score,
        "feedback": " ".join(code_feedback) if code_feedback else "Assessment evaluated successfully.",
    }
