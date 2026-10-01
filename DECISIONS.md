# Decisions

Why the project is built the way it is. Each entry: the decision, the alternatives, and the reason.

## AI

**Claude (API) for analysis, not AI Builder.** Claude reads PDFs directly, returns JSON that conforms to a defined
schema, and the same call runs from Python for evals and from Power Automate in production. AI Builder gives less
control over the output format and cannot be evaluated outside Power Platform.

**Claude Opus 5.5 for analysis.** Kept constant across prompt versions so v1 → v2 → v3 differences come from the
prompt, not the model. A cheaper model would need to be scored against the same reference maps before any switch.

**Production analysis runs through the Message Batches API.** Power Automate's HTTP action times out after two
minutes; a full analysis takes 4–16. Batches accept the request immediately, the flow checks every five minutes for
up to 24 hours (the API's guarantee), and the cost is half the standard rate. The trade-off is latency: production
runs for the ten test SOPs took 1.5 to over 8 hours, mostly queue time. That is acceptable for a document that shows
"Analyzing" until it is ready; a time-sensitive deployment would use standard calls from a service outside Power
Automate's two-minute limit.

**Two calls per SOP instead of one.** The full output schema exceeded the structured-output grammar limit
("compiled grammar is too large"). Call 1 returns the current-state map; call 2 returns risks, recommended changes and
the future state, given the map. This also matches the review flow: call 2 can be re-run on an analyst-corrected map.

**Structured outputs with a versioned schema per prompt.** `prompts/<version>/schema.json` is the single source of truth
for the eval harness and the flows, so a prompt version and its output contract change together.

**Grounding check in the evals.** Precision against the reference maps penalizes the model for mapping more than the references cover.
A second check reads the SOP for every unmatched AI step and labels it supported, partially supported, or unsupported,
which separates "invented" from "more thorough".

## Process modeling

**The reorder test.** If a section's items can be rearranged and still make sense, it is rules, not a procedure.
Requirement lists become conditions that gate a step, not steps. Used in prompts v2 and later.

**One SOP, several processes.** Processes are identified by trigger and outcome, not by section. Steps never chain
across processes. Sections are a poor proxy: NIH spreads one process across three sections; FCC scatters one purchase
process across three.

**Swimlanes by default, simple flow on request.** Swimlanes (one column per role) are the standard for cross-functional
maps and make handoffs visible, which matters because handoffs are a risk type. A simple single-column flow with the
role in each box is easier to read for long processes.

**A "keep human" item is shown only when it changes something.** The model flags judgment steps (credential
decisions, legal sign-off, discipline) as keep human so reviewers see it considered automating them. Most of those
flags restate the step and fix nothing, so they are hidden; one that adds a real change tied to a risk (record the
committee's decision and denial reason, which resolves an undefined exception) stays as a recommendation. Fixing this
in the app instead of a new prompt version avoided re-running every SOP.

## Review workflow

**The owner decides; the analyst advises.** Each recommended change has two fields: the analyst's advice
(recommend / drop, with a note) and the owner's decision (approve / reject). Only the owner's decision drives the
future state, and the owner can approve a change the analyst dropped. This avoids a double-approval chain while
keeping separation of duties and an audit trail.

**Sent in batches, decided one by one.** The analyst sends whatever they have reviewed since the last batch, at any
time; nothing locks. The owner gets one email per batch with every change in full (current step, proposed change,
implementation steps, risks resolved, impact, analyst note) and decides each change in the app. An approval request
was tried first and dropped: one approval takes one answer, so it cannot carry per-change decisions, and a request
per change floods the owner.

**Status follows the batches.** Analyzed → With owner (any sent change undecided) → Owner reviewed (everything sent
so far decided) → With owner again when the next batch goes out. Every batch and decision is in the Review log.

**Future state: approved only vs. all proposed.** Approvals never change the current map, which must match what
the SOP says until a change is implemented. The approved-only future is today's process with each approved change
swapped in at its step; once every change is approved it equals the AI's full proposal.

## Platform

**SharePoint lists, not Dataverse, for the data.** Every Microsoft 365 tenant has SharePoint; most client environments
already use it, it needs no premium licensing for end users, and lists are easy for a process team to inspect.
Dataverse is used only where the platform requires it: the solution that lets the app call the Ask AI flow.

**Rows link to their SOP by ID, not lookup columns.** Simpler flows and app code; one less thing to break when
re-analysis replaces rows.

**Re-analysis replaces rows.** The save flow deletes an SOP's previous steps, decisions, risks, changes, and future
steps before writing new ones. AI Runs keeps the full history (prompt version, model, tokens, cost, raw output).

**The API key never reaches the browser.** The app calls Power Automate flows; the flows call Claude with the key from
a solution environment variable. Anything in a code app's bundle is visible to its users.

**Richer AI fields live in the stored analysis, not in list columns.** Risk narratives, implementation steps, and
impact are read from the AI Runs raw output, so new prompt fields reach the app without schema migrations. Fields the
flows filter or report on (status, advice, proposed change) are real columns.

**A public demo build of the same app.** The production app lives in a private Microsoft tenant, as client apps do.
The same React code builds a static demo over saved analyses for GitHub Pages: no sign-in, no AI calls, no cost.
