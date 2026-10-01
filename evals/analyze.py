"""Run the SOP analysis prompt on every PDF in evals/sops/ and save the JSON output.

Usage:
    python evals/analyze.py --prompt v1            # all SOPs
    python evals/analyze.py --prompt v1 --only fcc  # SOPs whose filename contains "fcc"

Writes evals/results/<prompt>/<sop>.json and appends a row per run to
evals/results/runs.csv (tokens, duration, cost) -- the same fields the
SharePoint "AI Runs" list stores.
"""

import argparse
import base64
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import anthropic

from env import load_env

ROOT = Path(__file__).resolve().parent.parent
SOP_DIR = ROOT / "evals" / "sops"
RESULTS_DIR = ROOT / "evals" / "results"
MODEL = "claude-opus-5-5"
# Claude Opus 5.5, $ per million tokens. Cache writes cost 1.25x input, cache reads 0.1x.
PRICE_PER_MTOK = {"input": 4.00, "output": 20.00, "cache_write": 5.00, "cache_read": 0.40}

# The full schema is too large for one constrained-decoding grammar, so the
# analysis runs in two calls: the current state map, then everything derived
# from it. Each prompt version's schema.json is the single source of truth for both.
ANALYSIS_KEYS = ["risks", "recommendations", "starter_flows", "future_state", "eliminated_steps"]
MAP_TASK = "Stage 1 of 2: return only the current state map for this SOP (and the section inventory, if the schema asks for one)."
ANALYSIS_TASK = ("Stage 2 of 2: here is the current state map for this SOP. Using the SOP and this map, return the risks, "
                 "recommendations, starter flows, and future state. Refer to steps by the ids in the map.\n\n{map_json}")


def load_prompt(version: str) -> tuple[str, dict]:
    system = (ROOT / "prompts" / version / "system.md").read_text()
    schema = json.loads((ROOT / "prompts" / version / "schema.json").read_text())
    return system, schema


def sub_schema(schema: dict, keys: list[str]) -> dict:
    return {**schema, "properties": {k: schema["properties"][k] for k in keys}, "required": keys}


def is_transient(e: anthropic.APIError) -> bool:
    """Overloaded, rate-limited, 5xx, or dropped-connection errors are worth retrying."""
    if isinstance(e, (anthropic.RateLimitError, anthropic.InternalServerError, anthropic.APIConnectionError)):
        return True
    # Errors raised mid-stream arrive as a plain APIError carrying the error body.
    body = e.body if isinstance(e.body, dict) else {}
    return body.get("error", {}).get("type") in ("overloaded_error", "api_error")


def call(client: anthropic.Anthropic, system: str, document: dict, task: str, schema: dict, attempts: int = 4) -> tuple[dict, anthropic.types.beta.BetaUsage]:
    for attempt in range(1, attempts + 1):
        try:
            with client.beta.messages.stream(
                model=MODEL,
                max_tokens=64000,
                system=system,
                thinking={"type": "adaptive"},
                output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema}},
                # Re-runs on a fallback model if a safety classifier declines the request.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                messages=[{"role": "user", "content": [document, {"type": "text", "text": task}]}],
            ) as stream:
                message = stream.get_final_message()
            break
        except anthropic.APIError as e:
            if attempt == attempts or not is_transient(e):
                raise
            wait = 30 * attempt
            print(f"  transient API error ({e.__class__.__name__}); retrying in {wait}s", flush=True)
            time.sleep(wait)

    if message.stop_reason == "refusal":
        raise RuntimeError(f"Refused: {message.stop_details}")
    if message.stop_reason == "max_tokens":
        raise RuntimeError("Output hit max_tokens; the SOP is probably too long. Cut it to one chapter.")
    text = next(b.text for b in message.content if b.type == "text")
    return json.loads(text), message.usage


def analyze(client: anthropic.Anthropic, pdf: Path, system: str, schema: dict) -> tuple[dict, dict, float]:
    data = base64.standard_b64encode(pdf.read_bytes()).decode()
    # Not cached: the two calls use different output schemas, which breaks the shared prefix.
    document = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}}
    start = time.monotonic()
    map_keys = [k for k in schema["properties"] if k not in ANALYSIS_KEYS]
    process_map, u1 = call(client, system, document, MAP_TASK, sub_schema(schema, map_keys))
    analysis, u2 = call(client, system, document, ANALYSIS_TASK.format(map_json=json.dumps(process_map)),
                        sub_schema(schema, ANALYSIS_KEYS))
    duration = time.monotonic() - start

    usage = {k: (getattr(u1, k) or 0) + (getattr(u2, k) or 0) for k in
             ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")}
    return {**process_map, **analysis}, usage, duration


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", default="v1")
    parser.add_argument("--only", default="", help="substring filter on SOP filename")
    args = parser.parse_args()

    system, schema = load_prompt(args.prompt)
    out_dir = RESULTS_DIR / args.prompt
    out_dir.mkdir(parents=True, exist_ok=True)
    runs_csv = RESULTS_DIR / "runs.csv"
    new_file = not runs_csv.exists()

    load_env()
    client = anthropic.Anthropic()
    pdfs = sorted(p for p in SOP_DIR.glob("*.pdf") if args.only in p.stem)
    if not pdfs:
        raise SystemExit(f"No PDFs in {SOP_DIR} matching '{args.only}'")

    with runs_csv.open("a", newline="") as f:
        writer = csv.writer(f)
        if new_file:
            writer.writerow(["timestamp", "sop", "prompt", "model", "input_tokens", "output_tokens", "cache_write_tokens",
                             "cache_read_tokens", "duration_s", "cost_usd", "steps", "decisions", "recommendations"])
        for pdf in pdfs:
            print(f"Analyzing {pdf.name} ...", flush=True)
            try:
                result, u, duration = analyze(client, pdf, system, schema)
            except (anthropic.APIError, RuntimeError) as e:
                print(f"  FAILED: {e}")
                continue
            (out_dir / f"{pdf.stem}.json").write_text(json.dumps(result, indent=2))
            cost = (u["input_tokens"] * PRICE_PER_MTOK["input"] + u["output_tokens"] * PRICE_PER_MTOK["output"]
                    + u["cache_creation_input_tokens"] * PRICE_PER_MTOK["cache_write"]
                    + u["cache_read_input_tokens"] * PRICE_PER_MTOK["cache_read"]) / 1_000_000
            writer.writerow([
                datetime.now(timezone.utc).isoformat(timespec="seconds"), pdf.stem, args.prompt, MODEL,
                u["input_tokens"], u["output_tokens"], u["cache_creation_input_tokens"], u["cache_read_input_tokens"],
                round(duration, 1), round(cost, 4),
                len(result["steps"]), len(result["decisions"]), len(result["recommendations"]),
            ])
            f.flush()
            print(f"  {len(result['steps'])} steps, {len(result['decisions'])} decisions, "
                  f"{len(result['recommendations'])} recommendations | {duration:.0f}s, ${cost:.3f}")


if __name__ == "__main__":
    main()
