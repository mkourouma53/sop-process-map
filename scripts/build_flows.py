"""Build Power Automate flow definitions as JSON (written to flows/).

save-sop-analysis: HTTP-triggered. Takes one analysis result (the JSON the prompt returns)
  plus run metadata and writes it to the SharePoint lists, logs an AI run, and marks the
  SOP as Analyzed. The Analyze SOP flow reuses the same logic after calling Claude.
upload-sop-file: HTTP-triggered. Puts a PDF into the SOPs library and returns its item ID.
  Used to seed demo data.
"""
import json
from pathlib import Path

SITE = "https://consultonyx.sharepoint.com/sites/sop-process-map"
NOMETA = {"Accept": "application/json;odata=nometadata", "Content-Type": "application/json;odata=nometadata"}
OUT = Path(__file__).resolve().parent.parent / "flows"


def sp_request(method, uri, body=None, headers=None, run_after=None):
    params = {
        "dataset": SITE,
        "parameters/method": method,
        "parameters/uri": uri,
        "parameters/headers": headers or NOMETA,
    }
    if body is not None:
        params["parameters/body"] = body
    return {
        "type": "OpenApiConnection",
        "inputs": {
            "host": {"connectionName": "shared_sharepointonline", "operationId": "HttpRequest",
                     "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"},
            "parameters": params,
            "authentication": "@parameters('$authentication')",
        },
        "runAfter": run_after or {},
    }


def text(expr, limit=250):
    """Single-line text columns hold 255 characters; trim to stay under."""
    return f"@if(greater(length(coalesce({expr}, '')), {limit}), substring({expr}, 0, {limit}), coalesce({expr}, ''))"


def note(expr):
    return f"@coalesce({expr}, '')"


def add_items(loop_name, list_title, source_expr, fields, run_after, extra_actions=None):
    """Foreach over an analysis array, compose a list item, POST it to SharePoint."""
    compose = f"{loop_name}_item"
    actions = dict(extra_actions or {})
    actions[compose] = {"type": "Compose", "inputs": fields, "runAfter": {k: ["Succeeded"] for k in (extra_actions or {})}}
    actions[f"{loop_name}_post"] = sp_request(
        "POST", f"_api/web/lists/getbytitle('{list_title}')/items", f"@string(outputs('{compose}'))",
        run_after={compose: ["Succeeded"]})
    return {
        "type": "Foreach",
        "foreach": f"@coalesce({source_expr}, json('[]'))",
        "runtimeConfiguration": {"concurrency": {"repetitions": 10}},
        "actions": actions,
        "runAfter": run_after,
    }


def base_definition(trigger_schema):
    return {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {"$connections": {"defaultValue": {}, "type": "Object"},
                       "$authentication": {"defaultValue": {}, "type": "SecureObject"}},
        "triggers": {"manual": {"type": "Request", "kind": "Http", "inputs": {"schema": trigger_schema}}},
        "actions": {},
    }


