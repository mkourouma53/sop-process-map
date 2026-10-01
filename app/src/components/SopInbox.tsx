import type { SOPsRead } from '../generated/models/SOPsModel';
import { IS_DEMO, choice } from '../data';
import { StatusChip } from './Badges';

export const SITE_URL = 'https://consultonyx.sharepoint.com/sites/sop-process-map';
export const sopName = (s: SOPsRead) => (s['{Name}'] ?? s.Title ?? `SOP ${s.ID}`).replace(/\.pdf$/i, '');

interface Props {
  sops: SOPsRead[];
  onOpen: (sop: SOPsRead) => void;
}

export function SopInbox({ sops, onOpen }: Props) {
  return (
    <div className="stack">
      <div className="row">
        <div>
          <h1>SOP inbox</h1>
          <p className="sub">{IS_DEMO ? 'Public SOPs from different industries, each analyzed by the AI pipeline.' : 'Every uploaded SOP and where it is in review. Uploading a file starts the AI analysis.'}</p>
        </div>
        <span className="spacer" />
        {!IS_DEMO && <a className="btn primary" href={`${SITE_URL}/SOPs`} target="_blank" rel="noreferrer">Upload SOP</a>}
      </div>

      {sops.length === 0 ? (
        <div className="panel empty">No SOPs yet. Upload a PDF or Word file to the SOPs library to start.</div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <table className="grid">
            <thead>
              <tr><th>SOP</th><th>Industry</th><th>Status</th><th>Owner</th><th>Modified</th></tr>
            </thead>
            <tbody>
              {sops.map((s) => (
                <tr key={s.ID} className="clickable" onClick={() => onOpen(s)}>
                  <td><button className="link" onClick={(e) => { e.stopPropagation(); onOpen(s); }}>{IS_DEMO ? s.Title : sopName(s)}</button></td>
                  <td>{s.Department || <span className="muted">—</span>}</td>
                  <td><StatusChip status={choice(s.SOPStatus)} /></td>
                  <td>{s.ProcessOwner || <span className="muted">—</span>}</td>
                  <td className="muted">{s.Modified ? new Date(s.Modified).toLocaleDateString() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
