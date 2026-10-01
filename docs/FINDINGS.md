# Findings

Observations from building the reference maps and reviewing model output. Each one changed the prompts, the app, or
the evaluation.

## 1. SOPs scatter their processes and hide rules (SOP 01, FCC)

The FCC purchase card directive is written as policy rather than procedure. The purchase process is never stated in
order and has to be assembled from three places:

- 7.E (approving official responsibilities): written authorization before the purchase, validating receipt
- 7.F (cardholder responsibilities): confirm funds, Section 508 form, other forms, make the purchase
- 6.C.3 (reconciliation): goods accepted by another employee need that employee's signature on the invoice
  *before* the cardholder can reconcile

About half of the directive (limits, prohibited purchases, penalties, records retention) consists of rules that could
be rearranged as bullets without losing meaning.

**Implication:** assembling a scattered process and surfacing buried conditions is slow manual work and is where
automated cross-referencing adds the most value. It is also where model errors are hardest to catch, so every step
cites its source section.

## 2. The same process carries different controls (SOP 01 FCC vs. 02 Navy)

| Control | FCC 1097.6 | Navy NETCINST 4200.4A |
|---|---|---|
| Structure | Policy directive; process scattered across sections | Ordered procedures that mostly follow the lifecycle |
| Funds check | Cardholder ensures funds are available | Resource manager commits funds before purchase |
| Pre-purchase screening | Not required as a step | Screen mandatory sources, record in purchase card log |
| Receipt of goods | Approving official validates receipt and signs invoice | Separation of duties: cardholder cannot also receive and accept |
| Reconciliation deadline | Cardholder 7 workdays, approving official 10 workdays | Contradictory: §10 says 5 business days; §10.b.6 says 10 |
| Disputes vs. fraud | Disputes only | Separate dispute and fraud reporting paths |

## 3. SOPs contradict themselves (SOP 02, Navy)

NETCINST 4200.4A §10 states that "The CH and AO/CO shall complete the reconciliation process within five business
days" of the statement changing from INTERIM to NEW; §10.b.6 directs the AO/CO to "certify the monthly invoice within
10 business days" of the same event. A cardholder following the first rule and an approver following the second would
both consider themselves compliant.

**Change:** prompt v2 added a `conflicting_rule` risk type. The v3 analysis flags this conflict and cites both sections.

## 4. A testable rule for procedure vs. rules: the reorder test

> If the items in a section can be rearranged and still make sense, the section is rules, not a procedure.

Prompt v2 applies this test to classify every section as `procedure`, `rules`, or `background` before mapping. This
enforces coverage of every procedure section, shows reviewers what was skipped and why, and gives the reference maps
and the model the same definition of scope. Requirement lists become conditions that gate a step rather than steps.

## 5. One SOP holds several processes, and they do not align with sections

Chaining every step of an SOP into one map misrepresents it: the Navy and FCC documents describe separate processes
(issue a card, make a purchase, reconcile, dispute a charge, report a lost card, close an account) with unrelated
triggers. Sections are a poor proxy. NIH SOP-01 spreads one connected process across three sections, while the FCC
directive scatters one purchase process across 6.C, 7.E, and 7.F; grouping the Navy SOP by section produced 19
"processes," including rules sections.

**Change:** prompt v3 identifies processes by trigger and outcome, tags every step with its process, and forbids
chaining steps across processes. The app maps one process at a time.

## 6. "Keep human" is not a recommendation on its own

The model labels judgment steps (credential decisions, legal sign-off, discipline) as "keep human." Of 14 such items,
13 restated the existing step and resolved no risk. One was a real change: record the data access committee's decision
and denial reason, which resolves an undefined exception. The app shows only keep-human items that resolve a risk, so
every item an owner approves changes the process.

## 7. Precision against reference maps penalizes thoroughness

Later prompt versions found more steps than the reference maps contain, so precision fell as the analysis improved.
A grounding check (a second model call that reads the SOP for each unmatched step) showed the additional steps were
supported by the source text. Recall plus grounded precision is a more accurate summary than precision alone.