def save_analysis():
    a = "triggerBody()?['analysis']"
    sop = "triggerBody()?['sopId']"
    it = lambda loop, key: f"items('{loop}')?['{key}']"

    d = base_definition({
        "type": "object",
        "properties": {
            "sopId": {"type": "integer"}, "promptVersion": {"type": "string"}, "model": {"type": "string"},
            "inputTokens": {"type": "integer"}, "outputTokens": {"type": "integer"},
            "durationSec": {"type": "number"}, "costUSD": {"type": "number"}, "analysis": {"type": "object"},
        },
        "required": ["sopId", "analysis"],
    })
    acts = d["actions"]

    acts["Save_steps"] = add_items("Step", "Process Steps", f"{a}?['steps']", {
        "Title": f"@{it('Save_steps', 'id')}",
        "SOPId": f"@{sop}",
        "StepOrder": f"@int(replace({it('Save_steps', 'id')}, 'S', ''))",
        "Actor": text(it("Save_steps", "actor")),
        "Action": note(it("Save_steps", "action")),
        "StepInput": note(it("Save_steps", "input")),
        "StepOutput": note(it("Save_steps", "output")),
        "SystemUsed": text(it("Save_steps", "system")),
        "SourceSection": text(it("Save_steps", "source_section")),
        "SourceQuote": note(it("Save_steps", "source_quote")),
        "Inferred": f"@equals({it('Save_steps', 'inferred')}, true)",
        "Corrected": False,
    }, {})

    acts["Save_decisions"] = add_items("Decision", "Decision Points", f"{a}?['decisions']", {
        "Title": f"@{it('Save_decisions', 'id')}",
        "SOPId": f"@{sop}",
        "AfterStep": text(it("Save_decisions", "after_step")),
        "Condition": note(it("Save_decisions", "condition")),
        "Branches": f"@string(coalesce({it('Save_decisions', 'branches')}, json('[]')))",
        "SourceSection": text(it("Save_decisions", "source_section")),
        "Inferred": f"@equals({it('Save_decisions', 'inferred')}, true)",
    }, {})

    acts["Save_risks"] = add_items("Risk", "Risks", f"{a}?['risks']", {
        "Title": f"@{it('Save_risks', 'id')}",
        "SOPId": f"@{sop}",
        "StepRef": text(it("Save_risks", "step")),
        "RiskType": f"@{it('Save_risks', 'risk_type')}",
        "Description": f"@coalesce({it('Save_risks', 'what_could_go_wrong')}, {it('Save_risks', 'description')}, '')",
        "Severity": f"@{it('Save_risks', 'severity')}",
    }, {})

    rec = "Save_recommendations"
    acts[rec] = add_items("Rec", "Recommendations", f"{a}?['recommendations']", {
        "Title": f"@{it(rec, 'id')}",
        "SOPId": f"@{sop}",
        "StepRef": text(it(rec, "step")),
        "Label": f"@{it(rec, 'label')}",
        "Reason": note(it(rec, "reason")),
        "SuggestedTool": text(it(rec, "suggested_tool")),
        "ValueScore": f"@{it(rec, 'value')}",
        "EffortScore": f"@{it(rec, 'effort')}",
        "Priority": f"@div(float({it(rec, 'value')}), float({it(rec, 'effort')}))",
        "RecStatus": "Proposed",
        "AnalystRec": "Pending",
        "ProposedChange": note(it(rec, "proposed_change")),
        "StarterFlow": "@if(empty(body('Rec_flow')), '', string(first(body('Rec_flow'))))",
    }, {}, extra_actions={
        "Rec_flow": {"type": "Query", "inputs": {
            "from": f"@coalesce({a}?['starter_flows'], json('[]'))",
            "where": f"@equals(item()?['recommendation_id'], {it(rec, 'id')})"}},
    })

    acts["Save_future"] = add_items("Future", "Future Steps", f"{a}?['future_state']", {
        "Title": f"@{it('Save_future', 'id')}",
        "SOPId": f"@{sop}",
        "StepOrder": f"@int(replace({it('Save_future', 'id')}, 'F', ''))",
        "FromStep": text(it("Save_future", "from_step")),
        "Actor": text(it("Save_future", "actor")),
        "Action": note(it("Save_future", "action")),
        "ChangeType": f"@{it('Save_future', 'change')}",
    }, {})

    # Re-analysis replaces the SOP's previous rows (AI Runs keeps its history).
    clear = {}
    for list_title in ("Process Steps", "Decision Points", "Risks", "Recommendations", "Future Steps"):
        key = list_title.replace(" ", "_")
        clear[f"Find_old_{key}"] = sp_request(
            "GET", f"@concat('_api/web/lists/getbytitle(''{list_title}'')/items?$select=ID&$top=5000&$filter=SOPId eq ', string({sop}))")
        clear[f"Delete_old_{key}"] = {
            "type": "Foreach",
            "foreach": f"@body('Find_old_{key}')?['value']",
            "runtimeConfiguration": {"concurrency": {"repetitions": 10}},
            "runAfter": {f"Find_old_{key}": ["Succeeded"]},
            "actions": {f"Delete_{key}_row": sp_request(
                "POST", f"@concat('_api/web/lists/getbytitle(''{list_title}'')/items(', string(items('Delete_old_{key}')?['ID']), ')')",
                headers={**NOMETA, "X-HTTP-Method": "DELETE", "IF-MATCH": "*"})},
        }
    acts["Clear_previous"] = {"type": "Scope", "actions": clear, "runAfter": {}}
    for name in ("Save_steps", "Save_decisions", "Save_risks", "Save_recommendations", "Save_future"):
        acts[name]["runAfter"] = {"Clear_previous": ["Succeeded"]}

    done = {k: ["Succeeded"] for k in ("Save_steps", "Save_decisions", "Save_risks", "Save_recommendations", "Save_future")}
    acts["Run_item"] = {"type": "Compose", "runAfter": done, "inputs": {
        "Title": f"@concat('SOP ', string({sop}), ' / ', coalesce(triggerBody()?['promptVersion'], ''))",
        "SOPId": f"@{sop}",
        "PromptVersion": "@coalesce(triggerBody()?['promptVersion'], '')",
        "Model": "@coalesce(triggerBody()?['model'], '')",
        "InputTokens": "@coalesce(triggerBody()?['inputTokens'], 0)",
        "OutputTokens": "@coalesce(triggerBody()?['outputTokens'], 0)",
        "DurationSec": "@coalesce(triggerBody()?['durationSec'], 0)",
        "CostUSD": "@coalesce(triggerBody()?['costUSD'], 0)",
        "RunStatus": "Succeeded",
        "RawOutput": f"@string({a})",
    }}
    acts["Log_run"] = sp_request("POST", "_api/web/lists/getbytitle('AI Runs')/items", "@string(outputs('Run_item'))",
                                 run_after={"Run_item": ["Succeeded"]})
    acts["Mark_analyzed"] = sp_request(
        "POST", f"@concat('_api/web/lists/getbytitle(''SOPs'')/items(', string({sop}), ')')",
        "@string(json(concat('{\"SOPStatus\":\"Analyzed\",\"PromptVersion\":\"', coalesce(triggerBody()?['promptVersion'], ''), '\"}')))",
        headers={**NOMETA, "X-HTTP-Method": "MERGE", "IF-MATCH": "*"},
        run_after={"Log_run": ["Succeeded"]})
    # Reply immediately: writing ~100 rows can exceed the caller's 2-minute HTTP timeout under
    # SharePoint throttling, and the caller only needs to know the work was accepted.
    acts["Respond"] = {"type": "Response", "kind": "Http", "runAfter": {},
                       "inputs": {"statusCode": 202, "body": {"status": "accepted", "sopId": f"@{sop}"}}}
    return d


def upload_file():
    d = base_definition({
        "type": "object",
        "properties": {"fileName": {"type": "string"}, "contentBase64": {"type": "string"}},
        "required": ["fileName", "contentBase64"],
    })
    d["actions"]["Create_file"] = {
        "type": "OpenApiConnection",
        "inputs": {
            "host": {"connectionName": "shared_sharepointonline", "operationId": "CreateFile",
                     "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"},
            "parameters": {"dataset": SITE, "folderPath": "/SOPs", "name": "@triggerBody()?['fileName']",
                           "body": "@base64ToBinary(triggerBody()?['contentBase64'])"},
            "authentication": "@parameters('$authentication')",
        },
        "runAfter": {},
    }
    d["actions"]["Respond"] = {"type": "Response", "kind": "Http", "runAfter": {"Create_file": ["Succeeded"]},
                               "inputs": {"statusCode": 200, "body": {"itemId": "@body('Create_file')?['ItemId']",
                                                                       "path": "@body('Create_file')?['Path']"}}}
    return d


APP_URL = ("https://apps.powerapps.com/play/e/29763402-3928-e92c-9a69-ef9227209e1d/app/"
           "a4333e05-0428-4211-92bc-0ee35352bb48?tenantId=3c3756a1-7e41-4457-8a14-f8d519ad7494")
SOPS_LIBRARY_ID = "f7d891df-436e-4a6e-b876-36554b5fb08d"


