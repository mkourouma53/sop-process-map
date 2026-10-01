"""Small Dataverse Web API helper (auth through the Azure CLI sign-in).

Used to set up the solution that holds flows the code app calls directly:
  python scripts/dataverse.py setup     # publisher, solution, API key variable, SharePoint connection reference
"""
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ORG = "https://orge95d7c82.crm.dynamics.com"
SOLUTION = "SOPProcessMap"
PREFIX = "onyx"


def token() -> str:
    return subprocess.check_output(["az", "account", "get-access-token", "--resource", ORG, "--query", "accessToken", "-o", "tsv"]).decode().strip()


def call(method: str, path: str, body: dict | None = None, solution: bool = False) -> dict:
    headers = {"Authorization": f"Bearer {token()}", "Accept": "application/json", "Content-Type": "application/json",
               "OData-Version": "4.0", "Prefer": "return=representation"}
    if solution:
        headers["MSCRM.SolutionUniqueName"] = SOLUTION
    req = urllib.request.Request(f"{ORG}/api/data/v9.2/{path}", method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:600]}")


def get(path: str, **query) -> list:
    q = "&".join(f"${k}={urllib.parse.quote(v)}" for k, v in query.items())
    return call("GET", f"{path}?{q}").get("value", [])


def setup():
    pub = get("publishers", select="publisherid,uniquename", filter=f"uniquename eq '{PREFIX}'")
    if not pub:
        pub = [call("POST", "publishers", {"uniquename": PREFIX, "friendlyname": "Onyx", "customizationprefix": PREFIX,
                                           "customizationoptionvalueprefix": 72100})]
    pub_id = pub[0]["publisherid"]

    if not get("solutions", select="solutionid", filter=f"uniquename eq '{SOLUTION}'"):
        call("POST", "solutions", {"uniquename": SOLUTION, "friendlyname": "SOP to Process Map", "version": "1.0.0.0",
                                   "publisherid@odata.bind": f"/publishers({pub_id})"})

    var = f"{PREFIX}_ClaudeApiKey"
    if not get("environmentvariabledefinitions", select="schemaname", filter=f"schemaname eq '{var}'"):
        # String type; the value is entered by the owner in the solution UI and never stored in the repo.
        call("POST", "environmentvariabledefinitions", {
            "schemaname": var, "displayname": "Claude API key",
            "description": "Anthropic API key used by the Ask SOP flow. Set the current value in the solution.",
            "type": 100000000}, solution=True)

    ref = f"{PREFIX}_sharepointonline"
    if not get("connectionreferences", select="connectionreferencelogicalname", filter=f"connectionreferencelogicalname eq '{ref}'"):
        call("POST", "connectionreferences", {
            "connectionreferencelogicalname": ref, "connectionreferencedisplayname": "SharePoint (SOP Process Map)",
            "connectorid": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
            "connectionid": "shared-sharepointonl-4f4169e3"}, solution=True)
    print("solution, API key variable, and SharePoint connection reference are ready")


if __name__ == "__main__" and sys.argv[1] == "setup":
    setup()


# Connector -> (connection reference logical name, existing connection in the environment)
CONNECTIONS = {
    "shared_sharepointonline": (f"{PREFIX}_sharepointonline", "shared-sharepointonl-4f4169e3"),
    "shared_office365": (f"{PREFIX}_office365", "shared-office365-5b37ed52"),
    "shared_wordonlinebusiness": (f"{PREFIX}_wordonlinebusiness", "shared-wordonlinebus-f7fe6917"),
}


def ensure_variable(schema: str, display: str, default: str, description: str = ""):
    """String environment variable in the solution (server-side settings flows read)."""
    found = get("environmentvariabledefinitions", select="environmentvariabledefinitionid", filter=f"schemaname eq '{schema}'")
    if found:
        call("PATCH", f"environmentvariabledefinitions({found[0]['environmentvariabledefinitionid']})", {"defaultvalue": default})
    else:
        call("POST", "environmentvariabledefinitions", {"schemaname": schema, "displayname": display, "description": description,
                                                        "type": 100000000, "defaultvalue": default}, solution=True)


def ensure_connection_reference(connector: str):
    ref, connection = CONNECTIONS[connector]
    if not get("connectionreferences", select="connectionreferencelogicalname", filter=f"connectionreferencelogicalname eq '{ref}'"):
        call("POST", "connectionreferences", {
            "connectionreferencelogicalname": ref, "connectionreferencedisplayname": f"{connector.replace('shared_', '')} (SOP Process Map)",
            "connectorid": f"/providers/Microsoft.PowerApps/apis/{connector}", "connectionid": connection}, solution=True)


def deploy_flow(name: str, definition_file: str):
    """Create or update a solution-aware cloud flow (so code apps can call it) and turn it on."""
    from pathlib import Path
    definition = json.loads((Path(__file__).resolve().parent.parent / definition_file).read_text())
    used = [c for c in CONNECTIONS if f'"connectionName": "{c}"' in json.dumps(definition)]
    for c in used:
        ensure_connection_reference(c)
    clientdata = json.dumps({"schemaVersion": "1.0.0.0", "properties": {
        "connectionReferences": {c: {"runtimeSource": "embedded", "api": {"name": c},
                                     "connection": {"connectionReferenceLogicalName": CONNECTIONS[c][0]}} for c in used},
        "definition": definition}})
    existing = get("workflows", select="workflowid,statecode", filter=f"name eq '{name}' and category eq 5")
    if existing:
        wid = existing[0]["workflowid"]
        if existing[0]["statecode"] == 1:
            call("PATCH", f"workflows({wid})", {"statecode": 0, "statuscode": 1})
        call("PATCH", f"workflows({wid})", {"clientdata": clientdata})
    else:
        wid = call("POST", "workflows", {"name": name, "category": 5, "type": 1, "primaryentity": "none",
                                         "description": f"{name} (SOP to Process Map)",
                                         "clientdata": clientdata}, solution=True)["workflowid"]
    call("PATCH", f"workflows({wid})", {"statecode": 1, "statuscode": 2})
    print("flow", name, "ready:", wid)


if __name__ == "__main__" and sys.argv[1] == "deploy-flow":
    deploy_flow(sys.argv[2], sys.argv[3])
