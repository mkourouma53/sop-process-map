# Business case

## The problem

Organizations run on standard operating procedures that are long, out of date, and rarely mapped. Before a process
improvement team, an auditor, or a new manager can change anything, someone has to read the SOP, work out who does
what in which order, find the gaps, and decide what is worth automating. That reading is slow, inconsistent between
analysts, and usually repeated for every engagement.

Building reference maps for three SOPs took **23, 48, and 77 minutes** (an access request, a purchase card
directive, and a purchase card procedure), and the manual maps still missed processes the documents contain: they
covered 90 steps; the model found 193, and a grounding check confirmed every additional step is in the source text.

Real SOPs are also harder than they look:
- **One document holds many processes.** The Navy purchase card instruction contains 16 (appoint a cardholder,
  fund a request, buy, reconcile, dispute, report fraud, report a lost card, close an account, …).
- **Processes are scattered.** The FCC directive describes its purchase process across three sections; a rule in a
  reconciliation section gates a step described in a responsibilities list.
- **Documents contradict themselves.** The Navy instruction gives the same reconciliation step a 5-business-day and
  a 10-business-day deadline.

## What the tool does

1. An analyst uploads an SOP. In minutes the AI returns each process as a swimlane map, with every step tied to the
   section and sentence it came from, and inferred steps flagged for review.
2. It lists risks in plain language (what could go wrong, why, impact, counted from the SOP) and recommends changes,
   each with the current step, the proposed change, implementation steps in Microsoft 365, the risks it resolves, and
   estimated impact.
3. The analyst corrects the map and recommends or drops each change; the process owner receives batches by email and
   approves or rejects each change. The future-state map updates as changes are approved.
4. Anyone reviewing can ask questions in the Ask AI sidebar and get answers cited to SOP pages.

## Measured results (3 SOPs with reference maps, prompt v3, Claude Opus 5.5)

| Measure | Result |
|---|---|
| Reference-map steps the model found (recall) | 96% |
| AI steps not supported by the SOP text | 0 of 193 |
| Decision points with the correct condition and branches | 65% |
| AI analysis time per SOP | 4–16 minutes, unattended |
| AI cost per SOP | $0.66–$2.69 at standard rates; about half through the Batches API used in production |
| Manual mapping time per SOP | 23–77 minutes, before any analysis of risks or improvements |

The AI does not remove the analyst. It changes the job from reading and drawing to reviewing and deciding: the
analyst starts from a complete, cited map and a ranked list of changes instead of a blank page.

## Does it save time?

Yes. On each of the three SOPs with reference maps, the AI produced the process map 3.5 to 5.3 times faster than
mapping by hand, and in that same time it also produced the risks, recommended changes, and future-state map.

| SOP | Manual mapping | AI processing (map, risks, changes, future state) | Steps mapped (manual / AI) | Faster by |
|---|---|---|---|---|
| 08 NIH access request | 23 min | 4.4 min | 17 / 18 | 5.3× |
| 01 FCC purchase card directive | 48 min | 13.6 min | 29 / 72 | 3.5× |
| 02 Navy purchase card procedure | 77 min | 15.8 min | 44 / 103 | 4.9× |
| **Total** | **149 min** | **34 min** | **90 / 193** | **4.4×** |

The comparison understates the saving in three ways:

- **The manual times cover the map only.** Identifying risks, writing recommendations, and drawing a future state
  would add to the manual side; the AI time already includes them.
- **The AI maps more of each document.** It mapped 193 steps against 90 in the manual maps, and the grounding check
  confirmed every additional step is in the SOP text.
- **AI processing is unattended.** The analyst does other work while an SOP is analyzed; the analyst's time goes to
  reviewing a complete, cited map instead of building one.

The review workflow removes further time from the cycle. Without the tool, the analyst writes up risks and
recommendations, sends them to the process owner, and reconciles replies by email. With it, the analyst recommends
or drops each change in the app, sends only new items in a batch, and the owner approves or rejects each change in
the same place. Decisions update the future-state map and the review log directly, with no document to reconcile.

## Impact

**Why it matters.** Process improvement, audit, and modernization work all start from understanding the current
process, and that understanding usually lives in long, unmapped SOPs. Cutting the time to a reviewed current-state
map, and surfacing risks at the same moment, shortens the start of every engagement.

**Why an internal team would adopt it:**

- **Faster to a first draft.** A complete map, risk list, and set of recommended changes in minutes instead of an
  hour or more per SOP, so a team can cover an entire SOP library instead of a sample.
- **More complete and consistent.** The AI found 96% of the reference-map steps plus supported steps the manual
  maps left out, and every SOP produces the same structure regardless of which analyst runs it.
- **Catches what readers miss.** Scattered processes, rules that gate steps in other sections, and contradictions
  such as the Navy instruction's 5- and 10-day deadlines for the same step.
- **Traceable.** Every step cites its section and source sentence, inferred steps are flagged, and every change
  records who recommended it and who approved it.
- **Built on tools the team already has.** SharePoint, Power Automate, and Outlook, with no new platform for end
  users to learn.
- **Low cost.** $0.66 to $2.69 per SOP at standard API rates, about half that through the Batches API used in
  production.

## What a real rollout would need

- **Review-time tracking.** Log analyst review time per SOP in the app so a pilot reports total analyst time per
  SOP, from upload to owner decision, alongside the mapping comparison above.
- **Decision accuracy.** 65% is the weakest metric. Decision points need the most analyst attention until the prompt
  improves on a larger golden set.
- **Data handling.** Client SOPs can be sensitive. A rollout needs an approved model endpoint for the client's cloud
  (for example, Claude through the client's cloud provider in a government region) and a records policy for the
  stored analyses.
- **Licensing.** The app uses SharePoint and standard connectors for end users; the flows that call the AI need
  premium Power Automate licensing for the people who own them.
- **Change management.** Process owners have to accept AI-drafted recommendations as a starting point. Every item
  is traceable to the SOP text and to who recommended and approved it, which is what makes that acceptable.