def owner_approval():
    """Owner review. When the analyst sends an SOP to its process owner (status 'Ready for owner'):
    send the owner the analyst's recommended changes with a link to the SOP; on Approve, accept the analyst's
    advice for every change the owner has not already decided in the app; on Reject, return it to the analyst.
    Every step is logged to Review History."""
    item = "triggerBody()"
    sop_id = f"{item}?['ID']"
    d = {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {"$connections": {"defaultValue": {}, "type": "Object"},
                       "$authentication": {"defaultValue": {}, "type": "SecureObject"}},
        "triggers": {"When_SOP_is_sent_to_owner": {
            "type": "OpenApiConnection",
            "recurrence": {"interval": 1, "frequency": "Minute"},
            "splitOn": "@triggerOutputs()?['body/value']",
            "conditions": [{"expression": f"@and(equals({item}?['SOPStatus']?['Value'], 'Ready for owner'), not(empty({item}?['ProcessOwner'])))"}],
            "inputs": {
                "host": {"connectionName": "shared_sharepointonline", "operationId": "GetOnUpdatedFileItems",
                         "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"},
                "parameters": {"dataset": SITE, "table": SOPS_LIBRARY_ID},
                "authentication": "@parameters('$authentication')",
            },
        }},
        "actions": {},
    }
    acts = d["actions"]
    sop_uri = f"@concat('_api/web/lists/getbytitle(''SOPs'')/items(', string({sop_id}), ')')"
    merge = {**NOMETA, "X-HTTP-Method": "MERGE", "IF-MATCH": "*"}
    name = f"{item}?['{{FilenameWithExtension}}']"
    owner = f"{item}?['ProcessOwner']"
    nl = "decodeUriComponent('%0A')"

    def log(key, event_expr, person_expr, comments_expr, run_after):
        """Two actions: compose the Review History row, then post it."""
        acts[f"{key}_row"] = {"type": "Compose", "runAfter": run_after, "inputs": {
            "Title": f"@{event_expr}", "SOPId": f"@{sop_id}", "Person": f"@{person_expr}", "Comments": f"@{comments_expr}"}}
        acts[key] = sp_request("POST", "_api/web/lists/getbytitle('Review History')/items", f"@string(outputs('{key}_row'))",
                               run_after={f"{key}_row": ["Succeeded"]})

    # Moving off 'Ready for owner' first also stops the trigger from firing again for this item.
    acts["Mark_with_owner"] = sp_request("POST", sop_uri, '{"SOPStatus":"With owner","OwnerComments":""}', headers=merge)
    log("Log_sent", "'Sent to process owner'", owner, "''", {"Mark_with_owner": ["Succeeded"]})
    acts["Get_changes"] = sp_request(
        "GET", f"@concat('_api/web/lists/getbytitle(''Recommendations'')/items?$top=5000&$select=ID,Title,StepRef,ProposedChange,Reason,AnalystRec,AnalystNote,RecStatus&$filter=SOPId eq ', string({sop_id}))",
        run_after={"Mark_with_owner": ["Succeeded"]})
    acts["Recommended"] = {"type": "Query", "runAfter": {"Get_changes": ["Succeeded"]},
                           "inputs": {"from": "@body('Get_changes')?['value']", "where": "@equals(item()?['AnalystRec'], 'Recommend')"}}
    acts["Dropped"] = {"type": "Query", "runAfter": {"Get_changes": ["Succeeded"]},
                       "inputs": {"from": "@body('Get_changes')?['value']", "where": "@equals(item()?['AnalystRec'], 'Drop')"}}
    acts["Change_lines"] = {"type": "Select", "runAfter": {"Recommended": ["Succeeded"]}, "inputs": {
        "from": "@body('Recommended')",
        "select": "@concat('- **', item()?['Title'], '** (step ', item()?['StepRef'], '): ', coalesce(item()?['ProposedChange'], item()?['Reason'], ''))"}}
    total = "length(body('Get_changes')?['value'])"
    rec_n, drop_n = "length(body('Recommended'))", "length(body('Dropped'))"
    link = f"concat('{APP_URL}', '&sopId=', string({sop_id}), '&tab=changes')"
    acts["Ask_owner"] = {
        "type": "OpenApiConnectionWebhook",
        "runAfter": {"Change_lines": ["Succeeded"], "Dropped": ["Succeeded"], "Log_sent": ["Succeeded"]},
        "inputs": {
            "host": {"connectionName": "shared_approvals", "operationId": "StartAndWaitForAnApproval",
                     "apiId": "/providers/Microsoft.PowerApps/apis/shared_approvals"},
            "parameters": {
                "approvalType": "Basic",
                "WebhookApprovalCreationInput/title": f"@concat('Approve process changes: ', {name})",
                "WebhookApprovalCreationInput/assignedTo": f"@{owner}",
                "WebhookApprovalCreationInput/details": (
                    f"@concat('The analyst reviewed ', string({total}), ' AI-recommended changes for **', {name}, '** and recommends these ', "
                    f"string({rec_n}), ':', {nl}, {nl}, join(body('Change_lines'), {nl}), {nl}, {nl}, "
                    f"string({drop_n}), ' were dropped and ', string(sub(sub({total}, {rec_n}), {drop_n})), ' are undecided. Open the app to see the current and future process, the risks each change fixes, and to override any item.', "
                    f"{nl}, {nl}, '**Approve** accepts the analyst''s recommendations, keeping any decisions you made in the app. **Reject** sends the review back to the analyst with your comments.')"),
                "WebhookApprovalCreationInput/itemLink": f"@{link}",
                "WebhookApprovalCreationInput/itemLinkDescription": "Review the changes in SOP to Process Map",
                "WebhookApprovalCreationInput/enableNotifications": True,
                "WebhookApprovalCreationInput/enableReassignment": True,
            },
            "authentication": "@parameters('$authentication')",
        },
    }
    response = "first(body('Ask_owner')?['responses'])"
    responder = f"coalesce({response}?['responder']?['displayName'], {owner})"
    comments = f"coalesce({response}?['comments'], '')"
    approved = "equals(body('Ask_owner')?['outcome'], 'Approve')"

    # On approval, changes the owner has not decided in the app follow the analyst's advice.
    undecided = {"type": "Query", "inputs": {"from": "@body('Get_changes')?['value']",
                 "where": "@and(equals(item()?['RecStatus'], 'Proposed'), not(equals(item()?['AnalystRec'], 'Pending')))"}}
    apply_advice = {
        "type": "Foreach", "foreach": "@body('Undecided')", "runAfter": {"Undecided": ["Succeeded"]},
        "runtimeConfiguration": {"concurrency": {"repetitions": 10}},
        "actions": {
            "Decision_fields": {"type": "Compose", "inputs": {
                "RecStatus": "@if(equals(items('Apply_advice')?['AnalystRec'], 'Recommend'), 'Approved', 'Rejected')",
                "RejectionReason": "@if(equals(items('Apply_advice')?['AnalystRec'], 'Recommend'), '', "
                                   "concat('Dropped on analyst advice. ', coalesce(items('Apply_advice')?['AnalystNote'], '')))"}},
            "Set_owner_decision": sp_request(
                "POST", "@concat('_api/web/lists/getbytitle(''Recommendations'')/items(', string(items('Apply_advice')?['ID']), ')')",
                "@string(outputs('Decision_fields'))", headers=merge, run_after={"Decision_fields": ["Succeeded"]})},
    }
    acts["Owner_decision"] = {
        "type": "If", "runAfter": {"Ask_owner": ["Succeeded"]},
        "expression": {"equals": [f"@{approved}", True]},
        "actions": {"Undecided": undecided, "Apply_advice": apply_advice},
        "else": {"actions": {}},
    }
    acts["Outcome"] = {"type": "Compose", "runAfter": {"Owner_decision": ["Succeeded"]}, "inputs": {
        "SOPStatus": f"@if({approved}, 'Approved', 'Changes requested')",
        "OwnerComments": f"@{comments}",
    }}
    acts["Record_outcome"] = sp_request("POST", sop_uri, "@string(outputs('Outcome'))", headers=merge,
                                        run_after={"Outcome": ["Succeeded"]})
    log("Log_outcome", f"if({approved}, 'Approved by process owner', 'Changes requested by process owner')", responder, comments,
        {"Record_outcome": ["Succeeded"]})
    return d

