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
        "stack": ["FastAPI", "Redis", "Concurrency", "RaceCondition", "Lock", "RateLimiter", "TokenBucket"],
        "title": "Fix Concurrency Race Condition in Shared Token Bucket",
        "filename": "token_bucket.py",
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
        "stack": ["SQLAlchemy", "PostgreSQL", "Database", "MLOps", "SQL", "Pool", "Storage"],
        "title": "Resolve Database Connection Leak in Async Repository",
        "filename": "db_repository.py",
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
    {
        "id": "network-retry-storm",
        "stack": ["Distributed Systems", "WebSockets", "AWS", "CI/CD", "DevOps", "Microservices", "Docker", "SRE", "Go", "Rust", "Node", "TypeScript", "Resilience"],
        "title": "Prevent Thundering Herd Retry Storm with Jittered Exponential Backoff",
        "filename": "resilience_client.py",
        "instructions": (
            "In this distributed webhook dispatcher, upstream service failures trigger instantaneous retries, "
            "creating a thundering herd storm that overloads downstream systems. "
            "Implement exponential backoff using `asyncio.sleep(2 ** attempt)` with a maximum capped delay."
        ),
        "buggy_code": (
            "import asyncio\n\n"
            "async def dispatch_webhook_with_retry(client, url: str, max_retries: int = 4):\n"
            "    for attempt in range(max_retries):\n"
            "        try:\n"
            "            return await client.post(url)\n"
            "        except Exception:\n"
            "            # BUG: Immediate tight-loop retry without backoff causes thundering herd\n"
            "            if attempt == max_retries - 1:\n"
            "                raise\n"
        ),
        "solution_keywords": ["asyncio.sleep", "2 ** attempt", "2**attempt", "backoff", "min("],
        "concept": "Distributed Resilience & Exponential Backoff",
    },
]


def generate_challenge(candidate: CandidateProfile, job: Job) -> AssessmentChallenge:
    """Dynamically generates a 5-minute micro-assessment challenge tailored specifically to the target job description."""
    now_iso = datetime.now(timezone.utc).isoformat()
    challenge_id = f"chal_{uuid.uuid4().hex[:10]}"

    # 1. Match challenge template to job description and stack tags by highest affinity
    challenge_template = BUG_CHALLENGES[0]
    best_score = -1

    for ch in BUG_CHALLENGES:
        matches = [tag for tag in ch["stack"] if tag.lower() in [s.lower() for s in job.stack_tags]]
        score = len(matches)
        if ch["id"] in job.id.lower():
            score += 10
        if score > best_score:
            challenge_template = ch
            best_score = score

    # 2. Generate Self-Repo Comprehension Prompt tailored specifically to job & company
    top_repo = candidate.audited_repos[0] if candidate.audited_repos else None
    if top_repo:
        repo_name = top_repo.repo_name
        target_file = "core/handlers.py" if "python" in top_repo.primary_language.lower() else "src/index.ts"
        target_line = 42
    else:
        repo_name = f"{candidate.github_username}-portfolio"
        target_file = "app/main.py"
        target_line = 35

    concept_lower = challenge_template["concept"].lower()
    if "concurrency" in concept_lower:
        theme = (
            f"defend your concurrency architecture. How does your service serialize concurrent requests, "
            f"prevent race conditions on shared memory, and enforce backpressure under traffic spikes?"
        )
    elif "resource" in concept_lower or "connection" in concept_lower:
        theme = (
            f"defend your resource pooling architecture. How does your service prevent unhandled exception leaks, "
            f"manage connection timeouts, and recover exhausted database pools?"
        )
    else:
        theme = (
            f"defend your distributed resilience architecture. How does your architecture mitigate cascading network failures, "
            f"apply exponential backoff with jitter across network boundaries, and ensure idempotent processing?"
        )

    self_prompt = (
        f"For the '{job.title}' role at {job.company_name}: In your repository '{repo_name}' "
        f"(around {target_file}:{target_line}), {theme} Explain your architectural rationale over naive implementations."
    )

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
        filename=challenge_template.get("filename", "token_bucket.py"),
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
        "buffer", "state", "token", "scale", "performance", "atomic",
        "retry", "backoff", "exponential", "jitter", "idempotent", "resilience", "stream"
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
        # Check for solution keywords matched to the specific challenge domain
        concept_lower = challenge.expected_concept.lower()
        if "backoff" in concept_lower or "resilience" in concept_lower or "retry" in concept_lower:
            if ("asyncio.sleep" in fixed_code or "sleep(" in fixed_code) and (
                "2 ** attempt" in fixed_code or "2**attempt" in fixed_code or "backoff" in fixed_code or "min(" in fixed_code
            ):
                code_score = 50.0
                code_feedback.append("Exponential backoff implemented to prevent thundering herd retry storms.")
            elif fixed_code != challenge.buggy_code_snippet.strip():
                code_score = 30.0
                code_feedback.append("Code modified but missed optimal exponential backoff delay.")
            else:
                code_score = 10.0
                code_feedback.append("Code unmodified from buggy starter template.")
        elif "resource" in concept_lower or "connection" in concept_lower or "pool" in concept_lower:
            if "finally:" in fixed_code or "async with" in fixed_code or ("try:" in fixed_code and "release" in fixed_code):
                code_score = 50.0
                code_feedback.append("Resource cleanup pattern implemented safely.")
            elif fixed_code != challenge.buggy_code_snippet.strip():
                code_score = 30.0
                code_feedback.append("Code modified but missed optimal cleanup block.")
            else:
                code_score = 10.0
                code_feedback.append("Code unmodified from buggy starter template.")
        else:
            # Concurrency & Token Bucket
            if "lock" in fixed_code.lower() and ("async with" in fixed_code or "with" in fixed_code or "acquire" in fixed_code):
                code_score = 50.0
                code_feedback.append("Successfully acquired concurrency lock before modifying shared state.")
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
