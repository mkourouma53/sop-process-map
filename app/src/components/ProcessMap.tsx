import { useState } from 'react';
import type { ProcessStepsRead } from '../generated/models/ProcessStepsModel';
import type { SopAnalysis } from '../data';
import { saveStep } from '../data';
import { ModeToggle, Swimlane, type FlowMode } from './Swimlane';
import { currentNodes, processSlice } from './ProcessPicker';

interface Props {
  analysis: SopAnalysis;
  process: string;
  mode: FlowMode;
  onModeChange: (m: FlowMode) => void;
  onStepSaved: (step: ProcessStepsRead) => void;
  initialHighlight?: string | null;
}

type Filter = 'steps' | 'decisions' | 'inferred' | 'corrected';

export function ProcessMap({ analysis, process, mode, onModeChange, onStepSaved, initialHighlight }: Props) {
  const { steps, decisions } = processSlice(analysis, process);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter | null>((initialHighlight as Filter) || null);
  const nodes = currentNodes(steps, decisions);
  const groups: Record<Filter, string[]> = {
    steps: steps.map((s) => s.Title),
    decisions: decisions.map((d) => d.Title),
    inferred: [...steps.filter((s) => s.Inferred).map((s) => s.Title), ...decisions.filter((d) => d.Inferred).map((d) => d.Title)],
    corrected: steps.filter((s) => s.Corrected).map((s) => s.Title),
  };
  const highlight = filter ? new Set(groups[filter]) : null;
  const chip = (f: Filter, text: string, cls = '') => (
    <button className={`chip chip-btn ${cls}`} aria-pressed={filter === f} onClick={() => setFilter(filter === f ? null : f)}
      title={filter === f ? 'Clear highlight' : `Highlight ${f} in the map`}>
      {text}
    </button>
  );
  const selStep = steps.find((s) => s.Title === selected);
  const selDecision = decisions.find((d) => d.Title === selected);

  return (
    <div className="stack">
      <div className="row">
        {chip('steps', `${steps.length} steps`)}
        {chip('decisions', `${decisions.length} decisions`)}
        {chip('inferred', `${groups.inferred.length} inferred: check these first`, 'flag-inferred')}
        {chip('corrected', `${groups.corrected.length} corrected`, 'flag-corrected')}
        <span className="spacer" />
        <ModeToggle value={mode} onChange={onModeChange} />
      </div>

      <div className="split">
        <div className="map-scroll" role="region" aria-label={`Process map for ${process}`}>
          <Swimlane nodes={nodes} mode={mode} highlight={highlight} selected={selected} onSelect={setSelected} label={`${process}: ${steps.length} steps across ${new Set(steps.map((s) => s.Actor)).size} roles`} />
        </div>
        <aside className="panel sticky">
          {selStep && <StepEditor key={selStep.ID} step={selStep} onSaved={onStepSaved} />}
          {selDecision && <DecisionDetail decision={selDecision} />}
          {!selStep && !selDecision && <p className="muted">Select a step or decision to see its source in the SOP and correct it.</p>}
        </aside>
      </div>
    </div>
  );
}

function StepEditor({ step, onSaved }: { step: ProcessStepsRead; onSaved: (s: ProcessStepsRead) => void }) {
  const [actor, setActor] = useState(step.Actor ?? '');
  const [action, setAction] = useState(step.Action ?? '');
  const [system, setSystem] = useState(step.SystemUsed ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = actor !== (step.Actor ?? '') || action !== (step.Action ?? '') || system !== (step.SystemUsed ?? '');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await saveStep(step.ID!, { Actor: actor, Action: action, SystemUsed: system });
      onSaved({ ...step, Actor: actor, Action: action, SystemUsed: system, Corrected: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h3>Step {step.Title}</h3>
      <div className="row" style={{ marginBottom: 8, gap: 6 }}>
        <span className="chip">§ {step.SourceSection || 'no section'}</span>
        {step.Inferred && <span className="chip flag-inferred">Inferred: not stated in the SOP</span>}
        {step.Corrected && <span className="chip flag-corrected">Corrected by analyst</span>}
      </div>
      {step.SourceQuote ? <div className="quote">“{step.SourceQuote}”</div> : <p className="muted">No source quote.</p>}
      <div className="field"><label htmlFor="actor">Actor</label><input id="actor" value={actor} onChange={(e) => setActor(e.target.value)} /></div>
      <div className="field"><label htmlFor="action">Action</label><textarea id="action" rows={3} value={action} onChange={(e) => setAction(e.target.value)} /></div>
      <div className="field"><label htmlFor="system">System</label><input id="system" value={system} onChange={(e) => setSystem(e.target.value)} /></div>
      <p className="muted" style={{ fontSize: 12 }}>Input: {step.StepInput || '—'} · Output: {step.StepOutput || '—'}</p>
      {error && <div className="banner error">{error}</div>}
      <button className="btn primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save correction'}</button>
    </div>
  );
}

function DecisionDetail({ decision }: { decision: SopAnalysis['decisions'][number] }) {
  return (
    <div>
      <h3>Decision {decision.Title}</h3>
      <p>{decision.Condition}</p>
      <div className="row" style={{ marginBottom: 8, gap: 6 }}>
        <span className="chip">after {decision.AfterStep}</span>
        <span className="chip">§ {decision.SourceSection || 'no section'}</span>
        {decision.Inferred && <span className="chip flag-inferred">Inferred</span>}
      </div>
      <table className="grid">
        <thead><tr><th>Branch</th><th>Goes to</th></tr></thead>
        <tbody>
          {decision.branches.map((b, i) => (
            <tr key={i}><td>{b.label}</td><td>{b.next_step === 'UNDEFINED' ? <span style={{ color: 'var(--critical)' }}>Not defined in SOP</span> : b.next_step}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
