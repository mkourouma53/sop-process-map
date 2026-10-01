export const LABELS: Record<string, string> = {
  digitize: 'Digitize',
  automate: 'Automate',
  ai_assist: 'AI assist',
  eliminate: 'Eliminate',
  keep_human: 'Keep human',
};

const CHANGE: Record<string, { text: string; color: string }> = {
  automated: { text: 'Automated', color: 'var(--chg-automated)' },
  digitized: { text: 'Digitized', color: 'var(--chg-digitized)' },
  ai_assisted: { text: 'AI assisted', color: 'var(--chg-ai)' },
  new: { text: 'New', color: 'var(--ink-muted)' },
  unchanged: { text: 'Unchanged', color: 'var(--border-strong)' },
};

// Recommendation labels map onto the same change colors their future-state steps get.
const LABEL_COLOR: Record<string, string> = {
  automate: 'var(--chg-automated)',
  digitize: 'var(--chg-digitized)',
  ai_assist: 'var(--chg-ai)',
  eliminate: 'var(--ink-muted)',
  keep_human: 'var(--border-strong)',
};

export const RISK_TYPES: Record<string, string> = {
  manual_handoff: 'Manual handoff',
  rekeying: 'Re-keying',
  missing_control: 'Missing control',
  undefined_exception: 'Undefined exception',
  single_point_of_failure: 'Single point of failure',
  vague_ownership_or_timing: 'Vague ownership or timing',
  conflicting_rule: 'Conflicting rule',
};

export function LabelChip({ label }: { label: string }) {
  return (
    <span className="chip">
      <span className="dot" style={{ background: LABEL_COLOR[label] ?? 'var(--border-strong)' }} />
      {LABELS[label] ?? label}
    </span>
  );
}

export function ChangeChip({ change }: { change: string }) {
  const c = CHANGE[change] ?? CHANGE.unchanged;
  return (
    <span className="chip">
      <span className="dot" style={{ background: c.color }} />
      {c.text}
    </span>
  );
}

const SEVERITY: Record<string, { icon: string; color: string; text: string }> = {
  high: { icon: '▲', color: 'var(--critical)', text: 'High' },
  medium: { icon: '◆', color: 'var(--serious)', text: 'Medium' },
  low: { icon: '●', color: 'var(--warning)', text: 'Low' },
};

export function SeverityChip({ severity }: { severity: string }) {
  const s = SEVERITY[severity] ?? SEVERITY.low;
  return (
    <span className="chip">
      <span aria-hidden="true" style={{ color: s.color }}>{s.icon}</span>
      {s.text}
    </span>
  );
}

const STATUS: Record<string, { icon: string; color: string }> = {
  Uploaded: { icon: '○', color: 'var(--ink-muted)' },
  Analyzing: { icon: '◐', color: 'var(--accent)' },
  Analyzed: { icon: '●', color: 'var(--accent)' },
  'In review': { icon: '◆', color: 'var(--warning)' },
  'Ready for owner': { icon: '◆', color: 'var(--serious)' },
  'With owner': { icon: '◐', color: 'var(--serious)' },
  'Changes requested': { icon: '↺', color: 'var(--critical)' },
  Approved: { icon: '✓', color: 'var(--good)' },
  Failed: { icon: '✕', color: 'var(--critical)' },
  Proposed: { icon: '○', color: 'var(--ink-muted)' },
  Rejected: { icon: '✕', color: 'var(--critical)' },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.Uploaded;
  return (
    <span className="chip">
      <span aria-hidden="true" style={{ color: s.color }}>{s.icon}</span>
      {status || 'Uploaded'}
    </span>
  );
}