if __name__ == "__main__":
    for name, build in (("save-sop-analysis", save_analysis), ("upload-sop-file", upload_file), ("owner-approval", owner_approval)):
        path = OUT / f"{name}.definition.json"
        path.write_text(json.dumps(build(), indent=2))
        print("wrote", path)


CHAT_SYSTEM = (Path(__file__).resolve().parent.parent / "prompts" / "chat" / "system.md").read_text()
API_KEY_PARAM = "Claude API key (onyx_ClaudeApiKey)"


def ask_sop():
    """Called from the app's Ask AI sidebar. Answers a question from the SOP PDF and its latest analysis,
    with citations. The API key comes from a solution environment variable, never from the app."""
    t = "triggerBody()"
    sop_id = f"{t}?['text']"
    d = {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {
            "$connections": {"defaultValue": {}, "type": "Object"},
            "$authentication": {"defaultValue": {}, "type": "SecureObject"},
            API_KEY_PARAM: {"defaultValue": "", "type": "String", "metadata": {"schemaName": "onyx_ClaudeApiKey"}},
        },
        "triggers": {"manual": {"type": "Request", "kind": "PowerAppV2", "inputs": {"schema": {
            "type": "object",
            "properties": {
                "text": {"title": "sopId", "type": "string", "x-ms-dynamically-added": True, "description": "SOPs library item ID", "x-ms-content-hint": "TEXT"},
                "text_1": {"title": "messages", "type": "string", "x-ms-dynamically-added": True,
                           "description": "JSON array of {role, content} turns ending with the new question", "x-ms-content-hint": "TEXT"},
                "text_2": {"title": "context", "type": "string", "x-ms-dynamically-added": True,
                           "description": "Where the reader is: process and screen", "x-ms-content-hint": "TEXT"},
            },
            "required": ["text", "text_1"],
        }}}},
        "actions": {},
    }
    acts = d["actions"]
    acts["Get_SOP_file"] = sp_request("GET", f"@concat('_api/web/lists/getbytitle(''SOPs'')/items(', {sop_id}, ')/File/$value')",
                                      headers={"Accept": "application/octet-stream"})
    acts["Get_SOP_name"] = sp_request("GET", f"@concat('_api/web/lists/getbytitle(''SOPs'')/items(', {sop_id}, ')?$select=FileLeafRef')")
    acts["Get_analysis"] = sp_request(
        "GET", f"@concat('_api/web/lists/getbytitle(''AI Runs'')/items?$select=RawOutput&$orderby=ID desc&$top=1&$filter=SOPId eq ', {sop_id})")
    first_turn = {
        "role": "user",
        "content": [
            {"type": "document", "title": "@{body('Get_SOP_name')?['FileLeafRef']}", "citations": {"enabled": True},
             "source": {"type": "base64", "media_type": "application/pdf", "data": "@{body('Get_SOP_file')?['$content']}"}},
            # The cache breakpoint covers the SOP and the analysis, so follow-up questions read them from cache.
            {"type": "text", "cache_control": {"type": "ephemeral"},
             "text": "@{concat('AI analysis of this SOP (JSON):', decodeUriComponent('%0A'), coalesce(first(body('Get_analysis')?['value'])?['RawOutput'], '{}'))}"},
            {"type": "text", "text": "@{concat('Reader is on: ', coalesce(triggerBody()?['text_2'], 'the SOP overview'), '. Their questions follow.')}"},
        ],
    }
    acts["Build_request"] = {
        "type": "Compose",
        "runAfter": {"Get_SOP_file": ["Succeeded"], "Get_SOP_name": ["Succeeded"], "Get_analysis": ["Succeeded"]},
        "inputs": {
            "model": "claude-opus-5-5",
            "max_tokens": 4000,
            "output_config": {"effort": "medium"},
            "system": CHAT_SYSTEM,
            "fallbacks": "default",
            "messages": "@json(concat('[', string(outputs('First_turn')), ',', substring(" + f"{t}?['text_1']" + ", 1, sub(length(" + f"{t}?['text_1']" + "), 2)), ']'))",
        },
    }
    acts["First_turn"] = {"type": "Compose", "runAfter": {"Get_SOP_file": ["Succeeded"], "Get_SOP_name": ["Succeeded"], "Get_analysis": ["Succeeded"]},
                          "inputs": first_turn}
    acts["Build_request"]["runAfter"] = {"First_turn": ["Succeeded"]}
    acts["Ask_Claude"] = {
        "type": "Http",
        "runAfter": {"Build_request": ["Succeeded"]},
        "inputs": {
            "method": "POST",
            "uri": "https://api.anthropic.com/v1/messages",
            "headers": {"x-api-key": f"@parameters('{API_KEY_PARAM}')", "anthropic-version": "2023-06-01",
                        "anthropic-beta": "server-side-fallback-2026-07-01", "content-type": "application/json"},
            "body": "@outputs('Build_request')",
        },
        "runtimeConfiguration": {"secureData": {"properties": ["inputs"]}},
        "limit": {"timeout": "PT110S"},
    }
    acts["Respond"] = {
        "type": "Response", "kind": "PowerApp", "runAfter": {"Ask_Claude": ["Succeeded"]},
        "inputs": {"statusCode": 200,
                   "body": {"answer": "@{string(body('Ask_Claude')?['content'])}", "usage": "@{string(body('Ask_Claude')?['usage'])}", "error": ""},
                   "schema": {"type": "object", "properties": {"answer": {"title": "answer", "type": "string", "x-ms-dynamically-added": True},
                                                               "usage": {"title": "usage", "type": "string", "x-ms-dynamically-added": True},
                                                               "error": {"title": "error", "type": "string", "x-ms-dynamically-added": True}}}},
    }
    acts["Respond_error"] = {
        "type": "Response", "kind": "PowerApp", "runAfter": {"Ask_Claude": ["Failed", "TimedOut"]},
        "inputs": {"statusCode": 200,
                   "body": {"answer": "", "usage": "",
                            "error": "@{coalesce(body('Ask_Claude')?['error']?['message'], 'The AI service did not answer. Check the Claude API key in the solution.')}"},
                   "schema": acts["Respond"]["inputs"]["schema"]},
    }
    return d


