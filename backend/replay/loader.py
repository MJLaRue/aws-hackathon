"""Replay mode: serve pre-recorded traces instead of calling Bedrock (design §9, R6)."""

from __future__ import annotations

import asyncio
import difflib
import json
import os
import re
from pathlib import Path
from typing import AsyncIterator

TRACE_DIR = Path(__file__).parent
THRESHOLD = 0.85
NOT_SCRIPTED = "Replay mode is active. This prompt is not in the scripted demo path."


def replay_active() -> bool:
    """REPLAY_MODE=true (read per call so tests and operators can toggle it)."""
    return os.getenv("REPLAY_MODE", "false").lower() == "true"


class ReplayLoader:
    def __init__(self, trace_dir: Path = TRACE_DIR):
        self.traces: dict[str, dict] = {}
        for f in sorted(trace_dir.glob("prompt_*.json")):
            self.traces[re.match(r"(prompt_\d+)", f.stem).group(1)] = json.loads(f.read_text(encoding="utf-8"))

    @staticmethod
    def _norm(s: str) -> str:
        return " ".join(s.strip().lower().split())

    def find_best_match(self, user_input: str) -> dict | None:
        q, best = self._norm(user_input), None
        for name, trace in self.traces.items():
            ratio = difflib.SequenceMatcher(None, q, self._norm(trace["prompt"])).ratio()
            if ratio >= THRESHOLD and (best is None or ratio > best["similarity"]):
                best = {"trace_name": name, "similarity": ratio, "trace": trace}
        return best


_LOADER: ReplayLoader | None = None


def get_loader() -> ReplayLoader:
    global _LOADER
    if _LOADER is None:
        _LOADER = ReplayLoader()
    return _LOADER


async def replay_turn(message: str, turn_id: str) -> AsyncIterator[str]:
    """SSE events for a replayed turn. Imports of the live path (boto3) are never triggered here."""
    from agent.loop import DONE, finish_turn, record_ids_in, sse, summarize_result

    match = get_loader().find_best_match(message)
    if match is None:
        yield sse({"type": "error", "message": NOT_SCRIPTED})
        yield DONE
        return
    trace = match["trace"]
    yield sse({"type": "tool_result", "tool": "replay",
               "summary": f"Matched {match['trace_name']} (similarity {match['similarity']:.2f})"})
    calls = []
    for tc in trace["tool_calls"]:
        yield sse({"type": "tool_call", "tool": tc["tool"], "input": tc["input"]})
        summary = summarize_result(tc["tool"], tc["result"])
        calls.append({"tool": tc["tool"], "input": tc["input"], "result_summary": summary,
                      "record_ids": record_ids_in(tc["result"])})
        yield sse({"type": "tool_result", "tool": tc["tool"], "summary": summary})
    for piece in re.findall(r"\S+\s*|\s+", trace["assistant_text"]):
        yield sse({"type": "token", "text": piece})
        await asyncio.sleep(0)
    async for chunk in finish_turn(trace["assistant_text"], [{"result": tc["result"]} for tc in trace["tool_calls"]],
                                   calls, turn_id):
        yield chunk
