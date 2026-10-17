"""In-Browser Live Python Code Execution Sandbox.

Safely compiles and runs candidate bug-fix submissions in an isolated async
execution frame, evaluating concurrency and resource safety against test cases
with real-time stdout and structured assertions.
"""

import ast
import asyncio
import time
from typing import Dict, Any, List, Optional
from fastapi import HTTPException


FORBIDDEN_MODULES = {
    "os", "sys", "subprocess", "shutil", "socket", "requests", "urllib",
    "http.client", "pathlib", "posix", "pty", "commands"
}


def check_code_safety(code: str) -> Optional[str]:
    """Inspects AST to prevent execution of unauthorized system-level calls."""
    try:
        tree = ast.parse(code)
    except SyntaxError as err:
        return f"SyntaxError: {err.msg} at line {err.lineno}"

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_module = alias.name.split(".")[0]
                if root_module in FORBIDDEN_MODULES:
                    return f"SecurityError: Prohibited module import '{root_module}'."
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_module = node.module.split(".")[0]
                if root_module in FORBIDDEN_MODULES:
                    return f"SecurityError: Prohibited module import '{root_module}'."
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in ("eval", "exec", "breakpoint"):
                return f"SecurityError: Builtin function '{node.func.id}' is restricted."
    return None


async def run_token_bucket_tests(local_scope: Dict[str, Any]) -> Dict[str, Any]:
    """Test suite for fastapi-async-race (TokenBucket concurrency control)."""
    TokenBucket = local_scope.get("TokenBucket")
    if not TokenBucket:
        return {
            "success": False,
            "passed": False,
            "error": "Class 'TokenBucket' was not found in the code.",
            "test_results": [],
            "stdout": "Error: Class 'TokenBucket' definition missing.",
        }

    test_results = []
    logs = []
    logs.append("=== Executing Concurrency & Rate Limiter Test Suite ===")

    # Test 1: Sequential Capacity Baseline
    t1_passed = False
    try:
        tb = TokenBucket(capacity=3)
        await tb.consume()
        await tb.consume()
        await tb.consume()
        # 4th consume must fail / rate-limit
        try:
            await tb.consume()
            t1_msg = "Expected rate-limit exception on 4th consume (capacity was 3)."
        except HTTPException as e:
            if e.status_code == 429:
                t1_passed = True
                t1_msg = "Successfully consumed 3 tokens; 4th request safely throttled with 429."
            else:
                t1_msg = f"HTTPException with unexpected status {e.status_code}."
        except Exception as e:
            t1_passed = True
            t1_msg = f"Request safely rejected with {type(e).__name__}."
    except Exception as e:
        t1_msg = f"Execution error in sequential test: {str(e)}"

    test_results.append({
        "name": "Sequential Baseline Test",
        "passed": t1_passed,
        "message": t1_msg,
    })
    logs.append(f"[{'PASS' if t1_passed else 'FAIL'}] Sequential Baseline: {t1_msg}")

    # Test 2: Concurrency Overdraft Stress Test (25 async workers on capacity 10)
    t2_passed = False
    try:
        tb2 = TokenBucket(capacity=10)
        tasks = [tb2.consume() for _ in range(25)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successes = sum(1 for r in results if r is True)
        failures = sum(1 for r in results if isinstance(r, (HTTPException, Exception)) or r is False)
        rem_tokens = getattr(tb2, "tokens", None)

        if successes == 10 and failures == 15 and (rem_tokens is None or rem_tokens >= 0):
            t2_passed = True
            t2_msg = "25 concurrent workers safely serialized: exactly 10 consumed, 15 rejected with 429."
        else:
            t2_msg = f"Race condition detected! {successes} requests succeeded with capacity=10 ({failures} rejected). Remaining tokens: {rem_tokens}."
    except Exception as e:
        t2_msg = f"Concurrency test error: {str(e)}"

    test_results.append({
        "name": "Concurrent Overdraft Stress Test",
        "passed": t2_passed,
        "message": t2_msg,
    })
    logs.append(f"[{'PASS' if t2_passed else 'FAIL'}] Concurrency Stress: {t2_msg}")

    # Test 3: Deadlock & Lock Release Hygiene
    t3_passed = False
    try:
        lock_obj = getattr(tb2, "lock", None)
        if lock_obj is not None and hasattr(lock_obj, "locked"):
            is_locked = lock_obj.locked()
            if not is_locked:
                t3_passed = True
                t3_msg = "Lock properly released after request bursts; no deadlock or starvation."
            else:
                t3_msg = "Deadlock detected: Lock remained permanently acquired after exceptions."
        else:
            t3_passed = False
            t3_msg = "No asyncio.Lock instance found on TokenBucket to serialize access."
    except Exception as e:
        t3_msg = f"Lock hygiene test error: {str(e)}"

    test_results.append({
        "name": "Lock Deadlock & Release Hygiene",
        "passed": t3_passed,
        "message": t3_msg,
    })
    logs.append(f"[{'PASS' if t3_passed else 'FAIL'}] Lock Hygiene: {t3_msg}")

    passed_count = sum(1 for t in test_results if t["passed"])
    total_count = len(test_results)
    all_passed = passed_count == total_count

    logs.append(f"\nResult: {passed_count}/{total_count} tests passed.")
    if all_passed:
        logs.append("Status: CONCURRENCY BUG RESOLVED. Code is safe for production fast-track.")
    else:
        logs.append("Status: BUG UNRESOLVED. Concurrency race conditions or missing locks detected.")

    return {
        "success": True,
        "passed": all_passed,
        "total_tests": total_count,
        "passed_tests": passed_count,
        "test_results": test_results,
        "stdout": "\n".join(logs),
    }


async def run_db_connection_tests(local_scope: Dict[str, Any]) -> Dict[str, Any]:
    """Test suite for db-connection-leak (Resource cleanup & connection pools)."""
    get_user_orders = local_scope.get("get_user_orders")
    if not get_user_orders:
        return {
            "success": False,
            "passed": False,
            "error": "Function 'get_user_orders' was not found in the code.",
            "test_results": [],
            "stdout": "Error: Function 'get_user_orders' definition missing.",
        }

    test_results = []
    logs = []
    logs.append("=== Executing Database Connection Pool Safety Test Suite ===")

    class MockConn:
        def __init__(self, should_fail=False):
            self.should_fail = should_fail
        async def fetch(self, query, user_id):
            if self.should_fail:
                raise RuntimeError("Database query execution timed out")
            return [{"id": "ord-1", "user_id": user_id}]

    class MockPool:
        def __init__(self, should_fail=False):
            self.should_fail = should_fail
            self.acquired = 0
            self.released = 0
            self.conn = MockConn(should_fail)
        async def acquire(self):
            self.acquired += 1
            return self.conn
        async def release(self, conn):
            self.released += 1

    # Test 1: Normal query release
    t1_passed = False
    pool1 = MockPool(should_fail=False)
    try:
        res = await get_user_orders(pool1, "u101")
        if pool1.acquired == 1 and pool1.released == 1 and len(res) == 1:
            t1_passed = True
            t1_msg = "Connection acquired, query completed, and connection cleanly released."
        else:
            t1_msg = f"Connection not released on happy path (acquired={pool1.acquired}, released={pool1.released})."
    except Exception as e:
        t1_msg = f"Error in normal execution: {str(e)}"

    test_results.append({
        "name": "Standard Query Resource Cleanup",
        "passed": t1_passed,
        "message": t1_msg,
    })
    logs.append(f"[{'PASS' if t1_passed else 'FAIL'}] Query Cleanup: {t1_msg}")

    # Test 2: Connection release on query exception (Leak prevention)
    t2_passed = False
    pool2 = MockPool(should_fail=True)
    try:
        try:
            await get_user_orders(pool2, "u102")
        except RuntimeError:
            pass  # Expected failure from fetch
        
        if pool2.acquired == 1 and pool2.released == 1:
            t2_passed = True
            t2_msg = "Leak prevented: Connection released to pool despite query runtime error."
        else:
            t2_msg = f"Connection leak detected! Acquired={pool2.acquired}, Released={pool2.released} after error."
    except Exception as e:
        t2_msg = f"Error in exception path test: {str(e)}"

    test_results.append({
        "name": "Exception Leak Prevention",
        "passed": t2_passed,
        "message": t2_msg,
    })
    logs.append(f"[{'PASS' if t2_passed else 'FAIL'}] Exception Safety: {t2_msg}")

    passed_count = sum(1 for t in test_results if t["passed"])
    total_count = len(test_results)
    all_passed = passed_count == total_count

    logs.append(f"\nResult: {passed_count}/{total_count} tests passed.")
    return {
        "success": True,
        "passed": all_passed,
        "total_tests": total_count,
        "passed_tests": passed_count,
        "test_results": test_results,
        "stdout": "\n".join(logs),
    }


async def run_retry_storm_tests(local_scope: Dict[str, Any]) -> Dict[str, Any]:
    """Test suite for network-retry-storm (Thundering herd & exponential backoff)."""
    dispatch_webhook = local_scope.get("dispatch_webhook_with_retry")
    if not dispatch_webhook:
        return {
            "success": False,
            "passed": False,
            "error": "Function 'dispatch_webhook_with_retry' was not found in the code.",
            "test_results": [],
            "stdout": "Error: Function 'dispatch_webhook_with_retry' definition missing.",
        }

    test_results = []
    logs = ["=== Executing Distributed Resilience & Backoff Test Suite ==="]

    class MockClient:
        def __init__(self, fail_times=0):
            self.fail_times = fail_times
            self.calls = 0
        async def post(self, url):
            self.calls += 1
            if self.calls <= self.fail_times:
                raise RuntimeError("503 Service Unavailable")
            return {"status": 200, "url": url}

    # Intercept asyncio.sleep in local_scope
    sleep_calls = []
    real_sleep = asyncio.sleep
    async def mock_sleep(d):
        sleep_calls.append(d)
        await real_sleep(0.001)

    saved_sleep = local_scope.get("asyncio").sleep if ("asyncio" in local_scope and hasattr(local_scope["asyncio"], "sleep")) else None
    if "asyncio" in local_scope and hasattr(local_scope["asyncio"], "sleep"):
        local_scope["asyncio"].sleep = mock_sleep

    # Test 1: Immediate success
    t1_passed = False
    client1 = MockClient(fail_times=0)
    sleep_calls.clear()
    try:
        res = await dispatch_webhook(client1, "https://api.cloud/webhook", 3)
        if client1.calls == 1 and len(sleep_calls) == 0 and res.get("status") == 200:
            t1_passed = True
            t1_msg = "Single attempt success: Webhook delivered cleanly on first try without delay."
        else:
            t1_msg = f"Unexpected calls ({client1.calls}) or sleeps ({len(sleep_calls)}) on clean request."
    except Exception as e:
        t1_msg = f"Error in immediate success test: {str(e)}"

    test_results.append({
        "name": "Single Attempt Baseline Test",
        "passed": t1_passed,
        "message": t1_msg,
    })
    logs.append(f"[{'PASS' if t1_passed else 'FAIL'}] Baseline: {t1_msg}")

    # Test 2: Transient Failures with Exponential Backoff
    t2_passed = False
    client2 = MockClient(fail_times=2)
    sleep_calls.clear()
    try:
        res = await dispatch_webhook(client2, "https://api.cloud/webhook", 4)
        has_sleeps = len(sleep_calls) == 2
        is_exponential = has_sleeps and sleep_calls[1] >= sleep_calls[0] and any(s >= 1 for s in sleep_calls)
        if client2.calls == 3 and is_exponential:
            t2_passed = True
            t2_msg = f"Thundering herd prevented: Applied exponential backoff delays {[round(s, 2) for s in sleep_calls]}s."
        else:
            t2_msg = f"Backoff missing or not exponential: sleep delays = {sleep_calls}, attempts = {client2.calls}."
    except Exception as e:
        t2_msg = f"Error in exponential backoff test: {str(e)}"

    test_results.append({
        "name": "Exponential Backoff & Thundering Herd Test",
        "passed": t2_passed,
        "message": t2_msg,
    })
    logs.append(f"[{'PASS' if t2_passed else 'FAIL'}] Exponential Backoff: {t2_msg}")

    # Test 3: Exhausted Retries Safety
    t3_passed = False
    client3 = MockClient(fail_times=10)
    sleep_calls.clear()
    try:
        await dispatch_webhook(client3, "https://api.cloud/webhook", 3)
        t3_msg = "Expected exception to re-raise after max_retries exhausted."
    except RuntimeError:
        if client3.calls == 3:
            t3_passed = True
            t3_msg = "Exception cleanly re-raised after exhausting max 3 retries."
        else:
            t3_msg = f"Wrong number of retry attempts ({client3.calls} instead of 3)."
    except Exception as e:
        t3_msg = f"Unexpected exception: {type(e).__name__}."

    test_results.append({
        "name": "Exhausted Retries Safety Test",
        "passed": t3_passed,
        "message": t3_msg,
    })
    logs.append(f"[{'PASS' if t3_passed else 'FAIL'}] Retry Exhaustion: {t3_msg}")

    if saved_sleep and "asyncio" in local_scope:
        local_scope["asyncio"].sleep = saved_sleep

    passed_count = sum(1 for t in test_results if t["passed"])
    total_count = len(test_results)
    all_passed = passed_count == total_count

    logs.append(f"\nResult: {passed_count}/{total_count} tests passed.")
    return {
        "success": True,
        "passed": all_passed,
        "total_tests": total_count,
        "passed_tests": passed_count,
        "test_results": test_results,
        "stdout": "\n".join(logs),
    }


async def execute_code_sandbox(code: str, challenge_id: str = "fastapi-async-race") -> Dict[str, Any]:
    """Compiles and executes candidate code within an isolated async sandbox."""
    t_start = time.perf_counter()

    # 1. AST Validation & Security Inspection
    security_err = check_code_safety(code)
    if security_err:
        t_elapsed = round((time.perf_counter() - t_start) * 1000, 1)
        return {
            "success": False,
            "passed": False,
            "error": security_err,
            "total_tests": 0,
            "passed_tests": 0,
            "execution_time_ms": t_elapsed,
            "stdout": f"Compile Error:\n{security_err}",
            "test_results": [],
        }

    # 2. Scope & Compilation
    global_scope = {
        "__builtins__": {
            k: v for k, v in __builtins__.items() if k not in ("breakpoint", "exit", "quit")
        },
        "asyncio": asyncio,
        "HTTPException": HTTPException,
    }
    local_scope: Dict[str, Any] = {}

    try:
        compiled = compile(code, "<sandbox>", "exec")
        exec(compiled, global_scope, local_scope)
    except Exception as e:
        t_elapsed = round((time.perf_counter() - t_start) * 1000, 1)
        return {
            "success": False,
            "passed": False,
            "error": f"{type(e).__name__}: {str(e)}",
            "total_tests": 0,
            "passed_tests": 0,
            "execution_time_ms": t_elapsed,
            "stdout": f"Runtime Compilation Error:\n{type(e).__name__}: {str(e)}",
            "test_results": [],
        }

    # 3. Execution with Timeout
    try:
        cid = challenge_id.lower()
        if "leak" in cid:
            res = await asyncio.wait_for(run_db_connection_tests(local_scope), timeout=3.0)
        elif "retry" in cid or "storm" in cid or "resilience" in cid:
            res = await asyncio.wait_for(run_retry_storm_tests(local_scope), timeout=3.0)
        else:
            res = await asyncio.wait_for(run_token_bucket_tests(local_scope), timeout=3.0)
    except asyncio.TimeoutError:
        t_elapsed = round((time.perf_counter() - t_start) * 1000, 1)
        return {
            "success": False,
            "passed": False,
            "error": "Execution timed out (exceeded 3.0-second limit).",
            "total_tests": 0,
            "passed_tests": 0,
            "execution_time_ms": t_elapsed,
            "stdout": "TimeoutError: Execution timed out (exceeded 3.0-second limit). Check for infinite loops or deadlocks.",
            "test_results": [],
        }
    except Exception as e:
        t_elapsed = round((time.perf_counter() - t_start) * 1000, 1)
        return {
            "success": False,
            "passed": False,
            "error": f"Test Execution Error: {str(e)}",
            "total_tests": 0,
            "passed_tests": 0,
            "execution_time_ms": t_elapsed,
            "stdout": f"Test Execution Error:\n{str(e)}",
            "test_results": [],
        }

    t_elapsed = round((time.perf_counter() - t_start) * 1000, 1)
    res["execution_time_ms"] = t_elapsed
    return res
