"""Build the public demo's data file from saved analysis results.

Reads evals/results/<prompt>/<sop>.json and writes app/src/demo/demo-data.json in the same
shape the SharePoint lists return, so the demo build runs the exact same screens with no
sign-in and no AI calls.

Usage: python scripts/build_demo_data.py --prompt v2
"""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TITLES = {
    "01-fcc-purchase-card": ("FCC purchase card directive (FCCINST 1097.6)", "Government procurement"),
    "02-navy-netc-purchase-card": ("Navy NETC purchase card procedures (NETCINST 4200.4A)", "Defense"),
    "03-sba-loan-servicing": ("SBA 7(a) loan servicing requests (SOP 50 57 4, ch. 6)", "Financial services"),
    "04-vha-adverse-event-disclosure": ("VHA disclosure of adverse events (Directive 1004.08)", "Healthcare"),
    "05-oregon-osha-lockout-tagout": ("Oregon OSHA sample lockout/tagout policy", "Manufacturing and safety"),
    "06-fda-purchasing-receipt": ("FDA lab purchasing and receipt (ORA-LAB.4.6)", "Life sciences"),
    "07-usda-aphis-onboarding": ("USDA APHIS supervisor onboarding guide", "HR"),
    "08-nih-ntrr-access-request": ("NIH NTRR account and data access request (SOP-01)", "IT and data access"),
    "09-epa-power-shutoff": ("EPA public safety power shutoff SOP", "Utilities"),
    "10-portland-public-works-appeal": ("Portland public works appeal process", "Local government"),
}


def choice(v):
    return {"Value": v}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", default="v2")
    args = parser.parse_args()

    runs = {r["sop"]: r for r in csv.DictReader(open(ROOT / "evals/results/runs.csv")) if r["prompt"] == args.prompt}
    data = {k: [] for k in ("sops", "steps", "decisions", "risks", "recommendations", "future", "runs")}
    next_id = iter(range(1, 1_000_000))

    results = sorted(p for p in (ROOT / "evals/results" / args.prompt).glob("[0-9][0-9]-*.json")
                     if not p.name.endswith((".judge.json", ".grounding.json")))
    for sop_id, path in enumerate(results, start=1):
        stem = path.stem
        a = json.loads(path.read_text())
        title, dept = TITLES.get(stem, (a.get("sop_title", stem), ""))
        data["sops"].append({"ID": sop_id, "{Name}": f"{stem}.pdf", "Title": title, "Department": dept,
                             "SOPStatus": choice("Analyzed"), "PromptVersion": args.prompt, "ProcessOwner": "",
                             "Modified": runs.get(stem, {}).get("timestamp", "")})
        for s in a["steps"]:
            data["steps"].append({"ID": next(next_id), "Title": s["id"], "SOPId": sop_id, "StepOrder": int(s["id"].lstrip("S") or 0),
                                  "Actor": s["actor"], "Action": s["action"], "StepInput": s["input"], "StepOutput": s["output"],
                                  "SystemUsed": s["system"], "SourceSection": s["source_section"], "SourceQuote": s["source_quote"],
                                  "Inferred": s["inferred"], "Corrected": False})
        for d in a["decisions"]:
            data["decisions"].append({"ID": next(next_id), "Title": d["id"], "SOPId": sop_id, "AfterStep": d["after_step"],
                                      "Condition": d["condition"], "Branches": json.dumps(d["branches"]),
                                      "SourceSection": d["source_section"], "Inferred": d["inferred"]})
        for r in a["risks"]:
            data["risks"].append({"ID": next(next_id), "Title": r["id"], "SOPId": sop_id, "StepRef": r["step"],
                                  "RiskType": choice(r["risk_type"]), "Description": r.get("what_could_go_wrong") or r.get("description", ""), "Severity": choice(r["severity"])})
        flows = {f["recommendation_id"]: f for f in a.get("starter_flows", [])}
        for r in a["recommendations"]:
            data["recommendations"].append({"ID": next(next_id), "Title": r["id"], "SOPId": sop_id, "StepRef": r["step"],
                                            "Label": choice(r["label"]), "Reason": r["reason"], "SuggestedTool": r["suggested_tool"],
                                            "ValueScore": r["value"], "EffortScore": r["effort"], "Priority": r["value"] / r["effort"],
                                            "RecStatus": choice("Proposed"), "RejectionReason": "",
                                            "StarterFlow": json.dumps(flows[r["id"]]) if r["id"] in flows else ""})
        for f in a["future_state"]:
            data["future"].append({"ID": next(next_id), "Title": f["id"], "SOPId": sop_id, "StepOrder": int(f["id"].lstrip("F") or 0),
                                   "FromStep": f["from_step"], "Actor": f["actor"], "Action": f["action"], "ChangeType": choice(f["change"])})
        data["runs"].append({"ID": next(next_id), "SOPId": sop_id, "Model": runs.get(stem, {}).get("model", "claude-opus-5-5"),
                             "PromptVersion": args.prompt,
                             "RawOutput": json.dumps(a)})

    out = ROOT / "app/src/demo/demo-data.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"{len(data['sops'])} SOPs, {len(data['steps'])} steps -> {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