if __name__ == "__main__":
    path = OUT / "ask-sop.definition.json"
    path.write_text(json.dumps(ask_sop(), indent=2))
    print("wrote", path)


def sp_batch():
    """HTTP-triggered utility: run a list of SharePoint REST calls (schema changes, resets) from a script."""
    d = base_definition({"type": "object", "properties": {"requests": {"type": "array"}}, "required": ["requests"]})
    d["actions"]["Each_request"] = {
        "type": "Foreach", "foreach": "@triggerBody()?['requests']", "runAfter": {},
        "runtimeConfiguration": {"concurrency": {"repetitions": 5}},
        "actions": {"Call": {
            "type": "OpenApiConnection",
            "inputs": {
                "host": {"connectionName": "shared_sharepointonline", "operationId": "HttpRequest",
                         "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"},
                "parameters": {"dataset": SITE, "parameters/method": "@items('Each_request')?['method']",
                               "parameters/uri": "@items('Each_request')?['uri']",
                               "parameters/headers": "@coalesce(items('Each_request')?['headers'], json('{\"Accept\":\"application/json;odata=nometadata\",\"Content-Type\":\"application/json;odata=nometadata\"}'))",
                               "parameters/body": "@if(equals(items('Each_request')?['body'], null), '', string(items('Each_request')?['body']))"},
                "authentication": "@parameters('$authentication')"}}},
    }
    d["actions"]["Respond"] = {"type": "Response", "kind": "Http", "runAfter": {"Each_request": ["Succeeded", "Failed"]},
                               "inputs": {"statusCode": 200, "body": {"status": "@{actions('Each_request')?['status']}"}}}
    return d


if __name__ == "__main__":
    path = OUT / "sp-batch.definition.json"
    path.write_text(json.dumps(sp_batch(), indent=2))


