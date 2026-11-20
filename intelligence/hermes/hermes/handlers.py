"""Increment-1 skill handlers — registered, validated, permissioned.

The production control plane starts fail-closed: NOTHING is routable until a
handler is registered for its task type through this module (`register_
increment_one_skills`), which is reviewed code, not runtime input.

Both handlers are deterministic (no model calls, no spend) and honest about
what they do:

- ORIENT_PRODUCT_FACTS (msk-001): grounds answers in the APPROVED DOC
  EXCERPTS SUPPLIED IN THE PAYLOAD. It never invents facts — a missing or
  empty doc_refs input is a refusal, unknowns stay unknown.
- RUN_SEARCH_RELEVANCE_EVAL (msk-006): runs the repository's fixed offline
  benchmark command (bun run intelligence/eval/run-benchmark.ts) and reports
  the metrics VERBATIM from the generated report. It cannot modify weights
  or fixtures (the manifest forbids it; the handler executes one fixed,
  read-only command).

Permissions: before a handler runs, the caller's skill manifest must declare
the task type (router) and the handler validates its inputs. Execution is
bounded by the task budget (steps/time/tool-calls) and the eval handler by a
subprocess timeout.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Callable, Optional

from .budget import BudgetState
from .contracts import TaskResult, TaskTimeout
from .errors import HermesError

REPO_ROOT = Path(__file__).resolve().parents[4]
EVAL_COMMAND = ["bun", "run", "intelligence/eval/run-benchmark.ts"]
EVAL_TIMEOUT_SECONDS = 120


def orient_product_facts(payload: dict, budget: BudgetState) -> TaskResult:
    """Grounded orientation from approved doc excerpts supplied by the caller.

    Payload contract (validated here, at runtime):
      doc_refs: [{ref: str(1..128), excerpt: str(1..2000)}]  — 1..10 entries
      question: str(1..256)

    Honesty: only the supplied excerpts are restated. The handler asserts no
    facts of its own; a missing question or doc set is a REFUSAL, not a guess.
    """
    doc_refs = payload.get("doc_refs")
    question = payload.get("question")
    if not isinstance(question, str) or not (1 <= len(question) <= 256):
        raise HermesError("PAYLOAD_INVALID", "question must be a string of 1..256 chars")
    if not isinstance(doc_refs, list) or not (1 <= len(doc_refs) <= 10):
        raise HermesError("PAYLOAD_INVALID", "doc_refs must be a list of 1..10 approved doc entries")

    budget.check_cancel()
    budget.begin_tool_call()  # reading approved docs is the declared tool

    grounds: list[str] = []
    reason_codes: list[str] = []
    for entry in doc_refs:
        if not isinstance(entry, dict):
            raise HermesError("PAYLOAD_INVALID", "each doc_ref must be an object")
        ref = entry.get("ref")
        excerpt = entry.get("excerpt")
        if not isinstance(ref, str) or not (1 <= len(ref) <= 128):
            raise HermesError("PAYLOAD_INVALID", "doc ref must be a string of 1..128 chars")
        if not isinstance(excerpt, str) or not (1 <= len(excerpt) <= 2000):
            raise HermesError("PAYLOAD_INVALID", "doc excerpt must be a string of 1..2000 chars")
        grounds.append(f"[{ref}] {excerpt}")
        reason_codes.append(f"SOURCE:{ref}"[:64])

    summary = (
        f"Grounded answer for: {question[:120]}. "
        f"Based on {len(grounds)} approved excerpt(s): "
        + " | ".join(g[:160] for g in grounds)
    )[:400]

    return TaskResult(
        summary=summary,
        confidence=None,  # no calibrated confidence without a reviewed model
        reason_codes=reason_codes[:16] or ["SOURCE:UNKNOWN"],
        warnings=["answers are grounded ONLY in caller-supplied approved excerpts; anything else is unknown"],
    )


def run_search_relevance_eval(payload: dict, budget: BudgetState) -> TaskResult:
    """Run the fixed offline benchmark and report metrics verbatim.

    Honesty: this is the SYNTHETIC-fixture benchmark. The result summary
    carries the report's own synthetic-data notice; no production claim is
    possible from this handler.
    """
    budget.check_cancel()
    budget.begin_tool_call()  # bun_run_eval — the one allowlisted tool

    out_dir = REPO_ROOT / "intelligence" / "eval" / "reports"
    out_path = out_dir / "hermes-eval-latest.json"
    command = [*EVAL_COMMAND, "--out", str(out_path)]
    try:
        completed = subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=EVAL_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise TaskTimeout("EVAL_SUBPROCESS_TIMEOUT") from error
    if completed.returncode != 0:
        # Bounded, class-level failure info — never stderr dumps to clients.
        raise RuntimeError("EVAL_COMMAND_FAILED")

    try:
        report = json.loads(out_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("EVAL_REPORT_UNREADABLE") from error

    aggregates = report.get("aggregates", {})
    pipeline = aggregates.get("pipeline", {})
    baseline = aggregates.get("baseline", {})
    summary = (
        "SYNTHETIC offline benchmark (pipeline vs recency baseline): "
        f"nDCG@5 {pipeline.get('mean_ndcg5')} vs {baseline.get('mean_ndcg5')}; "
        f"P@5 {pipeline.get('mean_precision5')} vs {baseline.get('mean_precision5')}; "
        f"R@10 {pipeline.get('mean_recall10')} vs {baseline.get('mean_recall10')}; "
        f"MRR {pipeline.get('mean_mrr')} vs {baseline.get('mean_mrr')}; "
        f"zero-result rate {pipeline.get('zero_result_rate')}. "
        "Not a production claim."
    )[:400]

    return TaskResult(
        summary=summary,
        result_ref=str(out_path.relative_to(REPO_ROOT))[:256],
        confidence=None,
        reason_codes=["SYNTHETIC_FIXTURES", "EVAL_REPORT_VERBATIM"],
        warnings=["fixtures are synthetic and author-graded; see eval/README.md"],
    )


def register_increment_one_skills(backend, *, eval_runner: Optional[Callable[[dict, BudgetState], TaskResult]] = None) -> None:
    """Register the reviewed Increment-1 handlers (reviewed deployment code —
    the production default backend stays fail-closed empty until this runs).
    `eval_runner` is injectable for deterministic tests."""
    backend.register("ORIENT_PRODUCT_FACTS", orient_product_facts)
    backend.register("RUN_SEARCH_RELEVANCE_EVAL", eval_runner or run_search_relevance_eval)


def describe_registered_skills(backend) -> list[dict[str, Any]]:
    return [{"task_type": task_type, "backend": backend.name} for task_type in backend.registered_types()]
