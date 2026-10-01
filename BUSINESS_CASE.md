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

1. An analyst uploads an SOP. Unattended, the AI returns each process as a swimlane map, with every step tied to the
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
| AI cost per SOP | $0.66–$2.69 at standard rates; about half through the Batches API used in production |

The AI does not remove the analyst. It changes the job from reading and drawing to reviewing and deciding: the
analyst starts from a complete, cited map and a ranked list of changes instead of a blank page.

## Does it save time?

**Not yet measured.** The project measured one side of the comparison and not the other:

| | Measured? | Result |
|---|---|---|
| Manual mapping time | Yes, 3 SOPs | 23 min (NIH, 17 steps), 48 min (FCC, 29 steps), 77 min (Navy, 44 steps). Mapping only; no risk analysis or recommendations |
| Analyst time to review and correct the AI output | **No** | The app records corrections but does not time reviews |
| AI processing time | Yes | 4–16 min per SOP with standard API calls; 1.5 to 8+ hours through the Batches API in production, mostly queue time. Unattended either way, so it is not analyst time |

Time saved is manual time minus review time, so no savings figure is claimed. Two things could make the real
saving smaller than it looks: a careful review of a 100-step map takes real time, and the 65% decision accuracy
means decision points need a close check. Two things could make it larger: the AI output also covers risks and
recommended changes, which the manual times do not include, and it covered more of each document than the manual
maps did.

### How a pilot would measure it

1. **Instrument the app.** Log when an analyst opens an SOP for review and marks the review complete, with active
   time only (idle periods excluded), plus the number of corrections, in the Review History list.
2. **Compare like with like.** Time manual mapping and AI-assisted review of the same scope (current-state map
   only), and time risk and recommendation work separately.
3. **Avoid the learning effect.** An analyst who has mapped an SOP by hand will review the AI's version of it
   faster. Each analyst works in both conditions on different SOPs, and each SOP is done in both conditions by
   different analysts.
4. **Gate on quality.** Score both outputs against a reference map built independently (step recall, decision
   accuracy). A faster review that misses errors is not a saving.
5. **Normalize and report ranges.** Report minutes per step (or per page) as a median and range across SOPs, since
   documents vary widely in size. A sample of 10–20 SOPs and 4–6 analysts is enough for a first estimate.
6. **Track the rest of the cycle separately.** Owner decision time and calendar turnaround (upload to approved
   future state) show whether the review workflow speeds up the whole process, not just the mapping step.

## What a real rollout would need

- **Review-time measurement.** The pilot described above, before any time-savings claim.
- **Decision accuracy.** 65% is the weakest metric. Decision points need the most analyst attention until the prompt
  improves on a larger golden set.
- **Data handling.** Client SOPs can be sensitive. A rollout needs an approved model endpoint for the client's cloud
  (for example, Claude through the client's cloud provider in a government region) and a records policy for the
  stored analyses.
- **Licensing.** The app uses SharePoint and standard connectors for end users; the flows that call the AI need
  premium Power Automate licensing for the people who own them.
- **Change management.** Process owners have to accept AI-drafted recommendations as a starting point. Every item
  is traceable to the SOP text and to who recommended and approved it, which is what makes that acceptable.