def send_batch():
    """Called by the app when the analyst sends a batch: email the owner every change in batch n with the same
    detail the app shows, plus a link to decide each one in the app, and answer the app with the result.
    (A status-polling trigger was tried first and raced the owner's decisions; see the failure log.)"""
    sop_id = "triggerBody()?['text']"
    batch = "int(triggerBody()?['text_1'])"
    owner, name = "body('Get_SOP')?['ProcessOwner']", "body('Get_SOP')?['FileLeafRef']"
    d = {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {"$connections": {"defaultValue": {}, "type": "Object"},
                       "$authentication": {"defaultValue": {}, "type": "SecureObject"}},
        "triggers": {"manual": {"type": "Request", "kind": "PowerAppV2", "inputs": {"schema": {
            "type": "object",
            "properties": {
                "text": {"title": "sopId", "type": "string", "x-ms-dynamically-added": True, "description": "SOPs library item ID", "x-ms-content-hint": "TEXT"},
                "text_1": {"title": "batch", "type": "string", "x-ms-dynamically-added": True, "description": "Batch number", "x-ms-content-hint": "TEXT"},
            },
            "required": ["text", "text_1"]}}}},
        "actions": {},
    }
    a = d["actions"]
    ok = lambda *names: {n: ["Succeeded"] for n in names}

    a["Get_SOP"] = sp_request("GET", f"@concat('_api/web/lists/getbytitle(''SOPs'')/items(', {sop_id}, ')?$select=ProcessOwner,FileLeafRef')")
    a["Get_batch"] = sp_request("GET", (
        f"@concat('_api/web/lists/getbytitle(''Recommendations'')/items?$top=500&$orderby=Priority desc"
        f"&$select=ID,Title,StepRef,Label,ProposedChange,Reason,SuggestedTool,ValueScore,EffortScore,Priority,AnalystRec,AnalystNote"
        f"&$filter=SOPId eq ', string({sop_id}), ' and BatchNo eq ', string({batch}))"), run_after=ok("Get_SOP"))
    a["Get_steps"] = sp_request("GET", f"@concat('_api/web/lists/getbytitle(''Process Steps'')/items?$top=2000&$select=Title,Actor,Action&$filter=SOPId eq ', string({sop_id}))",
                                run_after=ok("Get_SOP"))
    a["Get_decisions"] = sp_request("GET", f"@concat('_api/web/lists/getbytitle(''Decision Points'')/items?$top=2000&$select=Title,AfterStep,Condition&$filter=SOPId eq ', string({sop_id}))",
                                    run_after=ok("Get_SOP"))
    a["Get_analysis"] = sp_request("GET", f"@concat('_api/web/lists/getbytitle(''AI Runs'')/items?$select=RawOutput&$orderby=ID desc&$top=1&$filter=SOPId eq ', string({sop_id}))",
                                   run_after=ok("Get_SOP"))
    a["Analysis"] = {"type": "Compose", "runAfter": ok("Get_analysis"),
                     "inputs": "@json(coalesce(first(body('Get_analysis')?['value'])?['RawOutput'], '{}'))"}
    a["Recommended"] = {"type": "Query", "runAfter": ok("Get_batch"),
                        "inputs": {"from": "@body('Get_batch')?['value']", "where": "@equals(item()?['AnalystRec'], 'Recommend')"}}
    a["Dropped"] = {"type": "Query", "runAfter": ok("Get_batch"),
                    "inputs": {"from": "@body('Get_batch')?['value']", "where": "@equals(item()?['AnalystRec'], 'Drop')"}}
    a["Cards"] = {"type": "InitializeVariable", "runAfter": {},
                  "inputs": {"variables": [{"name": "cards", "type": "string", "value": ""}]}}

    loop = "Each_change"
    cur = lambda key: f"items('{loop}')?['{key}']"
    rich = "first(body('Rich_change'))"
    inner = {
        "Step": {"type": "Query", "inputs": {"from": "@body('Get_steps')?['value']", "where": f"@equals(item()?['Title'], {cur('StepRef')})"}},
        "Step_decisions": {"type": "Query", "inputs": {"from": "@body('Get_decisions')?['value']", "where": f"@equals(item()?['AfterStep'], {cur('StepRef')})"}},
        "Rich_change": {"type": "Query", "inputs": {"from": "@coalesce(outputs('Analysis')?['recommendations'], json('[]'))", "where": f"@equals(item()?['id'], {cur('Title')})"}},
    }
    inner["Resolved_risks"] = {"type": "Query", "runAfter": ok("Rich_change"), "inputs": {
        "from": "@coalesce(outputs('Analysis')?['risks'], json('[]'))",
        "where": f"@contains(coalesce({rich}?['resolves_risks'], json('[]')), item()?['id'])"}}
    inner["Decision_lines"] = {"type": "Select", "runAfter": ok("Step_decisions"), "inputs": {
        "from": "@body('Step_decisions')", "select": "@concat('<div style=\"color:#52514e\"><b>', item()?['Title'], '</b> decision: ', item()?['Condition'], '</div>')"}}
    inner["Impl_lines"] = {"type": "Select", "runAfter": ok("Rich_change"), "inputs": {
        "from": f"@coalesce({rich}?['implementation_steps'], json('[]'))", "select": "@concat('<li>', item(), '</li>')"}}
    inner["Risk_lines"] = {"type": "Select", "runAfter": ok("Resolved_risks"), "inputs": {
        "from": "@body('Resolved_risks')",
        "select": "@concat('<li><b>', item()?['id'], '</b> (', item()?['severity'], '): ', coalesce(item()?['what_could_go_wrong'], item()?['description'], ''), '</li>')"}}
    imp = f"{rich}?['impact']"
    card = (
        "@concat("
        "'<div style=\"border:1px solid #c3c2b7;border-radius:8px;padding:14px;margin:0 0 14px\">',"
        f"'<div style=\"font-size:13px;color:#52514e\"><b>', {cur('Title')}, '</b> · ', {cur('Label')}, ' · Priority ', string({cur('Priority')}), ' · Value ', string({cur('ValueScore')}), ' · Effort ', string({cur('EffortScore')}), '</div>',"
        "'<p style=\"margin:10px 0 4px;font-size:11px;font-weight:bold;color:#898781\">CURRENT</p>',"
        f"'<div><b>', {cur('StepRef')}, '</b> · ', coalesce(first(body('Step'))?['Actor'], ''), ': ', coalesce(first(body('Step'))?['Action'], ''), '</div>',"
        "join(body('Decision_lines'), ''),"
        "'<p style=\"margin:10px 0 4px;font-size:11px;font-weight:bold;color:#2a78d6\">PROPOSED CHANGE</p>',"
        f"'<div>', coalesce({cur('ProposedChange')}, {cur('Reason')}, ''), '</div>',"
        f"'<div style=\"color:#52514e;font-size:13px;margin-top:4px\">Why: ', coalesce({cur('Reason')}, ''), '<br>Tool: ', coalesce({cur('SuggestedTool')}, ''), '</div>',"
        "if(empty(body('Impl_lines')), '', concat('<p style=\"margin:10px 0 4px;font-size:11px;font-weight:bold;color:#898781\">HOW TO IMPLEMENT</p><ol style=\"margin:0;padding-left:20px\">', join(body('Impl_lines'), ''), '</ol>')),"
        "if(empty(body('Risk_lines')), '', concat('<p style=\"margin:10px 0 4px;font-size:11px;font-weight:bold;color:#898781\">RESOLVES</p><ul style=\"margin:0;padding-left:20px\">', join(body('Risk_lines'), ''), '</ul>')),"
        f"if(equals({imp}, null), '', concat('<p style=\"margin:10px 0 4px;font-size:11px;font-weight:bold;color:#898781\">IMPACT</p><div>', "
        f"string(coalesce({imp}?['handoffs_removed'], 0)), ' handoffs removed · ', string(coalesce({imp}?['steps_removed'], 0)), ' steps removed · ', "
        f"string(coalesce({imp}?['wait_days_removed'], 0)), ' wait days removed · ≈ ', string(coalesce({imp}?['minutes_saved_per_occurrence'], 0)), "
        f"' min saved ', coalesce({imp}?['occurrence'], ''), ' (estimate)</div>')),"
        f"if(empty({cur('AnalystNote')}), '', concat('<p style=\"margin:10px 0 0;color:#52514e\"><i>Analyst note: ', {cur('AnalystNote')}, '</i></p>')),"
        "'</div>')"
    )
    inner["Card"] = {"type": "Compose", "runAfter": ok("Step", "Decision_lines", "Impl_lines", "Risk_lines"), "inputs": card}
    inner["Add_card"] = {"type": "AppendToStringVariable", "runAfter": ok("Card"), "inputs": {"name": "cards", "value": "@{outputs('Card')}"}}
    a[loop] = {"type": "Foreach", "foreach": "@body('Recommended')", "runtimeConfiguration": {"concurrency": {"repetitions": 1}},
               "runAfter": ok("Recommended", "Get_steps", "Get_decisions", "Analysis", "Cards"), "actions": inner}
    a["Dropped_lines"] = {"type": "Select", "runAfter": ok("Dropped"), "inputs": {
        "from": "@body('Dropped')",
        "select": "@concat('<li><b>', item()?['Title'], '</b> (step ', item()?['StepRef'], '): ', coalesce(item()?['ProposedChange'], item()?['Reason'], ''), ' <i>— dropped: ', coalesce(item()?['AnalystNote'], ''), '</i></li>')"}}
    link = f"concat('{APP_URL}', '&sopId=', string({sop_id}), '&tab=changes&batch=', string({batch}))"
    button = f"concat('<p><a href=\"', {link}, '\" style=\"background:#2a78d6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block\">Review and decide in the app</a></p>')"
    a["Email_owner"] = {
        "type": "OpenApiConnection", "runAfter": ok(loop, "Dropped_lines"),
        "inputs": {
            "host": {"connectionName": "shared_office365", "operationId": "SendEmailV2",
                     "apiId": "/providers/Microsoft.PowerApps/apis/shared_office365"},
            "parameters": {
                "emailMessage/To": f"@{owner}",
                "emailMessage/Subject": f"@concat('Decide ', string(length(body('Recommended'))), ' process changes: ', {name}, ' (batch ', string({batch}), ')')",
                "emailMessage/Body": (
                    f"@concat('<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;max-width:760px\">',"
                    f"'<p>The process analyst recommends <b>', string(length(body('Recommended'))), '</b> changes to <b>', {name}, '</b> (batch ', string({batch}), '). ',"
                    "'Approve or reject each one in the app. You can also approve changes the analyst dropped.</p>',"
                    f"{button}, variables('cards'),"
                    "if(empty(body('Dropped_lines')), '', concat('<p style=\"font-size:11px;font-weight:bold;color:#898781\">DROPPED BY THE ANALYST</p><ul>', join(body('Dropped_lines'), ''), '</ul>')),"
                    f"{button}, '</div>')"),
                "emailMessage/Importance": "Normal",
            },
            "authentication": "@parameters('$authentication')",
        },
    }
    a["Log_row"] = {"type": "Compose", "runAfter": ok("Email_owner"), "inputs": {
        "Title": f"@concat('Batch ', string({batch}), ' sent to process owner: ', string(length(body('Recommended'))), ' recommended, ', string(length(body('Dropped'))), ' dropped')",
        "SOPId": f"@{sop_id}", "BatchNo": f"@{batch}", "Person": f"@{owner}", "Comments": ""}}
    a["Log_sent"] = sp_request("POST", "_api/web/lists/getbytitle('Review History')/items", "@string(outputs('Log_row'))", run_after=ok("Log_row"))
    # If the email fails, say so in the log and put the SOP back so the analyst can resend.
    a["Fail_row"] = {"type": "Compose", "runAfter": {"Email_owner": ["Failed", "TimedOut"]}, "inputs": {
        "Title": f"@concat('Batch ', string({batch}), ' could not be emailed to the owner')", "SOPId": f"@{sop_id}", "BatchNo": f"@{batch}",
        "Person": f"@{owner}", "Comments": "@{coalesce(body('Email_owner')?['error']?['message'], 'Email failed')}"}}
    a["Log_failure"] = sp_request("POST", "_api/web/lists/getbytitle('Review History')/items", "@string(outputs('Fail_row'))", run_after=ok("Fail_row"))
    schema = {"type": "object", "properties": {"sent": {"title": "sent", "type": "string", "x-ms-dynamically-added": True},
                                               "error": {"title": "error", "type": "string", "x-ms-dynamically-added": True}}}
    a["Respond_sent"] = {"type": "Response", "kind": "PowerApp", "runAfter": ok("Log_sent"),
                         "inputs": {"statusCode": 200, "body": {"sent": "yes", "error": ""}, "schema": schema}}
    a["Respond_failed"] = {"type": "Response", "kind": "PowerApp", "runAfter": ok("Log_failure"),
                           "inputs": {"statusCode": 200, "body": {"sent": "no", "error": "@{outputs('Fail_row')?['Comments']}"}, "schema": schema}}
    return d


