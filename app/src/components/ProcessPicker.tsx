import type { ProcessStepsRead } from '../generated/models/ProcessStepsModel';
import type { SopAnalysis } from '../data';
import type { FlowNode } from './Swimlane';

/** Steps and decisions belonging to one process, in flow order. */
export function processSlice(analysis: SopAnalysis, processName: string) {
  const ids = new Set(analysis.processes.find((p) => p.name === processName)?.stepIds ?? []);
  const steps = analysis.steps.filter((s) => ids.has(s.Title));
  const decisions = analysis.decisions.filter((d) => ids.has(d.AfterStep ?? ''));
  return { ids, steps, decisions };
}

export function currentNodes(steps: ProcessStepsRead[], decisions: SopAnalysis['decisions'], eliminated?: Set<string>): FlowNode[] {
  const nodes: FlowNode[] = [];
  for (const s of steps) {
    nodes.push({
      id: s.Title, kind: 'step', lane: s.Actor?.trim() || 'Unassigned', text: s.Action ?? '',
      tooltip: `${s.Action}\n§ ${s.SourceSection ?? ''}`, inferred: !!s.Inferred, corrected: !!s.Corrected,
      struck: eliminated?.has(s.Title), badge: eliminated?.has(s.Title) ? 'eliminated' : undefined,
    });
    for (const d of decisions.filter((x) => x.AfterStep === s.Title)) {
      nodes.push({
        id: d.Title, kind: 'decision', lane: s.Actor?.trim() || 'Unassigned', text: d.Condition ?? '', inferred: !!d.Inferred,
        branches: d.branches.map((b) => ({ label: b.label, to: b.next_step })),
      });
    }
  }
  return nodes;
}

interface Props {
  analysis: SopAnalysis;
  value: string;
  onChange: (name: string) => void;
}

export function ProcessPicker({ analysis, value, onChange }: Props) {
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        This SOP contains {analysis.processes.length} process{analysis.processes.length === 1 ? '' : 'es'}. Each is mapped on its own.
      </div>
      <div className="row" style={{ gap: 6 }} role="tablist" aria-label="Processes in this SOP">
        {analysis.processes.map((p) => (
          <button key={p.name} role="tab" aria-selected={p.name === value} className={`pill${p.name === value ? ' active' : ''}`} onClick={() => onChange(p.name)}>
            {p.name} <span className="muted">· {p.stepIds.length}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
