"""Agent loop with SSE streaming (design §8, R5). Live Bedrock path and shared helpers.

Events (each serialised as ``data: {json}\\n\\n``): token, tool_call, tool_result, grounding_ok | grounding_flag,
warning, error, sources, then ``data: [DONE]``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any, AsyncIterator, Callable

import catalog
from agent.grounding import run_grounding_check
from agent.prompts import SYSTEM_PROMPT
from tools.definitions import TOOL_SCHEMAS
from tools.dispatcher import ToolError, dispatch_tool

logger = logging.getLogger("agent")

MAX_ITERATIONS = 10
MAX_TOKENS = 2048
RETRYABLE = {"ThrottlingException", "ServiceUnavailableException"}
BACKOFF_SECONDS = (1, 2, 4)
DONE = "data: [DONE]\n\n"
_SENTINEL = object()


def sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def summarize_result(tool: str, r: dict) -> str:
    """One-line description for the tool_result event and the sources panel (no model-facing numbers added)."""
    if r.get("refusal"):
        return "refused: Department × Category forecasting is not supported"
    if r.get("entity_not_found"):
        return "entity not found"
    if r.get("period_not_found"):
        return "period not found: " + ", ".join(r["period_not_found"])
    if tool == "list_entities":
        e = r["entities"]
        return f"{len(e['departments'])} departments, {len(e['categories'])} categories, {len(e['fund_sources'])} fund sources"
    if tool == "query_actuals":
        return f"{len(r['rows'])} row(s) returned"
    if tool == "run_forecast":
        return f"{len(r['points'])} forecast point(s), {r['confidence_label']} confidence, model {r['model_name']}"
    if tool == "detect_anomalies":
        return f"{len(r['anomalies'])} flagged record(s), {len(r['persistent_patterns'])} persistent pattern(s)"
    if tool == "compare_periods":
        return "two periods compared"
    if tool == "explain_variance":
        return f"{len(r['top_record_contributors'])} top record contributor(s)"
    if tool == "get_reporting_health":
        return f"{len(r['rows'])} process-health row(s)"
    return "ok"


def record_ids_in(r: dict, limit: int = 50) -> list[str]:
    ids: list[str] = []
    for key in ("anomalies", "top_record_contributors"):
        for item in r.get(key, []) or []:
            if isinstance(item, dict) and item.get("record_id") and item["record_id"] not in ids:
                ids.append(item["record_id"])
    return ids[:limit]


def tool_config() -> dict:
    return {"tools": [{"toolSpec": {"name": t["name"], "description": t["description"], "inputSchema": t["inputSchema"]}}
                      for t in TOOL_SCHEMAS]}


def make_bedrock_client():
    """Create the bedrock-runtime client. boto3 is imported lazily so replay mode never touches it."""
    import boto3
    from botocore.config import Config
    timeout = float(os.environ.get("BEDROCK_TIMEOUT_SECONDS", "30"))
    cfg = Config(read_timeout=timeout, connect_timeout=timeout, retries={"max_attempts": 1, "mode": "standard"})
    return boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"), config=cfg)


def _error_code(exc: Exception) -> str | None:
    return getattr(exc, "response", {}).get("Error", {}).get("Code") if hasattr(exc, "response") else None


def _error_text(exc: Exception) -> str:
    return str(getattr(exc, "response", {}).get("Error", {}).get("Message", "")) or str(exc)


def converse_with_retry(client, kwargs: dict, sleep: Callable[[float], None] | None = None):
    """converse_stream with exponential backoff (1s, 2s, 4s) on throttling / service-unavailable errors (§8.3)."""
    sleep = sleep or time.sleep
    for attempt in range(len(BACKOFF_SECONDS) + 1):
        try:
            return client.converse_stream(**kwargs)
        except Exception as exc:  # noqa: BLE001
            cfg = kwargs.get("inferenceConfig", {})
            if _error_code(exc) == "ValidationException" and "temperature" in cfg and "temperature" in _error_text(exc).lower():
                # Some newer models reject an explicit temperature; retry once with the model default.
                kwargs = {**kwargs, "inferenceConfig": {k: v for k, v in cfg.items() if k != "temperature"}}
                logger.warning("model rejected temperature; retrying without it")
                continue
            if _error_code(exc) in RETRYABLE and attempt < len(BACKOFF_SECONDS):
                sleep(BACKOFF_SECONDS[attempt])
                continue
            raise


def model_id() -> str:
    """BEDROCK_MODEL_ID with stray whitespace and wrapping quotes removed (docker-compose v1 keeps quotes from env files)."""
    return os.environ.get("BEDROCK_MODEL_ID", "").strip().strip("\"'").strip()


ERROR_HINTS = {
    "AccessDeniedException": "Bedrock denied access. Enable model access for BEDROCK_MODEL_ID in this region and check the IAM permissions.",
    "ResourceNotFoundException": "Bedrock model not found. Check BEDROCK_MODEL_ID and AWS_DEFAULT_REGION.",
    "ValidationException": "Bedrock rejected the request. BEDROCK_MODEL_ID may be invalid, or need an inference profile id (for example us.anthropic...).",
    "UnrecognizedClientException": "AWS credentials were rejected. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
    "ExpiredTokenException": "AWS credentials have expired. Refresh them (and AWS_SESSION_TOKEN if used).",
    "InvalidSignatureException": "AWS credentials were rejected. Check the secret key.",
}


def error_message(exc: Exception, code: str | None) -> str:
    """User-facing text; hints name configuration problems but never echo request or response content."""
    if code in RETRYABLE:
        return "Bedrock API unavailable after retries. Please try again."
    if code in ERROR_HINTS:
        detail = str(getattr(exc, "response", {}).get("Error", {}).get("Message", ""))[:300]
        # Bedrock's own message names the problem (model id, region, request shape) and holds no user content.
        return f"{ERROR_HINTS[code]} Model id used: {model_id()}. AWS says: {detail}" if detail and code in (
            "ValidationException", "ResourceNotFoundException", "AccessDeniedException") else ERROR_HINTS[code]
    name = type(exc).__name__
    if name in ("NoCredentialsError", "PartialCredentialsError"):
        return "No AWS credentials found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env, then restart the backend."
    if name in ("NoRegionError", "EndpointConnectionError", "ConnectTimeoutError", "ReadTimeoutError"):
        return "Could not reach Bedrock. Check AWS_DEFAULT_REGION and network access."
    return "The model request failed. Please try again."


async def _aiter(sync_iter) -> AsyncIterator[Any]:
    it = iter(sync_iter)
    while True:
        item = await asyncio.to_thread(next, it, _SENTINEL)
        if item is _SENTINEL:
            return
        yield item


def _run_tool(name: str, tool_input: dict, dataset_id: str) -> dict:
    conn = catalog.connect_dataset(dataset_id)
    try:
        return dispatch_tool(name, tool_input, conn, dataset_id)
    finally:
        conn.close()


async def finish_turn(text: str, evidence: list[dict], calls: list[dict], turn_id: str) -> AsyncIterator[str]:
    """Grounding verdict, sources panel and terminator, shared by live and replay paths."""
    result = run_grounding_check(text, [e["result"] for e in evidence], turn_id=turn_id)
    if result["flagged"]:
        yield sse({"type": "grounding_flag", "failed_values": result["failed_values"], "message": result["message"]})
    else:
        yield sse({"type": "grounding_ok"})
    yield sse({"type": "sources", "calls": calls})
    yield DONE


async def run_agent_loop(session_id: str, dataset_id: str, message: str, conversation_history: list[dict],
                         replay_mode: bool = False, bedrock_client=None) -> AsyncIterator[str]:
    """Async generator of SSE strings for one chat turn. ``conversation_history`` is updated in place."""
    turn_id = f"{session_id}:{uuid.uuid4().hex[:8]}"
    if replay_mode:
        from replay.loader import replay_turn
        async for chunk in replay_turn(message, turn_id):
            yield chunk
        return

    if catalog.get_dataset(dataset_id) is None:
        yield sse({"type": "error", "message": "Unknown dataset. Load or select a dataset first."})
        yield DONE
        return
    if bedrock_client is None:
        if not os.environ.get("BEDROCK_MODEL_ID"):
            yield sse({"type": "error", "message": "BEDROCK_MODEL_ID is not set. Configure Bedrock or enable REPLAY_MODE."})
            yield DONE
            return
        bedrock_client = make_bedrock_client()

    messages = list(conversation_history) + [{"role": "user", "content": [{"text": message}]}]
    system = [{"text": SYSTEM_PROMPT + f"\nActive dataset_id: {dataset_id}"}]
    turn_text: list[str] = []
    evidence: list[dict] = []     # [{tool, input, result}] for this turn only
    calls: list[dict] = []
    truncated = False

    try:
        for _ in range(MAX_ITERATIONS):
            kwargs = dict(modelId=model_id(), system=system, messages=messages,
                          toolConfig=tool_config(), inferenceConfig={"maxTokens": MAX_TOKENS, "temperature": 0.0})
            response = await asyncio.to_thread(converse_with_retry, bedrock_client, kwargs)

            blocks: dict[int, dict] = {}
            stop_reason = None
            async for ev in _aiter(response["stream"]):
                if "contentBlockStart" in ev:
                    i = ev["contentBlockStart"]["contentBlockIndex"]
                    tu = ev["contentBlockStart"].get("start", {}).get("toolUse")
                    blocks[i] = {"kind": "tool", "id": tu["toolUseId"], "name": tu["name"], "json": ""} if tu else {"kind": "text", "text": ""}
                elif "contentBlockDelta" in ev:
                    i = ev["contentBlockDelta"]["contentBlockIndex"]
                    delta = ev["contentBlockDelta"]["delta"]
                    blk = blocks.setdefault(i, {"kind": "text", "text": ""})
                    if "text" in delta:
                        blk.setdefault("text", "")
                        blk["text"] += delta["text"]
                        turn_text.append(delta["text"])
                        yield sse({"type": "token", "text": delta["text"]})
                    elif "toolUse" in delta:
                        blk["json"] += delta["toolUse"].get("input", "")
                elif "messageStop" in ev:
                    stop_reason = ev["messageStop"].get("stopReason")

            content: list[dict] = []
            tool_uses: list[dict] = []
            for i in sorted(blocks):
                b = blocks[i]
                if b["kind"] == "text":
                    if b["text"]:
                        content.append({"text": b["text"]})
                else:
                    try:
                        tinput = json.loads(b["json"]) if b["json"] else {}
                    except json.JSONDecodeError:
                        tinput = {}
                    tool_uses.append({"toolUseId": b["id"], "name": b["name"], "input": tinput})
                    content.append({"toolUse": tool_uses[-1]})
            messages.append({"role": "assistant", "content": content or [{"text": ""}]})

            if stop_reason == "max_tokens":
                truncated = True
            if stop_reason != "tool_use" or not tool_uses:
                break

            results = []
            for tu in tool_uses:
                yield sse({"type": "tool_call", "tool": tu["name"], "input": tu["input"]})
                try:
                    out = await asyncio.to_thread(_run_tool, tu["name"], tu["input"], dataset_id)
                    evidence.append({"tool": tu["name"], "input": tu["input"], "result": out})
                    summary = summarize_result(tu["name"], out)
                    calls.append({"tool": tu["name"], "input": tu["input"], "result_summary": summary,
                                  "record_ids": record_ids_in(out)})
                    results.append({"toolResult": {"toolUseId": tu["toolUseId"], "content": [{"json": out}], "status": "success"}})
                except ToolError as exc:
                    summary = f"tool error: {exc}"
                    calls.append({"tool": tu["name"], "input": tu["input"], "result_summary": summary, "record_ids": []})
                    results.append({"toolResult": {"toolUseId": tu["toolUseId"], "content": [{"text": str(exc)}], "status": "error"}})
                yield sse({"type": "tool_result", "tool": tu["name"], "summary": summary})
            messages.append({"role": "user", "content": results})
        else:
            yield sse({"type": "warning", "message": "Stopped after the maximum number of tool iterations."})
    except Exception as exc:  # noqa: BLE001
        code = _error_code(exc)
        logger.error("agent loop failed in turn %s (%s): %s", turn_id, code or type(exc).__name__, str(exc)[:500])
        msg = error_message(exc, code)
        yield sse({"type": "error", "message": msg})
        yield DONE
        return

    if truncated:
        yield sse({"type": "warning", "message": "The response was cut off at the token limit and may be incomplete."})

    text = "".join(turn_text)
    # R5-06: keep conversation history compact. Only the user question and the final text are retained.
    conversation_history.append({"role": "user", "content": [{"text": message}]})
    conversation_history.append({"role": "assistant", "content": [{"text": text or "(no text)"}]})
    del conversation_history[:-20]

    async for chunk in finish_turn(text, evidence, calls, turn_id):
        yield chunk