if __name__ == "__main__":
    path = OUT / "send-batch.definition.json"
    path.write_text(json.dumps(send_batch(), indent=2))


SOPS_DRIVE_ID = "b!XWbL9fgvB0uny0ZeS-o6Ef0oBxkxiY5LjDA9ZXpmvibfkdj3bkNuSrh2NlVLX7CN"
SAVE_URL_PARAM = "Save flow URL (onyx_SaveFlowUrl)"
ANALYZE_PROMPT = "v3"
BATCH_PRICE = {"input": 2.00, "output": 10.00}   # Claude Opus 5.5 via the Batches API (50% of standard)


def analyze_sop():
    """When a file lands in the SOPs library: convert Word to PDF, run the two-call analysis through the
    Message Batches API (Power Automate HTTP calls time out at 2 minutes; an analysis takes 3-15), then hand the
    result to the Save SOP Analysis flow. The prompt and schema are embedded from prompts/<version> at build time."""
    import importlib.util
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "evals"))   # analyze.py imports env.py
    spec = importlib.util.spec_from_file_location("analyze", Path(__file__).resolve().parent.parent / "evals" / "analyze.py")
    analyze = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(analyze)
    system, schema = analyze.load_prompt(ANALYZE_PROMPT)
    map_schema = analyze.sub_schema(schema, [k for k in schema["properties"] if k not in analyze.ANALYSIS_KEYS])
    analysis_schema = analyze.sub_schema(schema, analyze.ANALYSIS_KEYS)
    task2_prefix, task2_suffix = analyze.ANALYSIS_TASK.split("{map_json}")

    item = "triggerBody()"
    sop_id, file_name = f"{item}?['ID']", f"{item}?['{{FilenameWithExtension}}']"
    d = {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {
            "$connections": {"defaultValue": {}, "type": "Object"},
            "$authentication": {"defaultValue": {}, "type": "SecureObject"},
            API_KEY_PARAM: {"defaultValue": "", "type": "String", "metadata": {"schemaName": "onyx_ClaudeApiKey"}},
            SAVE_URL_PARAM: {"defaultValue": "", "type": "String", "metadata": {"schemaName": "onyx_SaveFlowUrl"}},
        },
        "triggers": {"When_an_SOP_is_uploaded": {
            "type": "OpenApiConnection", "recurrence": {"interval": 1, "frequency": "Minute"},
            "splitOn": "@triggerOutputs()?['body/value']",
            "inputs": {"host": {"connectionName": "shared_sharepointonline", "operationId": "GetOnNewFileItems",
                                "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"},
                       "parameters": {"dataset": SITE, "table": SOPS_LIBRARY_ID},
                       "authentication": "@parameters('$authentication')"},
        }},
        "actions": {},
    }
    a = d["actions"]
    ok = lambda *names: {n: ["Succeeded"] for n in names}
    merge = {**NOMETA, "X-HTTP-Method": "MERGE", "IF-MATCH": "*"}
    sop_uri = f"@concat('_api/web/lists/getbytitle(''SOPs'')/items(', string({sop_id}), ')')"
    claude = {"x-api-key": f"@parameters('{API_KEY_PARAM}')", "anthropic-version": "2023-06-01", "content-type": "application/json"}

    a["Mark_analyzing"] = sp_request("POST", sop_uri, json.dumps({"SOPStatus": "Analyzing", "PromptVersion": ANALYZE_PROMPT}), headers=merge)
    a["Started"] = {"type": "Compose", "runAfter": ok("Mark_analyzing"), "inputs": "@utcNow()"}
    a["PDF"] = {"type": "InitializeVariable", "runAfter": ok("Started"), "inputs": {"variables": [{"name": "pdf", "type": "string", "value": ""}]}}

    work = {}
    work["Is_Word_file"] = {
        "type": "If", "expression": {"endsWith": [f"@toLower({file_name})", ".docx"]},
        "actions": {
            "Convert_to_PDF": {"type": "OpenApiConnection", "inputs": {
                "host": {"connectionName": "shared_wordonlinebusiness", "operationId": "GetFilePDF",
                         "apiId": "/providers/Microsoft.PowerApps/apis/shared_wordonlinebusiness"},
                "parameters": {"source": SITE, "drive": SOPS_DRIVE_ID, "file": f"@concat('/', {file_name})"},
                "authentication": "@parameters('$authentication')"}},
            "Use_converted": {"type": "SetVariable", "runAfter": ok("Convert_to_PDF"),
                              "inputs": {"name": "pdf", "value": "@{base64(body('Convert_to_PDF'))}"}},
        },
        "else": {"actions": {
            "Get_PDF": sp_request("GET", f"@concat('_api/web/lists/getbytitle(''SOPs'')/items(', string({sop_id}), ')/File/$value')",
                                  headers={"Accept": "application/octet-stream"}),
            "Use_PDF": {"type": "SetVariable", "runAfter": ok("Get_PDF"), "inputs": {"name": "pdf", "value": "@{body('Get_PDF')?['$content']}"}},
        }},
    }

    def batch_call(key, task_expr, out_schema, after):
        """Submit one request through the Batches API, wait for it, and parse the structured result."""
        params = {
            "model": analyze.MODEL, "max_tokens": 64000, "system": system,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "high", "format": {"type": "json_schema", "schema": out_schema}},
            "messages": [{"role": "user", "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": "@{variables('pdf')}"}},
                {"type": "text", "text": task_expr}]}],
        }
        work[f"Submit_{key}"] = {"type": "Http", "runAfter": after, "inputs": {
            "method": "POST", "uri": "https://api.anthropic.com/v1/messages/batches", "headers": claude,
            "body": {"requests": [{"custom_id": key, "params": params}]}},
            "runtimeConfiguration": {"secureData": {"properties": ["inputs"]}}}
        work[f"Wait_{key}"] = {
            "type": "Until", "runAfter": ok(f"Submit_{key}"),
            "expression": f"@equals(body('Check_{key}')?['processing_status'], 'ended')",
            # Batches are guaranteed within 24 hours; queues have run past 8.
            "limit": {"count": 300, "timeout": "P1D"},
            "actions": {
                f"Pause_{key}": {"type": "Wait", "inputs": {"interval": {"count": 5, "unit": "Minute"}}},
                f"Check_{key}": {"type": "Http", "runAfter": ok(f"Pause_{key}"), "inputs": {
                    "method": "GET", "uri": f"@concat('https://api.anthropic.com/v1/messages/batches/', body('Submit_{key}')?['id'])",
                    "headers": claude}, "runtimeConfiguration": {"secureData": {"properties": ["inputs"]}}},
            }}
        work[f"Results_{key}"] = {"type": "Http", "runAfter": ok(f"Wait_{key}"), "inputs": {
            "method": "GET", "uri": f"@body('Check_{key}')?['results_url']", "headers": claude},
            "runtimeConfiguration": {"secureData": {"properties": ["inputs"]}}}
        work[f"Result_{key}"] = {"type": "Compose", "runAfter": ok(f"Results_{key}"),
                                 "inputs": f"@json(trim(string(body('Results_{key}'))))"}
        work[f"Check_success_{key}"] = {
            "type": "If", "runAfter": ok(f"Result_{key}"),
            "expression": {"not": {"equals": [f"@outputs('Result_{key}')?['result']?['type']", "succeeded"]}},
            "actions": {f"Fail_{key}": {"type": "Terminate", "inputs": {"runStatus": "Failed", "runError": {
                "code": "AnalysisFailed", "message": f"@{{concat('{key} call: ', string(outputs('Result_{key}')?['result']))}}"}}}},
            "else": {"actions": {}}}
        work[f"Text_{key}"] = {"type": "Query", "runAfter": ok(f"Check_success_{key}"), "inputs": {
            "from": f"@outputs('Result_{key}')?['result']?['message']?['content']", "where": "@equals(item()?['type'], 'text')"}}
        work[f"Output_{key}"] = {"type": "Compose", "runAfter": ok(f"Text_{key}"), "inputs": f"@json(first(body('Text_{key}'))?['text'])"}

    batch_call("map", analyze.MAP_TASK, map_schema, ok("Is_Word_file"))
    assert "'" not in task2_prefix and not task2_suffix.strip()
    batch_call("analysis", f"@{{concat('{task2_prefix.rstrip()}', decodeUriComponent('%0A%0A'), string(outputs('Output_map')))}}",
               analysis_schema, ok("Output_map"))
    # The two halves are disjoint objects; join them into one analysis.
    work["Analysis"] = {"type": "Compose", "runAfter": ok("Output_analysis"), "inputs": (
        "@json(concat(substring(string(outputs('Output_map')), 0, sub(length(string(outputs('Output_map'))), 1)), ',', "
        "substring(string(outputs('Output_analysis')), 1, sub(length(string(outputs('Output_analysis'))), 1))))")}
    usage = lambda k, f: f"outputs('Result_{k}')?['result']?['message']?['usage']?['{f}']"
    tokens_in = f"add({usage('map', 'input_tokens')}, {usage('analysis', 'input_tokens')})"
    tokens_out = f"add({usage('map', 'output_tokens')}, {usage('analysis', 'output_tokens')})"
    work["Save"] = {"type": "Http", "runAfter": ok("Analysis"), "inputs": {
        "method": "POST", "uri": f"@parameters('{SAVE_URL_PARAM}')", "headers": {"content-type": "application/json"},
        "body": {"sopId": f"@{sop_id}", "promptVersion": ANALYZE_PROMPT, "model": analyze.MODEL,
                 "inputTokens": f"@{tokens_in}", "outputTokens": f"@{tokens_out}",
                 "durationSec": "@div(sub(ticks(utcNow()), ticks(outputs('Started'))), 10000000)",
                 "costUSD": f"@add(div(mul(float({tokens_in}), {BATCH_PRICE['input']}), 1000000), div(mul(float({tokens_out}), {BATCH_PRICE['output']}), 1000000))",
                 "analysis": "@outputs('Analysis')"}}}
    a["Analyze"] = {"type": "Scope", "runAfter": ok("PDF"), "actions": work}

    # On any failure: mark the SOP Failed and record why in AI Runs.
    # Log only the failed actions' errors: result() includes action inputs, which carry the API key.
    a["Failed_only"] = {"type": "Query", "runAfter": {"Analyze": ["Failed", "TimedOut", "Skipped"]}, "inputs": {
        "from": "@result('Analyze')", "where": "@not(equals(item()?['status'], 'Succeeded'))"}}
    a["Failed_actions"] = {"type": "Select", "runAfter": ok("Failed_only"), "inputs": {
        "from": "@body('Failed_only')",
        "select": {"name": "@item()?['name']", "status": "@item()?['status']", "error": "@item()?['error']"}}}
    a["Failure_row"] = {"type": "Compose", "runAfter": ok("Failed_actions"), "inputs": {
        "Title": f"@concat('SOP ', string({sop_id}), ' / {ANALYZE_PROMPT} (failed)')", "SOPId": f"@{sop_id}",
        "PromptVersion": ANALYZE_PROMPT, "Model": analyze.MODEL, "RunStatus": "Failed",
        "ErrorMessage": "@{string(body('Failed_actions'))}"}}
    a["Log_failure"] = sp_request("POST", "_api/web/lists/getbytitle('AI Runs')/items", "@string(outputs('Failure_row'))", run_after=ok("Failure_row"))
    a["Mark_failed"] = sp_request("POST", sop_uri, '{"SOPStatus":"Failed"}', headers=merge, run_after=ok("Log_failure"))
    return d


if __name__ == "__main__":
    path = OUT / "analyze-sop.definition.json"
    path.write_text(json.dumps(analyze_sop(), indent=2))
    print("wrote", path)
