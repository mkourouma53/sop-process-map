import type { RecommendationsRead } from '../generated/models/RecommendationsModel';
import type { HistoryEntry, SopAnalysis } from '../data';
import { choice } from '../data';
import { LabelChip } from './Badges';

const advice = (r: RecommendationsRead) => choice(r.AnalystRec) || 'Pending';
const decision = (r: RecommendationsRead) => choice(r.RecStatus) || 'Proposed';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '');

interface Props {
  analysis: SopAnalysis;
  history: HistoryEntry[];
  onOpenChange: (title: string) => void;
}

/** Batches sent to the owner, what was in each, and every decision with who made it and when. */
export function ReviewLog({ analysis, history, onOpenChange }: Props) {
  const batchNos = [...new Set(analysis.recommendations.map((r) => r.BatchNo).filter((b): b is number => !!b))].sort((a, b) => b - a);
  const unsent = analysis.recommendations.filter((r) => !r.BatchNo && advice(r) !== 'Pending');
  const notReviewed = analysis.recommendations.filter((r) => advice(r) === 'Pending' && decision(r) === 'Proposed').length;

  return (
    <div className="stack">
      <div className="row">
        <span className="chip">{batchNos.length} batch{batchNos.length === 1 ? '' : 'es'} sent</span>
        <span className="chip">{unsent.length} reviewed but not sent</span>
        <span className="chip">{notReviewed} not reviewed by the analyst</span>
      </div>

      {unsent.length > 0 && (
        <section className="panel">
          <h3>Not sent yet ({unsent.length})</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>These go out in the next batch when the analyst clicks Send to owner.</p>
          <ChangeTable rows={unsent} analysis={analysis} onOpenChange={onOpenChange} />
        </section>
      )}

      {batchNos.map((n) => {
        const rows = analysis.recommendations.filter((r) => r.BatchNo === n);
        const decided = rows.filter((r) => decision(r) !== 'Proposed').length;
        const events = history.filter((h) => h.BatchNo === n);
        const sent = events.find((h) => (h.Title ?? '').startsWith(`Batch ${n} sent`));
        const failed = events.find((h) => (h.Title ?? '').includes('could not be emailed'));
        return (
          <section key={n} className="panel">
            <div className="row">
              <h3 style={{ margin: 0 }}>Batch {n}</h3>
              <span className={`chip${decided === rows.length ? ' decision-approved' : ''}`}>{decided} of {rows.length} decided</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {sent ? `Emailed to ${sent.Person} · ${when(sent.Created)}` : failed ? '' : 'Not emailed (sent before email delivery was fixed)'}
              </span>
            </div>
            {failed && <div className="banner error" style={{ marginTop: 8 }}>The email did not go out: {failed.Comments}</div>}
            <ChangeTable rows={rows} analysis={analysis} onOpenChange={onOpenChange} />
            {events.filter((h) => h !== sent && h !== failed).length > 0 && (
              <ol className="history">
                {events.filter((h) => h !== sent && h !== failed).map((h) => (
                  <li key={h.ID}><span className="muted">{when(h.Created)}</span> · {h.Title}{h.Person ? ` · ${h.Person}` : ''}{h.Comments ? ` · “${h.Comments}”` : ''}</li>
                ))}
              </ol>
            )}
          </section>
        );
      })}

      {batchNos.length === 0 && unsent.length === 0 && (
        <div className="panel empty">Nothing reviewed yet. The analyst recommends or drops changes on the Recommended changes tab, then sends them to the process owner.</div>
      )}
    </div>
  );
}

function ChangeTable({ rows, analysis, onOpenChange }: { rows: RecommendationsRead[]; analysis: SopAnalysis; onOpenChange: (t: string) => void }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <table className="grid">
        <thead><tr><th>Change</th><th>Step</th><th>Proposed change</th><th>Analyst</th><th>Owner</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ID}>
              <td style={{ whiteSpace: 'nowrap' }}><button className="link" onClick={() => onOpenChange(r.Title)}>{r.Title}</button> <LabelChip label={choice(r.Label)} /></td>
              <td>{r.StepRef}</td>
              <td>{r.ProposedChange || analysis.richRecs.get(r.Title)?.proposed_change || r.Reason}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{advice(r) === 'Recommend' ? 'Recommended' : advice(r) === 'Drop' ? 'Dropped' : 'Not reviewed'}{r.AnalystNote ? <div className="muted" style={{ fontSize: 12, whiteSpace: 'normal' }}>{r.AnalystNote}</div> : null}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {decision(r) === 'Proposed' ? <span className="muted">Not decided</span> : decision(r)}
                {decision(r) === 'Rejected' && r.RejectionReason ? <div className="muted" style={{ fontSize: 12, whiteSpace: 'normal' }}>{r.RejectionReason}</div> : null}
                {decision(r) === 'Approved' && r.OwnerNote ? <div className="muted" style={{ fontSize: 12, whiteSpace: 'normal' }}>{r.OwnerNote}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
