import json
import sys
from pathlib import Path

import pytest

from agent.grounding import run_grounding_check
from replay.loader import ReplayLoader

from conftest import parse_sse, types

TRACE_FILES = sorted(Path(__file__).resolve().parent.parent.joinpath("backend", "replay").glob("prompt_*.json"))
PROMPTS = {
    "prompt_01": "Which departments are furthest over budget, and by how much?",
    "prompt_02": "Why is Consulting & Contracts over budget?",
    "prompt_03": "Where are we consistently underspending?",
    "prompt_04": "What is the FY2027 forecast for total spend versus budget, and how confident are you?",
    "prompt_05": "Which individual records are the biggest outliers?",
    "prompt_06": "How long do reports take to produce, and where are the errors?",
    "prompt_07": "What did the Bursar's office spend on travel?",
}


@pytest.fixture(scope="module")
def replay_loader():
    return ReplayLoader()


def test_seven_traces_in_order():
    assert [f.stem[:9] for f in TRACE_FILES] == list(PROMPTS)


@pytest.mark.parametrize("user_input,expected", [
    ("Which departments are furthest over budget, and by how much?", "prompt_01"),
    ("what did the bursar's office spend on travel?", "prompt_07"),
    ("What did the Bursar's Office spend on travel?", "prompt_07"),
    ("What is the weather today?", None),
])
def test_replay_fuzzy_match(user_input, expected, replay_loader):
    match = replay_loader.find_best_match(user_input)
    if expected is None:
        assert match is None
    else:
        assert match["trace_name"] == expected and match["similarity"] >= 0.85


def test_every_scripted_prompt_matches_itself(replay_loader):
    for name, prompt in PROMPTS.items():
        assert replay_loader.find_best_match(prompt)["trace_name"] == name
        assert replay_loader.find_best_match(prompt.upper() + "  ")["trace_name"] == name


@pytest.mark.parametrize("trace_file", TRACE_FILES, ids=lambda f: f.stem[:9])
def test_replay_passes_grounding(trace_file):
    trace = json.loads(trace_file.read_text(encoding="utf-8"))
    flags = run_grounding_check(trace["assistant_text"], trace["tool_calls"])
    assert flags["failed_values"] == [], f"{trace_file.name}: {flags}"
    assert trace["grounding_check"] == "pass"


EXPECTED_TOOLS = {
    "prompt_01": ["query_actuals"], "prompt_02": ["explain_variance", "detect_anomalies"], "prompt_03": ["detect_anomalies"],
    "prompt_04": ["run_forecast"], "prompt_05": ["detect_anomalies"], "prompt_06": ["get_reporting_health", "get_reporting_health"],
    "prompt_07": ["list_entities"],
}


@pytest.mark.parametrize("name", list(PROMPTS))
def test_trace_tool_sequence(name, replay_loader):
    assert [c["tool"] for c in replay_loader.traces[name]["tool_calls"]] == EXPECTED_TOOLS[name]


def test_trace_05_contains_all_17_ground_truth_records(replay_loader):
    gt = set("BUD-00237 BUD-00189 BUD-00176 BUD-00005 BUD-00190 BUD-00285 BUD-00213 BUD-00267 BUD-00160 BUD-00156 "
             "BUD-00228 BUD-00293 BUD-00087 BUD-00202 BUD-00116 BUD-00028 BUD-00241".split())
    t = replay_loader.traces["prompt_05"]
    in_result = {a["source_record_id"] for a in t["tool_calls"][0]["result"]["anomalies"] if not a["is_synthetic"]}
    assert gt <= in_result
    assert all(r in t["assistant_text"] for r in gt)


@pytest.fixture
def no_creds(monkeypatch):
    monkeypatch.setenv("REPLAY_MODE", "true")
    for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "BEDROCK_MODEL_ID"):
        monkeypatch.delenv(k, raising=False)

    def boom(*a, **k):
        raise AssertionError("boto3 client must not be created in replay mode")
    monkeypatch.setattr("agent.loop.make_bedrock_client", boom)


def _chat(client, message):
    r = client.post("/chat", json={"session_id": "s1", "dataset_id": "sample", "message": message})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    return parse_sse(r.text)


@pytest.mark.parametrize("name,prompt", list(PROMPTS.items()))
def test_replay_no_bedrock_creds(client, no_creds, name, prompt):
    """AC8: the full scripted demo path works without credentials and without ever touching boto3."""
    ev = _chat(client, prompt)
    t = types(ev)
    assert t[0] == "tool_result" and ev[0]["tool"] == "replay" and ev[0]["summary"].startswith(f"Matched {name}")
    assert t[-1] == "[DONE]" and t[-2] == "sources" and t[-3] == "grounding_ok", t[-4:]
    assert "error" not in t and "grounding_flag" not in t
    text = "".join(e["text"] for e in ev if not isinstance(e, str) and e["type"] == "token")
    assert text == json.loads(next(f for f in TRACE_FILES if f.stem.startswith(name)).read_text(encoding="utf-8"))["assistant_text"]
    assert "boto3" not in sys.modules


def test_replay_unknown_prompt_returns_error(client, no_creds):
    ev = _chat(client, "What is the weather today?")
    assert types(ev) == ["error", "[DONE]"]
    assert ev[0]["message"] == "Replay mode is active. This prompt is not in the scripted demo path."


def test_replay_via_request_flag(client, monkeypatch):
    monkeypatch.delenv("REPLAY_MODE", raising=False)
    r = client.post("/chat", json={"session_id": "s2", "dataset_id": "x", "message": PROMPTS["prompt_01"], "replay_mode": True})
    assert "grounding_ok" in types(parse_sse(r.text))


def test_replay_07_bursar_returns_insufficient_data(replay_loader):
    t = replay_loader.traces["prompt_07"]
    text = t["assistant_text"]
    depts = t["tool_calls"][0]["result"]["entities"]["departments"]
    assert len(depts) == 21 and all(d in text for d in depts)
    assert "insufficient data" in text.lower() and "$" not in text and "%" not in text
