import { useState } from 'react';
import type { RecommendationsRead } from '../generated/models/RecommendationsModel';
import type { SopAnalysis } from '../data';
import { choice } from '../data';
import { ChangeChip } from './Badges';
import { currentNodes, processSlice } from './ProcessPicker';
import { ModeToggle, Swimlane, type FlowMode, type FlowNode } from './Swimlane';

const CHANGE_COLOR: Record<string, string> = {
  automated: 'var(--chg-automated)',
  digitized: 'var(--chg-digitized)',
  ai_assisted: 'var(--chg-ai)',
  new: 'var(--ink-muted)',
};
const CHANGE_TEXT: Record<string, string> = { automated: 'automated', digitized: 'digitized', ai_assisted: 'AI assisted', new: 'new' };

type View = 'approved' | 'proposed';

/**
 * Current vs. future state for one process.
 * - All proposed: the AI's future state with every recommended change applied.
 * - Approved only: today's process with only the owner-approved changes applied, built step by step.
 * Each future step comes from exactly one current step (or is NEW); consolidations show up as one step changed and
 * the absorbed steps eliminated, so approving changes one at a time converges on the "all proposed" map.
 */
export function FutureState({ analysis, process, mode, onModeChange }: { analysis: SopAnalysis; process: string; mode: FlowMode; onModeChange: (m: FlowMode) => void }) {
  const [view, setView] = useState<View>('approved');
  const { ids, steps, decisions } = processSlice(analysis, process);
  const recsByStep = new Map<string, RecommendationsRead[]>();
  for (const r of analysis.recommendations) recsByStep.set(r.StepRef ?? '', [...(recsByStep.get(r.StepRef ?? '') ?? []), r]);
  const recsOf = (step: string) => recsByStep.get(step) ?? [];
  const isApproved = (r: RecommendationsRead) => choice(r.RecStatus) === 'Approved';
  const changeApproved = (step: string) => recsOf(step).some((r) => isApproved(r) && choice(r.Label) !== 'keep_human');
  const eliminationApproved = (step: string) => recsOf(step).some((r) => isApproved(r) && choice(r.Label) === 'eliminate');
  const eliminationProposed = (step: string) => recsOf(step).some((r) => choice(r.Label) === 'eliminate');

  const stepById = new Map(steps.map((s) => [s.Title, s]));
  const future = analysis.future.filter((f) => f.FromStep === 'NEW' || ids.has(f.FromStep ?? ''));
  const actionable = analysis.recommendations.filter((r) => ids.has(r.StepRef ?? '') && choice(r.Label) !== 'keep_human');
  const showAll = view === 'proposed' || (actionable.length > 0 && actionable.every(isApproved));
  const currentNode = (id: string, note: string): FlowNode | null => {
    const c = stepById.get(id);
    return c ? { id: c.Title, kind: 'step', lane: c.Actor?.trim() || 'Unassigned', text: c.Action ?? '', tooltip: note } : null;
  };

  const nodes: FlowNode[] = [];
  if (showAll) {
    // The AI's future state as drafted (its ordering included).
    for (const f of future) {
      const change = choice(f.ChangeType) || 'unchanged';
      const n = f.FromStep === 'NEW' ? futureNode(f.Title, f.Actor, f.Action, 'new', 'new step')
        : change === 'unchanged' ? currentNode(f.FromStep ?? '', 'Unchanged') : futureNode(f.Title, f.Actor, f.Action, change, `${f.FromStep} → ${f.Title}`);
      if (n) nodes.push(n);
    }
  } else {
    // Today's process in today's order, with each approved change swapped in at its step.
    const at = new Map(future.map((f, i) => [f.FromStep ?? '', i]).filter(([k]) => k !== 'NEW') as [string, number][]);
    for (const s of steps) {
      const i = at.get(s.Title);
      if (i === undefined) {           // the AI eliminates this step
        if (!eliminationApproved(s.Title)) nodes.push(currentNode(s.Title, eliminationProposed(s.Title) ? 'Elimination proposed, not approved' : 'Unchanged')!);
        continue;
      }
      const f = future[i];
      const change = choice(f.ChangeType) || 'unchanged';
      const applied = change !== 'unchanged' && changeApproved(s.Title);
      nodes.push(applied ? futureNode(f.Title, f.Actor, f.Action, change, `${s.Title} → ${f.Title}`) : currentNode(s.Title, 'Unchanged')!);
      for (let j = i + 1; j < future.length && future[j].FromStep === 'NEW'; j++) {
        if (applied) nodes.push(futureNode(future[j].Title, future[j].Actor, future[j].Action, 'new', 'new step'));
      }
    }
  }

  const covered = new Set(future.map((f) => f.FromStep));
  const applies = (step: string) => (view === 'proposed' ? eliminationProposed(step) : eliminationApproved(step));
  const eliminatedNow = new Set(steps.filter((s) => !covered.has(s.Title) && applies(s.Title)).map((s) => s.Title));
  const changedCount = nodes.filter((n) => n.badge).length;
  const approvedCount = analysis.recommendations.filter((r) => ids.has(r.StepRef ?? '') && choice(r.RecStatus) === 'Approved').length;
  const totalCount = actionable.length;

  return (
    <div className="stack">
      <div className="row">
        <span className="chip">{steps.length} steps today</span>
        <span className="chip">{nodes.length} steps in future</span>
        <span className="chip">{eliminatedNow.size} eliminated</span>
        <span className="chip">{changedCount} changed</span>
        <span className="muted" style={{ fontSize: 13 }}>{approvedCount} of {totalCount} changes approved for this process</span>
        <span className="spacer" />
        <span className="row" style={{ gap: 6 }}>
          <ChangeChip change="automated" /><ChangeChip change="digitized" /><ChangeChip change="ai_assisted" /><ChangeChip change="new" />
        </span>
      </div>
      <div className="row">
        <div className="segmented" role="radiogroup" aria-label="Future state">
          <button role="radio" aria-checked={view === 'approved'} onClick={() => setView('approved')}>Approved only</button>
          <button role="radio" aria-checked={view === 'proposed'} onClick={() => setView('proposed')}>All proposed</button>
        </div>
        <ModeToggle value={mode} onChange={onModeChange} />
      </div>
      <div className="compare">
        <section className="panel" style={{ padding: 0 }}>
          <h2 style={{ padding: '12px 16px 0' }}>Current state</h2>
          <div className="map-scroll" style={{ border: 0 }}>
            <Swimlane nodes={currentNodes(steps, decisions)} mode={mode} label={`Current state of ${process}`} />
          </div>
        </section>
        <section className="panel" style={{ padding: 0 }}>
          <h2 style={{ padding: '12px 16px 0' }}>{view === 'approved' ? 'Future state (approved changes)' : 'Future state (all proposed changes)'}</h2>
          {view === 'approved' && approvedCount === 0 && <p className="muted" style={{ padding: '0 16px', fontSize: 13 }}>No changes approved yet, so the future matches today. Approve changes to see them here.</p>}
          <div className="map-scroll" style={{ border: 0 }}>
            <Swimlane nodes={nodes} mode={mode} label={`Future state of ${process}`} />
          </div>
        </section>
      </div>
    </div>
  );
}

function futureNode(id: string, actor: string | undefined, action: string | undefined, change: string, note: string): FlowNode {
  return { id, kind: 'step', lane: actor?.trim() || 'Unassigned', text: action ?? '', accent: CHANGE_COLOR[change], badge: CHANGE_TEXT[change], tooltip: note };
}
