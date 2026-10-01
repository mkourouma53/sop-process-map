export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="row" style={{ gap: 6 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

export type Scope = 'process' | 'all';

export function ScopeToggle({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Scope">
      <button role="radio" aria-checked={value === 'process'} onClick={() => onChange('process')}>This process</button>
      <button role="radio" aria-checked={value === 'all'} onClick={() => onChange('all')}>Whole SOP</button>
    </div>
  );
}

export const stepNum = (ref?: string) => Number((ref ?? '').replace(/\D/g, '')) || 0;
