import { useEffect, useRef, useState } from 'react';
import type { RecommendationsRead } from '../generated/models/RecommendationsModel';
import type { SopAnalysis } from '../data';
import { adviseRecommendation, choice, decideRecommendation, type Role } from '../data';
import { LABELS, LabelChip, RISK_TYPES } from './Badges';
import { ScopeToggle, Select, stepNum, type Scope } from './Filters';

type Sort = 'priority' | 'value' | 'effort' | 'step';
const SCORES = [1, 2, 3, 4, 5];

interface Props {
  analysis: SopAnalysis;
  process: string;
  focus?: string | null;
  role: Role;
  initialBatch?: string | null;
  onRecUpdated: (rec: RecommendationsRead) => void;
}

const adviceOf = (r: RecommendationsRead) => choice(r.AnalystRec) || 'Pending';
const decisionOf = (r: RecommendationsRead) => choice(r.RecStatus) || 'Proposed';

/** Recommended changes for one SOP: what changes, how to implement it, what it fixes, and how it scores. */
export function Changes({ analysis, process, focus, role, initialBatch, onRecUpdated }: Props) {
  const [scope, setScope] = useState<Scope>(focus || initialBatch ? 'all' : 'process');
  const [batch, setBatch] = useState(initialBatch ?? 'all');
  const [label, setLabel] = useState('all');
  const [advice, setAdvice] = useState('all');
  const [decision, setDecision] = useState('all');
  const [sort, setSort] = useState<Sort>('priority');
  const [cell, setCell] = useState<{ v: number; e: number } | null>(null);

  const inProcess = new Set(analysis.processes.find((p) => p.name === process)?.stepIds ?? []);
  const scoped = analysis.recommendations.filter((r) => scope === 'all' || (analysis.richRecs.get(r.Title)?.process ?? '') === process || inProcess.has(r.StepRef ?? ''));
  const batchOf = (r: RecommendationsRead) => (r.BatchNo ? String(r.BatchNo) : 'unsent');
  const filtered = scoped.filter((r) => (label === 'all' || choice(r.Label) === label) && (advice === 'all' || adviceOf(r) === advice)
    && (decision === 'all' || decisionOf(r) === decision) && (batch === 'all' || batchOf(r) === batch || (batch === 'awaiting' && !!r.BatchNo && decisionOf(r) === 'Proposed')));
  const batches = [...new Set(analysis.recommendations.map((r) => r.BatchNo).filter(Boolean))].sort((x, y) => (x ?? 0) - (y ?? 0));
  const awaiting = analysis.recommendations.filter((r) => r.BatchNo && decisionOf(r) === 'Proposed').length;
  const recs = filtered
    .filter((r) => !cell || (r.ValueScore === cell.v && r.EffortScore === cell.e))
    .sort((a, b) => {
      if (sort === 'value') return (b.ValueScore ?? 0) - (a.ValueScore ?? 0) || (b.Priority ?? 0) - (a.Priority ?? 0);
      if (sort === 'effort') return (a.EffortScore ?? 0) - (b.EffortScore ?? 0) || (b.Priority ?? 0) - (a.Priority ?? 0);
      if (sort === 'step') return stepNum(a.StepRef) - stepNum(b.StepRef);
      return (b.Priority ?? 0) - (a.Priority ?? 0);
    });

  const counts = new Map<string, number>();
  for (const r of filtered) counts.set(`${r.ValueScore}-${r.EffortScore}`, (counts.get(`${r.ValueScore}-${r.EffortScore}`) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const tally = (f: (r: RecommendationsRead) => string, v: string) => scoped.filter((r) => f(r) === v).length;

  return (
    <div className="stack">
      <div className="row panel" style={{ padding: 12 }}>
        <ScopeToggle value={scope} onChange={(s) => { setScope(s); setCell(null); }} />
        <span className="chip" title="Analyst advice">Analyst: {tally(adviceOf, 'Recommend')} recommended · {tally(adviceOf, 'Drop')} dropped · {tally(adviceOf, 'Pending')} to review</span>
        <span className="chip" title="Owner decisions">Owner: {tally(decisionOf, 'Approved')} approved · {tally(decisionOf, 'Rejected')} rejected</span>
        {awaiting > 0 && (
          <button className={`chip chip-btn${batch === 'awaiting' ? '' : ' flag-inferred'}`} aria-pressed={batch === 'awaiting'}
            onClick={() => { setScope('all'); setBatch(batch === 'awaiting' ? 'all' : 'awaiting'); setCell(null); }}>
            {awaiting} awaiting the owner's decision
          </button>
        )}
        <span className="spacer" />
        <Select label="Type" value={label} onChange={(v) => { setLabel(v); setCell(null); }} options={[['all', 'All types'], ...Object.entries(LABELS)]} />
        <Select label="Batch" value={batch} onChange={(v) => { setBatch(v); setCell(null); }}
          options={[['all', 'All'], ['awaiting', 'Awaiting owner'], ['unsent', 'Not sent yet'], ...batches.map((b) => [String(b), `Batch ${b}`] as [string, string])]} />
        <Select label="Analyst" value={advice} onChange={(v) => { setAdvice(v); setCell(null); }} options={[['all', 'All'], ['Pending', 'To review'], ['Recommend', 'Recommended'], ['Drop', 'Dropped']]} />
        <Select label="Owner" value={decision} onChange={(v) => { setDecision(v); setCell(null); }} options={[['all', 'All'], ['Proposed', 'Not decided'], ['Approved', 'Approved'], ['Rejected', 'Rejected']]} />
        <Select label="Sort" value={sort} onChange={(v) => setSort(v as Sort)} options={[['priority', 'Priority (value ÷ effort)'], ['value', 'Highest value'], ['effort', 'Lowest effort'], ['step', 'Step order']]} />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px' }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="row">
            <h2 style={{ margin: 0 }}>{recs.length} recommended change{recs.length === 1 ? '' : 's'}{cell ? ` at value ${cell.v}, effort ${cell.e}` : ''}</h2>
            {cell && <button className="link" onClick={() => setCell(null)}>Show all</button>}
          </div>
          {recs.length === 0 ? <div className="panel empty">No recommended changes match these filters.</div> :
            recs.map((r) => <ChangeCard key={r.ID} rec={r} analysis={analysis} focused={focus === r.Title} role={role} onUpdated={onRecUpdated} />)}
        </div>

        <aside className="panel sticky">
          <h3>Value vs. effort</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Number of changes at each score. Top left: high value, low effort. Select a cell to filter.</p>
          <div className="matrix" role="grid" aria-label="Recommended changes by value and effort">
            {[...SCORES].reverse().map((v) => (
              <div key={v} style={{ display: 'contents' }} role="row">
                <div className="axis" role="rowheader">{v === 5 ? 'Value 5' : v}</div>
                {SCORES.map((e) => {
                  const n = counts.get(`${v}-${e}`) ?? 0;
                  const step = n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 5));
                  const selected = cell?.v === v && cell?.e === e;
                  return (
                    <button key={e} role="gridcell" className={`cell${step >= 4 && !dark ? ' dark' : ''}`}
                      style={{ background: `var(--seq-${step})`, color: step >= 4 && dark ? '#0b0b0b' : undefined }}
                      aria-pressed={selected} title={`Value ${v}, effort ${e}: ${n} change${n === 1 ? '' : 's'}`}
                      onClick={() => setCell(selected ? null : { v, e })}>
                      {n || ''}
                    </button>
                  );
                })}
              </div>
            ))}
            <div />
            {SCORES.map((e) => <div key={e} className="axis">{e === 1 ? 'Effort 1' : e}</div>)}
          </div>
        </aside>
      </div>
    </div>
  );
}

