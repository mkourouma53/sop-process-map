"""Re-save analysis results to SharePoint one SOP at a time (the save flow replaces previous rows).

Usage: python scripts/reload_sharepoint.py <prompt-version> <save-flow-url-file>
SOP item IDs: 01 FCC = 1, 02 Navy = 2, 08 NIH = 3.
"""
import csv
import json
import subprocess
import sys
import time
import urllib.request

ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
RUNS = ("https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/29763402-3928-e92c-9a69-ef9227209e1d"
        "/flows/5b1e4524-9bc2-4d22-8c39-0d5114478f0e/runs?api-version=2016-11-01&$top=1")
SOP_IDS = {"08-nih-ntrr-access-request": 3, "01-fcc-purchase-card": 1, "02-navy-netc-purchase-card": 2}


def token():
    return subprocess.check_output(["az", "account", "get-access-token", "--resource", "https://service.flow.microsoft.com/",
                                    "--query", "accessToken", "-o", "tsv"]).decode().strip()


def latest_status():
    req = urllib.request.Request(RUNS, headers={"Authorization": "Bearer " + token()})
    return json.load(urllib.request.urlopen(req))["value"][0]["properties"]["status"]


def main(prompt, url_file):
    url = open(url_file).read().strip()
    runs = {r["sop"]: r for r in csv.DictReader(open(ROOT / "evals/results/runs.csv")) if r["prompt"] == prompt}
    for sop, sop_id in SOP_IDS.items():
        r = runs[sop]
        body = {"sopId": sop_id, "promptVersion": prompt, "model": r["model"], "inputTokens": int(r["input_tokens"]),
                "outputTokens": int(r["output_tokens"]), "durationSec": float(r["duration_s"]), "costUSD": float(r["cost_usd"]),
                "analysis": json.loads((ROOT / f"evals/results/{prompt}/{sop}.json").read_text())}
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=120).read()
        start = time.time()
        time.sleep(15)
        while (status := latest_status()) == "Running":
            time.sleep(20)
        print(sop, status, f"{time.time() - start:.0f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
