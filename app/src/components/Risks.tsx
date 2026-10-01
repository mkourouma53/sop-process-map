import { useState } from 'react';
import type { SopAnalysis } from '../data';
import { choice } from '../data';
import { RISK_TYPES, SeverityChip } from './Badges';
import { ScopeToggle, Select, stepNum, type Scope } from './Filters';

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

interface Props {
  analysis: SopAnalysis;
  process: string;
  onOpenChange: (recTitle: string) => void;
}

export function Risks({ analysis, process, onOpenChange }: Props) {
  const [scope, setScope] = useState<Scope>('process');
  const [severity, setSeverity] = useState('all');
  const [riskType, setRiskType] = useState('all');

  const stepById = new Map(analysis.steps.map((s) => [s.Title, s]));
  const inProcess = new Set(analysis.processes.find((p) => p.name === process)?.stepIds ?? []);
  const risks = analysis.risks
    // v3 tags each risk with its process; older runs fall back to the step's process.
    .filter((r) => (scope === 'all' || (analysis.richRisks.get(r.Title)?.process ?? '') === process || inProcess.has(r.StepRef ?? '')) &&
      (severity === 'all' || choice(r.Severity) === severity) && (riskType === 'all' || choice(r.RiskType) === riskType))
    .sort((a, b) => (SEVERITY_RANK[choice(a.Severity)] ?? 3) - (SEVERITY_RANK[choice(b.Severity)] ?? 3) || stepNum(a.StepRef) - stepNum(b.StepRef));
  const presentTypes = [...new Set(analysis.risks.map((r) => choice(r.RiskType)))];

  return (
    <div className="stack">
      <div className="row panel" style={{ padding: 12 }}>
        <ScopeToggle value={scope} onChange={setScope} />
        <span className="spacer" />
        <Select label="Severity" value={severity} onChange={setSeverity} options={[['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} />
        <Select label="Type" value={riskType} onChange={setRiskType} options={[['all', 'All types'], ...presentTypes.map((t) => [t, RISK_TYPES[t] ?? t] as [string, string])]} />
      </div>
      <h2 style={{ margin: 0 }}>{risks.length} risk{risks.length === 1 ? '' : 's'}</h2>
      {risks.length === 0 ? <div className="panel empty">No risks match these filters.</div> : (
        <div className="stack" style={{ gap: 12 }}>
          {risks.map((r) => {
            const rich = analysis.richRisks.get(r.Title);
            const step = stepById.get(r.StepRef ?? '');
            // v3 links risks to the changes that fix them; older runs fall back to changes on the same step.
            const fixes = rich?.addressed_by?.length
              ? analysis.recommendations.filter((x) => rich.addressed_by!.includes(x.Title))
              : analysis.recommendations.filter((x) => x.StepRef === r.StepRef && choice(x.Label) !== 'keep_human');
            return (
              <article key={r.ID} className="card">
                <div className="row" style={{ gap: 6 }}>
                  <SeverityChip severity={choice(r.Severity)} />
                  <span className="chip">{RISK_TYPES[choice(r.RiskType)] ?? choice(r.RiskType)}</span>
                  <span className="chip" title={step?.Action}>{r.StepRef}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{step ? `${step.Actor}: ${step.Action}` : ''}</span>
                </div>
                <dl className="facts">
                  <dt>What could go wrong</dt><dd>{rich?.what_could_go_wrong || r.Description}</dd>
                  {rich?.cause && <><dt>Why (from the SOP)</dt><dd>{rich.cause}</dd></>}
                  {rich?.impact && <><dt>Impact on the process</dt><dd>{rich.impact}</dd></>}
                  {rich?.quantified_impact?.length ? (
                    <><dt>By the numbers</dt><dd className="row" style={{ gap: 6 }}>
                      {rich.quantified_impact.map((q, i) => <span key={i} className="chip" title={q.basis}><b>{q.value}</b>&nbsp;{q.metric}</span>)}
                    </dd></>
                  ) : null}
                  {rich?.severity_reason && <><dt>Why {choice(r.Severity)} severity</dt><dd>{rich.severity_reason}</dd></>}
                  <dt>Recommended fix</dt>
                  <dd>
                    {fixes.length ? fixes.map((f) => (
                      <button key={f.ID} className="link" style={{ display: 'block', textAlign: 'left' }} onClick={() => onOpenChange(f.Title)}>
                        {f.Title}: {analysis.richRecs.get(f.Title)?.proposed_change || f.Reason}
                      </button>
                    )) : <span className="muted">No change proposed for this risk.</span>}
                  </dd>
                </dl>
                {!rich?.what_could_go_wrong && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Cause, impact, and severity reasoning appear after the SOP is re-analyzed with the current prompt.</p>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
