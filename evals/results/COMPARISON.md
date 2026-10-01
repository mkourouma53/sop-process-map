# Prompt versions: results

Three SOPs with reference maps (01 FCC purchase card, 02 Navy purchase card, 08 NIH data access), built before any
pipeline output was reviewed. All three prompt versions were scored on 2026-10-01 against the **same** reference maps,
with the same judge (Claude Opus 5.5) and the same grounding check. Analysis model: Claude Opus 5.5 throughout.

| Metric (pooled, 3 SOPs) | v1 | v2 | v3 |
|---|---|---|---|
| **Step recall** (reference steps the model found) | 76% | 92% | **96%** |
| Step precision vs. reference maps | 62% | 46% | 45% |
| In-scope precision vs. reference maps | 69% | 57% | 56% |
| **Unsupported steps** (grounding check: not in the SOP) | 0 | 2 | **0** |
| **Grounded precision** (AI steps supported by the SOP) | 100% | 99% | **100%** |
| **Decision accuracy** | 30% | 57% | **65%** |
| AI steps | 110 | 181 | 193 |
| Analysis cost, 3 SOPs | $2.95 | $4.53 | $5.59 |
| Avg cost per SOP | $0.98 | $1.51 | $1.86 |

| SOP | Recall v1 → v3 | Decision accuracy v1 → v3 |
|---|---|---|
| 01 FCC | 93% → 97% | 86% → 86% |
| 02 Navy | 57% → 93% | 0% → 50% |
| 08 NIH | 94% → 100% | 50% → 100% |

## How to read precision

Precision against the reference maps fell as recall rose because later prompts map more of each SOP than the references cover.
The grounding check reads the SOP for every AI step with no reference match: in v3, 102 of 107 are fully supported and
5 partially supported (e.g. an actor the SOP leaves implicit), 0 invented. So the honest headline is recall plus
grounded precision; precision against the reference maps measures agreement on scope, not hallucination.

## What each version changed

- **v1** One prompt: steps, decisions, risks, recommendations, future state.
- **v2** Section inventory with the reorder test (procedure vs. rules), coverage of every procedure section,
  people-only actors, branch actions as steps, `conflicting_rule` risk. Fixed silent section skipping (Navy recall
  57% → 91%).
- **v3** Separate processes per SOP (named by trigger and outcome, steps never chained across processes),
  risk write-ups (what could go wrong, cause, impact, counted numbers, severity reason), recommendations with
  proposed change, implementation steps, impact, and linked risks. Navy recall 93%, NIH perfect, decisions 65%.

## Still weak

- Navy decision accuracy 50%: several golden decisions are framed differently by the AI (e.g. fraud-vs-dispute
  chosen before notification). Next: compare decision framing on the remaining 7 SOPs before changing the prompt.
- Judge variance on decisions: re-judging unchanged output has moved decision accuracy by 20+ points.
  Next: judge 3x and average.
- Cost rose with richer output ($0.98 → $1.86 per SOP).
