export interface FlowNode {
  id: string;
  kind: 'step' | 'decision';
  lane: string;               // actor / role
  text: string;
  tooltip?: string;
  branches?: { label: string; to: string }[];  // decisions only
  inferred?: boolean;
  corrected?: boolean;
  struck?: boolean;           // eliminated in the future state
  accent?: string;            // CSS color for a change badge stripe
  badge?: string;             // short text shown with the accent (never color alone)
}

export type FlowMode = 'lanes' | 'simple';

const HEADER_H = 40;
const DIAMOND = 24;
const MAX_LABEL = 60;  // longer branch labels are cut; the full text shows on hover

interface Props {
  nodes: FlowNode[];
  mode?: FlowMode;
  highlight?: Set<string> | null;   // ids to emphasize; everything else is dimmed
  selected?: string | null;
  onSelect?: (id: string) => void;
  label: string;
}

/**
 * Vertical flowchart. `lanes`: one column per role (cross-functional swimlanes, handoffs visible as lane changes).
 * `simple`: a single column with the role written inside each box.
 */
export function Swimlane({ nodes, mode = 'lanes', highlight, selected, onSelect, label }: Props) {
  const lanesMode = mode === 'lanes';
  const LANE_W = lanesMode ? 190 : 300;
  const BOX_W = lanesMode ? 166 : 268;
  const BOX_H = lanesMode ? 66 : 74;
  const ROW_H = BOX_H + 28;
  const top = lanesMode ? HEADER_H : 12;

  const lanes: string[] = [];
  if (lanesMode) { for (const n of nodes) if (!lanes.includes(n.lane)) lanes.push(n.lane); } else lanes.push('');
  const laneIndex = (n: FlowNode) => (lanesMode ? lanes.indexOf(n.lane) : 0);
  const width = Math.max(lanes.length, 1) * LANE_W;
  const height = top + Math.max(nodes.length, 1) * ROW_H + 16;
  const pos = new Map(nodes.map((n, i) => [n.id, { x: laneIndex(n) * LANE_W + LANE_W / 2, y: top + i * ROW_H + ROW_H / 2, i }]));
  const half = (n: FlowNode) => (n.kind === 'step' ? BOX_H / 2 : DIAMOND * 1.42);
  const sideHalf = (n: FlowNode) => (n.kind === 'step' ? BOX_W / 2 : DIAMOND * 1.42);
  const dim = (id: string) => (highlight && !highlight.has(id) ? 0.25 : 1);

  const edges: { d: string; labels: string[]; lx: number; ly: number; faded: boolean }[] = [];
  const stubs: { x: number; y: number; text: string; full: string; faded: boolean }[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const link = (a: FlowNode, b: FlowNode, labels: string[] = []) => {
    const p = pos.get(a.id)!, q = pos.get(b.id)!;
    const faded = !!highlight && !(highlight.has(a.id) || highlight.has(b.id));
    if (q.i > p.i) {
      const y1 = p.y + half(a), y2 = q.y - half(b), my = y1 + 12;
      const straight = p.x === q.x;
      edges.push({ d: straight ? `M${p.x},${y1} V${y2}` : `M${p.x},${y1} V${my} H${q.x} V${y2}`, labels, lx: straight ? p.x + 8 : (p.x + q.x) / 2, ly: straight ? y1 + 11 : my - 4 - (labels.length - 1) * 12, faded });
    } else {
      // loop back up: leave on the right side and re-enter the target from the right
      const ox = Math.max(p.x + sideHalf(a), q.x + sideHalf(b)) + 14;
      edges.push({ d: `M${p.x + sideHalf(a)},${p.y} H${ox} V${q.y} H${q.x + sideHalf(b)}`, labels, lx: ox + 4, ly: (p.y + q.y) / 2, faded });
    }
  };
  nodes.forEach((n, i) => {
    if (n.kind === 'decision' && n.branches?.length) {
      // Branches that lead to the same step share one arrow, with their labels stacked.
      const byTarget = new Map<string, string[]>();
      n.branches.forEach((b) => { if (byId.has(b.to)) byTarget.set(b.to, [...(byTarget.get(b.to) ?? []), b.label]); });
      byTarget.forEach((labels, to) => link(n, byId.get(to)!, labels));
      n.branches.forEach((b, k) => {
        if (!byId.has(b.to)) {
          const p = pos.get(n.id)!;
          const end = b.to === 'END' ? 'end' : b.to === 'UNDEFINED' ? 'not defined in SOP' : `${b.to} (other process)`;
          stubs.push({ x: p.x + DIAMOND * 1.42 + 6, y: lanesMode ? p.y - 6 + k * 14 : p.y + 26 + k * 14, text: `${b.label.length > MAX_LABEL ? `${b.label.slice(0, MAX_LABEL - 1)}…` : b.label} → ${end}`, full: `${b.label} → ${end}`, faded: !!highlight && !highlight.has(n.id) });
        }
      });
      return;
    }
    if (nodes[i + 1]) link(n, nodes[i + 1]);
  });

  return (
    <svg width={width + 200} height={height} role="img" aria-label={label}>
      <defs>
        <marker id="arrow-v" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-muted)" />
        </marker>
      </defs>
      {lanesMode && lanes.map((lane, i) => (
        <g key={lane}>
          <rect x={i * LANE_W} y={0} width={LANE_W} height={height} fill={i % 2 ? 'var(--surface-2)' : 'var(--surface)'} />
          <foreignObject x={i * LANE_W + 6} y={4} width={LANE_W - 12} height={HEADER_H - 6}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', textAlign: 'center', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{lane}</div>
          </foreignObject>
        </g>
      ))}
      {lanesMode && <line x1={0} y1={HEADER_H} x2={width} y2={HEADER_H} stroke="var(--border-strong)" />}
      {edges.map((e, i) => (
        <g key={i} opacity={e.faded ? 0.25 : 1}>
          <path d={e.d} fill="none" stroke="var(--ink-muted)" strokeWidth={1.5} markerEnd="url(#arrow-v)" />
          {e.labels.map((l, k) => (
            <text key={k} x={e.lx} y={e.ly + k * 12} fontSize={11} fill="var(--ink-2)" paintOrder="stroke" stroke="var(--surface)" strokeWidth={4}>
              <title>{l}</title>{l.length > MAX_LABEL ? `${l.slice(0, MAX_LABEL - 1)}…` : l}
            </text>
          ))}
        </g>
      ))}
      {stubs.map((s, i) => (
        <text key={i} x={s.x} y={s.y} fontSize={11} fill="var(--ink-2)" opacity={s.faded ? 0.25 : 1} paintOrder="stroke" stroke="var(--surface)" strokeWidth={4}><title>{s.full}</title>{s.text}</text>
      ))}
      {nodes.map((n) => {
        const { x, y } = pos.get(n.id)!;
        const isSel = n.id === selected;
        const isHi = !!highlight?.has(n.id);
        const click = onSelect ? () => onSelect(n.id) : undefined;
        if (n.kind === 'decision') {
          return (
            <g key={n.id} onClick={click} opacity={dim(n.id)} style={{ cursor: click ? 'pointer' : 'default' }} role={click ? 'button' : undefined} aria-label={`Decision ${n.id}: ${n.text}`}>
              <title>{n.text}</title>
              {isHi && <rect x={x - DIAMOND - 6} y={y - DIAMOND - 6} width={(DIAMOND + 6) * 2} height={(DIAMOND + 6) * 2} transform={`rotate(45 ${x} ${y})`} rx={5} fill="none" stroke="var(--accent)" strokeWidth={3} />}
              <rect x={x - DIAMOND} y={y - DIAMOND} width={DIAMOND * 2} height={DIAMOND * 2} transform={`rotate(45 ${x} ${y})`} rx={3}
                fill="var(--surface)" stroke={isSel ? 'var(--accent)' : 'var(--ink-2)'} strokeWidth={isSel ? 2.5 : 1.5} strokeDasharray={n.inferred ? '4 3' : undefined} />
              <text x={x} y={y + 4} fontSize={11} fontWeight={600} textAnchor="middle" fill="var(--ink)">{n.id}</text>
              {!lanesMode && (
                <foreignObject x={x + DIAMOND * 1.42 + 6} y={y - 22} width={BOX_W} height={34}>
                  <div style={{ fontSize: 11, lineHeight: 1.25, color: 'var(--ink-2)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{n.text}</div>
                </foreignObject>
              )}
            </g>
          );
        }
        const stroke = isSel || isHi ? 'var(--accent)' : n.inferred ? 'var(--warning)' : 'var(--border-strong)';
        return (
          <g key={n.id} onClick={click} opacity={dim(n.id) * (n.struck ? 0.6 : 1)} style={{ cursor: click ? 'pointer' : 'default' }} role={click ? 'button' : undefined} aria-label={`Step ${n.id}: ${n.lane}: ${n.text}`}>
            <title>{n.tooltip ?? n.text}</title>
            <rect x={x - BOX_W / 2} y={y - BOX_H / 2} width={BOX_W} height={BOX_H} rx={6} fill="var(--surface)"
              stroke={stroke} strokeWidth={isSel || isHi ? 3 : n.inferred ? 2 : 1} strokeDasharray={!isHi && (n.inferred || n.struck) ? '5 3' : undefined} />
            {n.accent && <rect x={x - BOX_W / 2} y={y - BOX_H / 2} width={5} height={BOX_H} rx={2} fill={n.accent} />}
            <foreignObject x={x - BOX_W / 2 + 10} y={y - BOX_H / 2 + 4} width={BOX_W - 16} height={BOX_H - 8}>
              <div style={{ fontSize: 11, lineHeight: 1.25, color: 'var(--ink)', textDecoration: n.struck ? 'line-through' : undefined }}>
                {!lanesMode && <div style={{ fontWeight: 600, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.lane}</div>}
                <div style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: lanesMode ? 3 : 2, WebkitBoxOrient: 'vertical' }}>
                  <b>{n.id}</b>{n.corrected ? ' ✎' : ''}{n.badge ? ` · ${n.badge}` : ''} {n.text}
                </div>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

export function ModeToggle({ value, onChange }: { value: FlowMode; onChange: (m: FlowMode) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Diagram layout">
      <button role="radio" aria-checked={value === 'lanes'} onClick={() => onChange('lanes')}>Swimlanes</button>
      <button role="radio" aria-checked={value === 'simple'} onClick={() => onChange('simple')}>Simple flow</button>
    </div>
  );
}
