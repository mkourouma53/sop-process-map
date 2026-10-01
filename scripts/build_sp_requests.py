"""Build the SharePoint REST calls that create the library, lists, and columns.

Output: flows/sp-lists.requests.json, fed to the "SP Setup" flow.
Every row in the result lists links back to its SOP by SOPId (the SOPs library
item ID) rather than a lookup column, which keeps the flow and app code simple.
"""
import json
from pathlib import Path
from xml.sax.saxutils import quoteattr



def text(n, d=None): return ("Text", n, d, {})
def note(n, d=None, unlimited=False): return ("Note", n, d, {"NumLines": "6", "RichText": "FALSE", **({"UnlimitedLengthInDocumentLibrary": "TRUE"} if unlimited else {})})
def num(n, d=None): return ("Number", n, d, {})
def boolean(n, d=None): return ("Boolean", n, d, {})
def choice(n, opts, d=None): return ("Choice", n, d, {"_choices": opts})

SOP = num("SOPId", "SOP ID")
LISTS = {
    ("SOPs", 101): [
        text("Department"), text("ProcessOwner", "Process Owner (email)"),
        choice("SOPStatus", ["Uploaded", "Analyzing", "Analyzed", "In review", "Ready for owner", "With owner", "Changes requested", "Approved", "Failed"], "Status"),
        note("OwnerComments", "Owner Comments", unlimited=True),
        text("SOPVersion", "Version"), text("PromptVersion", "Prompt Version"),
    ],
    ("Process Steps", 100): [
        SOP, num("StepOrder", "Order"), text("Actor"), note("Action"), note("StepInput", "Input"), note("StepOutput", "Output"),
        text("SystemUsed", "System"), text("SourceSection", "Source Section"), note("SourceQuote", "Source Quote"),
        boolean("Inferred"), boolean("Corrected"),
    ],
    ("Decision Points", 100): [
        SOP, text("AfterStep", "After Step"), note("Condition"), note("Branches", "Branches (JSON)"),
        text("SourceSection", "Source Section"), boolean("Inferred"),
    ],
    ("Risks", 100): [
        SOP, text("StepRef", "Step"),
        choice("RiskType", ["manual_handoff", "rekeying", "missing_control", "undefined_exception", "single_point_of_failure", "vague_ownership_or_timing", "conflicting_rule"], "Risk Type"),
        note("Description"), choice("Severity", ["low", "medium", "high"]),
    ],
    ("Recommendations", 100): [
        SOP, text("StepRef", "Step"), choice("Label", ["digitize", "automate", "ai_assist", "eliminate", "keep_human"]),
        note("Reason"), text("SuggestedTool", "Suggested Tool"), num("ValueScore", "Value"), num("EffortScore", "Effort"),
        num("Priority"), choice("RecStatus", ["Proposed", "Approved", "Rejected"], "Status"),
        note("RejectionReason", "Rejection Reason"), note("StarterFlow", "Starter Flow (JSON)"),
        choice("AnalystRec", ["Pending", "Recommend", "Drop"], "Analyst Recommendation"), note("AnalystNote", "Analyst Note"),
        note("ProposedChange", "Proposed Change"),
    ],
    ("Future Steps", 100): [
        SOP, num("StepOrder", "Order"), text("FromStep", "From Step"), text("Actor"), note("Action"),
        choice("ChangeType", ["unchanged", "digitized", "automated", "ai_assisted", "new"], "Change"),
    ],
    ("Review History", 100): [SOP, text("Person"), note("Comments")],
    ("AI Runs", 100): [
        SOP, text("PromptVersion", "Prompt Version"), text("Model"), num("InputTokens", "Input Tokens"),
        num("OutputTokens", "Output Tokens"), num("DurationSec", "Duration (s)"), num("CostUSD", "Cost (USD)"),
        choice("RunStatus", ["Succeeded", "Failed"], "Status"), note("ErrorMessage", "Error"),
        note("RawOutput", "Raw Output (JSON)", unlimited=True),
    ],
}

def field_xml(ftype, name, display, attrs):
    choices = attrs.pop("_choices", None)
    a = " ".join(f"{k}={quoteattr(v)}" for k, v in attrs.items())
    xml = f"<Field Type={quoteattr(ftype)} Name={quoteattr(name)} DisplayName={quoteattr(display or name)} {a}"
    if choices:
        return xml + "><CHOICES>" + "".join(f"<CHOICE>{c}</CHOICE>" for c in choices) + "</CHOICES></Field>"
    return xml + "/>"

reqs = []
for (title, template), fields in LISTS.items():
    reqs.append({"method": "POST", "uri": "_api/web/lists", 
                 "body": {"__metadata": {"type": "SP.List"}, "BaseTemplate": template, "Title": title}})
    for ftype, name, display, attrs in fields:
        reqs.append({"method": "POST", "uri": f"_api/web/lists/getbytitle('{title}')/fields/createfieldasxml", 
                     "body": {"parameters": {"__metadata": {"type": "SP.XmlSchemaFieldCreationInformation"},
                                             "SchemaXml": field_xml(ftype, name, display, dict(attrs)), "Options": 24}}})

out = Path(__file__).resolve().parent.parent / "flows" / "sp-lists.requests.json"
out.write_text(json.dumps(reqs, indent=1))
print(len(reqs), "requests ->", out)
