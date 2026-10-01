"""Score AI output against the hand-mapped golden set.

Usage:
    python evals/score.py --prompt v1

For every SOP that has both evals/golden/<sop>.json and
evals/results/<prompt>/<sop>.json, a judge call matches AI steps and decisions
to golden ones. Verdicts are saved next to the results (<sop>.judge.json) so you
can hand-check 20% of them, and a summary table is written to
evals/results/<prompt>/scores.md.

Metrics computed here:
  step recall      golden steps the AI captured / golden steps
  step precision   AI steps matching a golden step / AI steps
  in-scope prec.   same, counting only AI steps from top-level sections the human mapped
                   (separates "invented" from "mapped more of the document than the human")
  unsupported      AI steps with no golden match that a grounding check, reading the SOP,
                   finds no support for (the hallucination rate)
  grounded prec.   (AI steps - unsupported) / AI steps
  decision acc.    golden decisions with correct condition and branches / golden decisions
Grounding, label agreement, and time saved are recorded by hand in
evals/results/<prompt>/manual.csv.
"""

import argparse
import base64
import json
import re
from pathlib import Path

import anthropic

from env import load_env

ROOT = Path(__file__).resolve().parent.parent
GOLDEN_DIR = ROOT / "evals" / "golden"
SOP_DIR = ROOT / "evals" / "sops"
RESULTS_DIR = ROOT / "evals" / "results"
MODEL = "claude-opus-5-5"

JUDGE_SYSTEM = """You compare two process maps of the same SOP: a GOLDEN map made by a human analyst and an AI map.

Steps: for each golden step, find the AI step that describes the same action by the same (or an equivalent) actor. One AI step may match at most one golden step. Wording differences are fine; a different actor or a materially different action is not a match. If the AI merged two golden steps into one, match it to the more important one and leave the other unmatched.

Decisions: for each golden decision, find the AI decision with the same condition. Mark it correct only if the condition is equivalent AND the branches lead to equivalent outcomes.

Give a one-sentence reason for every verdict so a human can audit you."""

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "step_matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "golden_id": {"type": "string"},
                    "ai_id": {"type": "string", "description": "Matching AI step id, or NONE"},
                    "reason": {"type": "string"},
                },
                "required": ["golden_id", "ai_id", "reason"],
                "additionalProperties": False,
            },
        },
        "decision_matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "golden_id": {"type": "string"},
                    "ai_id": {"type": "string", "description": "Matching AI decision id, or NONE"},
                    "correct": {"type": "boolean"},
                    "reason": {"type": "string"},
                },
                "required": ["golden_id", "ai_id", "correct", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["step_matches", "decision_matches"],
    "additionalProperties": False,
}


def map_view(m: dict) -> dict:
    """Only the parts of the map the judge needs."""
    return {
        "steps": [{k: s[k] for k in ("id", "actor", "action")} for s in m["steps"]],
        "decisions": [{k: d[k] for k in ("id", "after_step", "condition", "branches")} for d in m["decisions"]],
    }


GROUNDING_SYSTEM = """You check whether process steps are supported by an SOP. For each step, read the cited section
(and the rest of the document if needed) and decide:
- supported: the SOP states this action by this actor (wording may differ).
- partially_supported: the action is in the SOP but the actor, timing, or a detail is wrong or added.
- unsupported: the SOP does not state this action; it is invented or only loosely implied.
Give a one-sentence reason quoting or pointing to the SOP text."""

GROUNDING_SCHEMA = {
    "type": "object",
    "properties": {
        "verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ai_id": {"type": "string"},
                    "verdict": {"type": "string", "enum": ["supported", "partially_supported", "unsupported"]},
                    "reason": {"type": "string"},
                },
                "required": ["ai_id", "verdict", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["verdicts"],
    "additionalProperties": False,
}


def ground(client: anthropic.Anthropic, pdf: Path, steps: list[dict]) -> dict:
    """Check AI steps the judge could not match against the SOP itself."""
    if not steps:
        return {"verdicts": []}
    data = base64.standard_b64encode(pdf.read_bytes()).decode()
    view = [{k: s[k] for k in ("id", "actor", "action", "source_section", "source_quote")} for s in steps]
    with client.messages.stream(
        model=MODEL,
        max_tokens=32000,
        system=GROUNDING_SYSTEM,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": GROUNDING_SCHEMA}},
        messages=[{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}},
            {"type": "text", "text": f"Check each of these steps against the SOP:\n{json.dumps(view, indent=1)}"},
        ]}],
    ) as stream:
        response = stream.get_final_message()
    if response.stop_reason == "refusal":
        raise RuntimeError(f"Grounding check refused: {response.stop_details}")
    return json.loads(next(b.text for b in response.content if b.type == "text"))


def top_section(source: str) -> str | None:
    """'6.C.1' -> '6', '10.b.6; 7.e' -> '10', 'Initiation, step 2' -> None."""
    m = re.match(r"\D{0,2}(\d+)", source.strip())
    return m.group(1) if m else None


