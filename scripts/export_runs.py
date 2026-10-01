"""Export production analyses from the AI Runs list into evals/results, so the demo and the evals share one format.

    python scripts/export_runs.py ai-runs.json sops.json

ai-runs.json: AI Runs items (SharePoint REST, odata=nometadata). sops.json: SOPs library items with ID and FileLeafRef.
Writes evals/results/<prompt>/<sop>.json and appends a row per SOP to evals/results/runs.csv.
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main(runs_file, sops_file):
    stems = {s["ID"]: Path(s["FileLeafRef"]).stem for s in json.load(open(sops_file))["value"]}
    runs = [r for r in json.load(open(runs_file))["value"] if r["RunStatus"] == "Succeeded" and r.get("RawOutput")]
    latest = {}
    for r in sorted(runs, key=lambda r: r["Created"]):
        latest[int(r["SOPId"])] = r

    log = ROOT / "evals/results/runs.csv"
    existing = {(row["sop"], row["prompt"]) for row in csv.DictReader(open(log))}
    with open(log, "a", newline="") as f:
        writer = csv.writer(f)
        for sop_id, r in sorted(latest.items()):
            stem, prompt = stems[sop_id], r["PromptVersion"]
            analysis = json.loads(r["RawOutput"])
            out = ROOT / "evals/results" / prompt / f"{stem}.json"
            out.write_text(json.dumps(analysis, indent=2))
            if (stem, prompt) not in existing:
                writer.writerow([r["Created"].replace("Z", "+00:00"), stem, prompt, r["Model"], int(r["InputTokens"]),
                                 int(r["OutputTokens"]), 0, 0, r["DurationSec"], round(r["CostUSD"], 4),
                                 len(analysis.get("steps", [])), len(analysis.get("decisions", [])),
                                 len(analysis.get("recommendations", []))])
            print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    main(*sys.argv[1:3])
