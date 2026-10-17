import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.code_sandbox import execute_code_sandbox, check_code_safety

client = TestClient(app)

BUGGY_TOKEN_BUCKET = """
import asyncio
from fastapi import HTTPException

class TokenBucket:
    def __init__(self, capacity: int = 10):
        self.tokens = capacity
        self.lock = asyncio.Lock()

    async def consume(self) -> bool:
        if self.tokens > 0:
            await asyncio.sleep(0.001)
            self.tokens -= 1
            return True
        raise HTTPException(status_code=429, detail='Rate limit exceeded')
"""

FIXED_TOKEN_BUCKET = """
import asyncio
from fastapi import HTTPException

class TokenBucket:
    def __init__(self, capacity: int = 10):
        self.tokens = capacity
        self.lock = asyncio.Lock()

    async def consume(self) -> bool:
        async with self.lock:
            if self.tokens > 0:
                await asyncio.sleep(0.001)
                self.tokens -= 1
                return True
            raise HTTPException(status_code=429, detail='Rate limit exceeded')
"""

BUGGY_DB_LEAK = """
async def get_user_orders(db_pool, user_id: str):
    conn = await db_pool.acquire()
    results = await conn.fetch('SELECT * FROM orders WHERE user_id = $1', user_id)
    await db_pool.release(conn)
    return results
"""

FIXED_DB_LEAK = """
async def get_user_orders(db_pool, user_id: str):
    conn = await db_pool.acquire()
    try:
        results = await conn.fetch('SELECT * FROM orders WHERE user_id = $1', user_id)
        return results
    finally:
        await db_pool.release(conn)
"""


@pytest.mark.anyio
async def test_buggy_code_fails_concurrency_race():
    res = await execute_code_sandbox(BUGGY_TOKEN_BUCKET, challenge_id="fastapi-async-race")
    assert res["success"] is True
    assert res["passed"] is False
    assert res["total_tests"] == 3
    # Baseline sequential test passes, but concurrency stress fails due to overdraft
    assert res["test_results"][0]["passed"] is True
    assert res["test_results"][1]["passed"] is False
    assert "Race condition detected" in res["test_results"][1]["message"]


@pytest.mark.anyio
async def test_fixed_code_passes_all_concurrency_tests():
    res = await execute_code_sandbox(FIXED_TOKEN_BUCKET, challenge_id="fastapi-async-race")
    assert res["success"] is True
    assert res["passed"] is True
    assert res["total_tests"] == 3
    assert res["passed_tests"] == 3
    for test in res["test_results"]:
        assert test["passed"] is True
    assert "CONCURRENCY BUG RESOLVED" in res["stdout"]


@pytest.mark.anyio
async def test_syntax_error_reported():
    bad_code = "def foo(\n  return 1"
    res = await execute_code_sandbox(bad_code, challenge_id="fastapi-async-race")
    assert res["success"] is False
    assert res["passed"] is False
    assert "SyntaxError" in res["error"]


@pytest.mark.anyio
async def test_security_check_blocks_dangerous_calls():
    evil_code = "import os\nos.system('echo hacked')\nclass TokenBucket:\n    pass\n"
    res = await execute_code_sandbox(evil_code, challenge_id="fastapi-async-race")
    assert res["success"] is False
    assert "SecurityError" in res["error"]
    assert "Prohibited module" in res["error"]


@pytest.mark.anyio
async def test_infinite_loop_timeout():
    loop_code = """
import asyncio
class TokenBucket:
    def __init__(self, capacity=10): pass
    async def consume(self):
        while True:
            await asyncio.sleep(0.01)
"""
    res = await execute_code_sandbox(loop_code, challenge_id="fastapi-async-race")
    assert res["success"] is False
    assert "timed out" in res["error"].lower()


@pytest.mark.anyio
async def test_db_leak_challenge():
    res_buggy = await execute_code_sandbox(BUGGY_DB_LEAK, challenge_id="db-connection-leak")
    assert res_buggy["passed"] is False
    assert res_buggy["test_results"][1]["passed"] is False  # Exception leak failed

    res_fixed = await execute_code_sandbox(FIXED_DB_LEAK, challenge_id="db-connection-leak")
    assert res_fixed["passed"] is True
    assert res_fixed["test_results"][0]["passed"] is True
    assert res_fixed["test_results"][1]["passed"] is True


def test_api_run_code_endpoint():
    resp = client.post("/api/candidate/assessment/run-code", json={
        "challenge_id": "fastapi-async-race",
        "code": FIXED_TOKEN_BUCKET,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["passed"] is True
    assert data["total_tests"] == 3
    assert data["passed_tests"] == 3
    assert "execution_time_ms" in data


BUGGY_RETRY_STORM = """
import asyncio

async def dispatch_webhook_with_retry(client, url: str, max_retries: int = 4):
    for attempt in range(max_retries):
        try:
            return await client.post(url)
        except Exception:
            if attempt == max_retries - 1:
                raise
"""

FIXED_RETRY_STORM = """
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


@pytest.mark.anyio
async def test_retry_storm_challenge():
    res_buggy = await execute_code_sandbox(BUGGY_RETRY_STORM, challenge_id="network-retry-storm")
    assert res_buggy["passed"] is False
    assert res_buggy["test_results"][1]["passed"] is False

    res_fixed = await execute_code_sandbox(FIXED_RETRY_STORM, challenge_id="network-retry-storm")
    assert res_fixed["passed"] is True
    assert res_fixed["test_results"][0]["passed"] is True
    assert res_fixed["test_results"][1]["passed"] is True
    assert res_fixed["test_results"][2]["passed"] is True