def in_scope_ai_steps(golden: dict, ai: dict) -> int:
    """AI steps from top-level sections the human mapped. If the golden map has no
    numbered sections, the whole document is in scope."""
    scope = {top_section(s["source_section"]) for s in golden["steps"]} - {None}
    if not scope:
        return len(ai["steps"])
    return sum(1 for s in ai["steps"] if top_section(s["source_section"]) in scope)


def judge(client: anthropic.Anthropic, golden: dict, ai: dict) -> dict:
    with client.messages.stream(
        model=MODEL,
        max_tokens=16000,
        system=JUDGE_SYSTEM,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": JUDGE_SCHEMA}},
        messages=[{
            "role": "user",
            "content": f"GOLDEN MAP:\n{json.dumps(map_view(golden), indent=1)}\n\nAI MAP:\n{json.dumps(map_view(ai), indent=1)}",
        }],
    ) as stream:
        response = stream.get_final_message()
    if response.stop_reason == "refusal":
        raise RuntimeError(f"Judge refused: {response.stop_details}")
    return json.loads(next(b.text for b in response.content if b.type == "text"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", default="v1")
    args = parser.parse_args()
    out_dir = RESULTS_DIR / args.prompt

    load_env()
    client = anthropic.Anthropic()
    rows = []
    totals = {"golden_steps": 0, "matched": 0, "ai_steps": 0, "in_scope": 0, "unsupported": 0, "golden_dec": 0, "dec_ok": 0}

    for golden_path in sorted(GOLDEN_DIR.glob("*.json")):
        if golden_path.name.startswith("_"):
            continue
        ai_path = out_dir / golden_path.name
        if not ai_path.exists():
            print(f"skip {golden_path.stem}: no AI result for {args.prompt}")
            continue
        golden, ai = json.loads(golden_path.read_text()), json.loads(ai_path.read_text())
        verdict = judge(client, golden, ai)
        (out_dir / f"{golden_path.stem}.judge.json").write_text(json.dumps(verdict, indent=2))

        matched = sum(1 for m in verdict["step_matches"] if m["ai_id"] != "NONE")
        dec_ok = sum(1 for d in verdict["decision_matches"] if d["correct"])
        matched_ids = {m["ai_id"] for m in verdict["step_matches"]}
        grounding = ground(client, SOP_DIR / f"{golden_path.stem}.pdf", [s for s in ai["steps"] if s["id"] not in matched_ids])
        (out_dir / f"{golden_path.stem}.grounding.json").write_text(json.dumps(grounding, indent=2))
        unsupported = sum(1 for v in grounding["verdicts"] if v["verdict"] == "unsupported")

        g_steps, a_steps, g_dec = len(golden["steps"]), len(ai["steps"]), len(golden["decisions"])
        in_scope = in_scope_ai_steps(golden, ai)
        rows.append((golden_path.stem, matched / g_steps, matched / a_steps if a_steps else 0.0,
                     matched / in_scope if in_scope else 0.0, unsupported, (a_steps - unsupported) / a_steps if a_steps else 0.0,
                     dec_ok / g_dec if g_dec else 1.0, g_steps, a_steps, in_scope))
        for k, v in (("golden_steps", g_steps), ("matched", matched), ("ai_steps", a_steps), ("in_scope", in_scope),
                     ("unsupported", unsupported), ("golden_dec", g_dec), ("dec_ok", dec_ok)):
            totals[k] += v

    if not rows:
        raise SystemExit("Nothing to score. Add golden maps to evals/golden/ and run analyze.py first.")

    lines = [f"# Scores: prompt {args.prompt}", "",
             "| SOP | Step recall | Step precision | In-scope precision | Unsupported steps | Grounded precision | Decision accuracy | Golden steps | AI steps (in scope) |",
             "|---|---|---|---|---|---|---|---|---|"]
    lines += [f"| {s} | {r:.0%} | {p:.0%} | {ip:.0%} | {u} | {gp:.0%} | {d:.0%} | {g} | {a} ({n}) |" for s, r, p, ip, u, gp, d, g, a, n in rows]
    lines.append(
        f"| **All (pooled)** | **{totals['matched'] / totals['golden_steps']:.0%}** "
        f"| **{totals['matched'] / totals['ai_steps']:.0%}** "
        f"| **{totals['matched'] / totals['in_scope']:.0%}** "
        f"| **{totals['unsupported']}** "
        f"| **{(totals['ai_steps'] - totals['unsupported']) / totals['ai_steps']:.0%}** "
        f"| **{(totals['dec_ok'] / totals['golden_dec']) if totals['golden_dec'] else 1:.0%}** "
        f"| {totals['golden_steps']} | {totals['ai_steps']} ({totals['in_scope']}) |")
    (out_dir / "scores.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