interface StarterFlow { trigger?: string; actions?: string[]; approval_step?: string }

function ChangeCard({ rec, analysis, focused, role, onUpdated }: { rec: RecommendationsRead; analysis: SopAnalysis; focused: boolean; role: Role; onUpdated: (r: RecommendationsRead) => void }) {
  const analystLocked = !!rec.BatchNo;   // once sent, the owner decides
  const status = decisionOf(rec);
  const advice = adviceOf(rec);
  const rich = analysis.richRecs.get(rec.Title);
  const step = analysis.steps.find((s) => s.Title === rec.StepRef);
  const decisions = analysis.decisions.filter((d) => d.AfterStep === rec.StepRef);
  const flow = parseFlow(rec.StarterFlow);
  const howTo = rich?.implementation_steps?.length ? rich.implementation_steps
    : flow ? [`Trigger: ${flow.trigger}`, ...(flow.actions ?? []), ...(flow.approval_step ? [`Approval: ${flow.approval_step}`] : [])] : [];
  const resolves = rich?.resolves_risks?.length
    ? analysis.risks.filter((x) => rich.resolves_risks!.includes(x.Title))
    : analysis.risks.filter((x) => x.StepRef === rec.StepRef);
  const impact = rich?.impact;
  const [runsPerYear, setRunsPerYear] = useState('');
  const hours = impact?.minutes_saved_per_occurrence && Number(runsPerYear) > 0
    ? (impact.minutes_saved_per_occurrence * Number(runsPerYear)) / 60 : null;

  const [noteFor, setNoteFor] = useState<'drop' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [focused]);

  async function run(save: () => Promise<void>, patch: Partial<RecommendationsRead>) {
    setBusy(true);
    setError('');
    try {
      await save();
      onUpdated({ ...rec, ...patch });
      setNoteFor(null);
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }
  const asChoice = (v: string) => ({ '@odata.type': '', Id: 0, Value: v });
  const advise = (v: 'Recommend' | 'Drop' | 'Pending', n = '') =>
    run(() => adviseRecommendation(rec.ID!, v, n), { AnalystRec: asChoice(v), AnalystNote: n });
  const decide = (v: 'Approved' | 'Rejected' | 'Proposed', n = '') =>
    run(() => decideRecommendation(rec.ID!, v, n), { RecStatus: asChoice(v), RejectionReason: n });

  return (
    <article ref={ref} className={`card change ${status.toLowerCase()} advice-${advice.toLowerCase()}${focused ? ' focused' : ''}`}>
      <div className="row" style={{ gap: 8 }}>
        <LabelChip label={choice(rec.Label)} />
        <span className="scores"><span>Priority <b>{(rec.Priority ?? 0).toFixed(1)}</b></span><span>Value <b>{rec.ValueScore}</b></span><span>Effort <b>{rec.EffortScore}</b></span></span>
        <span className="spacer" />
        {rec.BatchNo ? <span className="chip">Batch {rec.BatchNo}</span> : null}
        <span className={`chip advice-${advice.toLowerCase()}`} title={rec.AnalystNote || undefined}>Analyst: {advice === 'Pending' ? 'to review' : advice === 'Recommend' ? 'recommends' : 'dropped'}</span>
        <span className={`chip decision-${status.toLowerCase()}`}>Owner: {status === 'Proposed' ? 'not decided' : status.toLowerCase()}</span>
      </div>

      <div className="current">
        <div className="tag">Current</div>
        {step ? <div><b>{step.Title}</b> · {step.Actor}: {step.Action}</div> : <div>{rec.StepRef}</div>}
        {decisions.map((d) => <div key={d.ID} className="muted"><b>{d.Title}</b> · decision: {d.Condition}</div>)}
      </div>

      <div>
        <div className="tag proposed">Proposed change</div>
        <div>{rich?.proposed_change || rec.Reason}</div>
        {rich?.proposed_change && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Why: {rec.Reason}</div>}
        {rec.SuggestedTool && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Tool: {rec.SuggestedTool}</div>}
      </div>

      {howTo.length > 0 && (
        <details open={focused}>
          <summary><b>How to implement</b> ({howTo.length} steps)</summary>
          <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>{howTo.map((h, i) => <li key={i}>{h}</li>)}</ol>
        </details>
      )}

      {impact && (
        <div>
          <div className="tag">Impact</div>
          <div className="row" style={{ gap: 6 }}>
            {!!impact.handoffs_removed && <span className="chip"><b>{impact.handoffs_removed}</b>&nbsp;handoff{impact.handoffs_removed === 1 ? '' : 's'} removed</span>}
            {!!impact.steps_removed && <span className="chip"><b>{impact.steps_removed}</b>&nbsp;step{impact.steps_removed === 1 ? '' : 's'} removed</span>}
            {!!impact.wait_days_removed && <span className="chip"><b>{impact.wait_days_removed}</b>&nbsp;wait days removed</span>}
            {!!impact.manual_entries_removed && <span className="chip"><b>{impact.manual_entries_removed}</b>&nbsp;manual entr{impact.manual_entries_removed === 1 ? 'y' : 'ies'} removed</span>}
            {!!impact.minutes_saved_per_occurrence && <span className="chip">≈ <b>{impact.minutes_saved_per_occurrence}</b>&nbsp;min saved {impact.occurrence} (estimate)</span>}
          </div>
          {!!impact.minutes_saved_per_occurrence && (
            <label className="row" style={{ gap: 6, marginTop: 8, fontSize: 13 }}>
              If this happens <input type="number" min={0} value={runsPerYear} onChange={(e) => setRunsPerYear(e.target.value)} style={{ width: 80 }} aria-label="Occurrences per year" /> times a year,
              {hours !== null ? <b>≈ {hours.toFixed(0)} staff hours saved per year</b> : <span className="muted">enter your volume to estimate hours saved</span>}
            </label>
          )}
          {impact.basis && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Basis: {impact.basis}</div>}
        </div>
      )}

      {resolves.length > 0 && (
        <div>
          <div className="tag">Resolves</div>
          {resolves.map((x) => <div key={x.ID} style={{ fontSize: 13 }}>{x.Title} · {RISK_TYPES[choice(x.RiskType)] ?? choice(x.RiskType)}: {analysis.richRisks.get(x.Title)?.what_could_go_wrong || x.Description}</div>)}
        </div>
      )}

      {advice === 'Drop' && rec.AnalystNote && <div className="quote">Analyst dropped it: {rec.AnalystNote}</div>}
      {status === 'Rejected' && rec.RejectionReason && <div className="quote">Owner rejected it: {rec.RejectionReason}</div>}
      {status === 'Approved' && rec.OwnerNote && <div className="quote">Owner: {rec.OwnerNote}</div>}
      {noteFor && (
        <div className="field">
          <label htmlFor={`note-${rec.ID}`}>{noteFor === 'drop' ? 'Why drop it? The owner sees this note.' : 'Why reject it? The analyst sees this note.'}</label>
          <textarea id={`note-${rec.ID}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <div className="row" style={{ gap: 8 }}>
        {noteFor ? (
          <>
            <button className="btn danger" disabled={busy || !note.trim()}
              onClick={() => (noteFor === 'drop' ? advise('Drop', note.trim()) : decide('Rejected', note.trim()))}>
              {noteFor === 'drop' ? 'Confirm drop' : 'Confirm reject'}
            </button>
            <button className="btn" disabled={busy} onClick={() => setNoteFor(null)}>Cancel</button>
          </>
        ) : role === 'analyst' ? (
          analystLocked ? <span className="muted" style={{ fontSize: 13 }}>Sent to the owner in batch {rec.BatchNo}. The owner decides from here.</span>
            : advice === 'Pending' ? (
              <>
                <button className="btn primary" disabled={busy} onClick={() => advise('Recommend')}>Recommend to owner</button>
                <button className="btn" disabled={busy} onClick={() => setNoteFor('drop')}>Drop</button>
              </>
            ) : <button className="btn" disabled={busy} onClick={() => advise('Pending')}>Undo</button>
        ) : status === 'Proposed' ? (
          <>
            <button className="btn primary" disabled={busy} onClick={() => decide('Approved')}>Approve</button>
            <button className="btn" disabled={busy} onClick={() => setNoteFor('reject')}>Reject</button>
          </>
        ) : <button className="btn" disabled={busy} onClick={() => decide('Proposed')}>Undo decision</button>}
      </div>
    </article>
  );
}

function parseFlow(raw?: string): StarterFlow | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw);
    return f && (f.trigger || f.actions?.length) ? f : null;
  } catch {
    return null;
  }
}
