import { useCallback, useEffect, useState } from 'react';
import type { SOPsRead } from './generated/models/SOPsModel';
import type { RecommendationsRead } from './generated/models/RecommendationsModel';
import type { ProcessStepsRead } from './generated/models/ProcessStepsModel';
import type { SopAnalysis } from './data';
import { IS_DEMO, choice, getUserContext, loadAnalysis, loadHistory, loadSops, logReview, modelName, sendBatch, setIndustry, setSopStatus, type HistoryEntry, type Role } from './data';
import { ReviewLog } from './components/ReviewLog';
import { ProcessPicker } from './components/ProcessPicker';
import { SopInbox, sopName } from './components/SopInbox';
import { ProcessMap } from './components/ProcessMap';
import { Risks } from './components/Risks';
import { Changes } from './components/Changes';
import { FutureState } from './components/FutureState';
import type { FlowMode } from './components/Swimlane';
import { AskAI } from './components/AskAI';
import { StatusChip } from './components/Badges';

type View = { page: 'inbox' } | { page: 'sop'; sop: SOPsRead };
type Tab = 'map' | 'risks' | 'changes' | 'future' | 'log';
const TABS: [Tab, string][] = [['map', 'Process map'], ['risks', 'Risks'], ['changes', 'Recommended changes'], ['future', 'Current vs future'], ['log', 'Review log']];

// Deep links: #sop=2&tab=future&process=... (used for README links and screenshots)
const readHash = () => new URLSearchParams(window.location.hash.slice(1));
const INITIAL_LINK = readHash();  // captured before any navigation rewrites the hash
function writeHash(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  history.replaceState(null, '', `#${q.toString()}`);
}

export default function App() {
  const [view, setView] = useState<View>({ page: 'inbox' });
  const [sops, setSops] = useState<SOPsRead[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState('');
  const [role, setRole] = useState<Role>('analyst');

  const refreshSops = useCallback(async () => {
    try {
      const [loaded, ctx] = await Promise.all([loadSops(), getUserContext().catch(() => null)]);
      if (ctx) {
        setUser(ctx.userEmail);
        // Links from approval requests arrive as app query parameters (?sopId=2&tab=changes).
        if (ctx.params.sopId && !INITIAL_LINK.get('sop')) INITIAL_LINK.set('sop', ctx.params.sopId);
        if (ctx.params.tab && !INITIAL_LINK.get('tab')) INITIAL_LINK.set('tab', ctx.params.tab);
        if (ctx.params.batch && !INITIAL_LINK.get('batch')) INITIAL_LINK.set('batch', ctx.params.batch);
      }
      setSops(loaded);
      const wanted = Number(INITIAL_LINK.get('sop'));
      const sop = loaded.find((x) => x.ID === wanted);
      if (sop) setView((v) => (v.page === 'inbox' ? { page: 'sop', sop } : v));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load SOPs');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refreshSops(); }, [refreshSops]);

  const openSop = (sop: SOPsRead) => setView({ page: 'sop', sop });

  // Opening an SOP: the process owner arriving from a batch email starts in the owner view.
  useEffect(() => {
    if (view.page !== 'sop') return;
    const owner = view.sop.ProcessOwner?.toLowerCase();
    setRole(!!user && owner === user.toLowerCase() && INITIAL_LINK.get('batch') ? 'owner' : 'analyst');
  }, [view.page === 'sop' ? view.sop.ID : 0, user]);

  useEffect(() => { if (view.page !== 'sop') writeHash({}); }, [view.page]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">SOP to Process Map</span>
        <nav className="nav" aria-label="Main">
          <button aria-current="page" onClick={() => { setView({ page: 'inbox' }); refreshSops(); }}>SOP inbox</button>
        </nav>
        <span className="spacer" />
        {view.page === 'sop' && (
          <div className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Viewing as</span>
            <div className="segmented" role="radiogroup" aria-label="Review role">
              <button role="radio" aria-checked={role === 'analyst'} onClick={() => setRole('analyst')}>Analyst</button>
              <button role="radio" aria-checked={role === 'owner'} onClick={() => setRole('owner')}>Process owner</button>
            </div>
          </div>
        )}
      </header>
      <main>
        {IS_DEMO && (
          <div className="banner" style={{ marginBottom: 16 }}>
            <b>Public demo.</b> Real AI analyses of public government SOPs, shown in the same screens as the production app
            (a Power Apps code app on SharePoint and Power Automate). Your corrections and approvals are saved only in this browser.
          </div>
        )}
        {error && <div className="banner error" style={{ marginBottom: 16 }}>{error}</div>}
        {loading ? <div className="empty">Loading…</div> : (
          <>
            {view.page === 'inbox' && <SopInbox sops={sops} onOpen={openSop} />}
            {view.page === 'sop' && (
              <SopDetail key={view.sop.ID} sop={view.sop} user={user} role={role} onBack={() => setView({ page: 'inbox' })}
                onStatusChange={(s) => { setView({ page: 'sop', sop: s }); setSops((all) => all.map((x) => (x.ID === s.ID ? s : x))); }} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function SopDetail({ sop, user, role, onBack, onStatusChange }: { sop: SOPsRead; user: string; role: Role; onBack: () => void; onStatusChange: (s: SOPsRead) => void }) {
  const [analysis, setAnalysis] = useState<SopAnalysis | null>(null);
  const [tab, setTab] = useState<Tab>(() => (TABS.some(([t]) => t === INITIAL_LINK.get('tab')) ? INITIAL_LINK.get('tab') as Tab : 'map'));
  const [process, setProcess] = useState('');
  const [mode, setMode] = useState<FlowMode>(INITIAL_LINK.get('layout') === 'simple' ? 'simple' : 'lanes');
  const [focusRec, setFocusRec] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askUsed, setAskUsed] = useState(false);  // keep the conversation after the panel is closed
  useEffect(() => { document.body.classList.toggle('ask-open', askOpen); return () => document.body.classList.remove('ask-open'); }, [askOpen]);
  const openChange = (recTitle: string) => { setFocusRec(recTitle); setTab('changes'); };
  useEffect(() => { if (process) writeHash({ sop: sop.ID, tab, process }); }, [sop.ID, tab, process]);
  const [error, setError] = useState('');
  const status = choice(sop.SOPStatus) || 'Analyzed';
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const refreshHistory = () => { if (!IS_DEMO) loadHistory(sop.ID!).then(setHistory, () => setHistory([])); };
  useEffect(refreshHistory, [sop.ID, status]);

  useEffect(() => {
    loadAnalysis(sop.ID!).then((a) => {
      setAnalysis(a);
      const wanted = INITIAL_LINK.get('process');
      setProcess(a.processes.some((p) => p.name === wanted) ? wanted! : a.processes[0]?.name ?? '');
    },
      (e) => setError(e instanceof Error ? e.message : 'Could not load the analysis'));
  }, [sop.ID]);

  const recs = analysis?.recommendations ?? [];
  const sent = recs.filter((r) => r.BatchNo);
  const undecided = sent.filter((r) => (choice(r.RecStatus) || 'Proposed') === 'Proposed');
  const unsent = recs.filter((r) => !r.BatchNo && ['Recommend', 'Drop'].includes(choice(r.AnalystRec)));
  const setStatusLocal = (value: string, extra: Partial<SOPsRead> = {}) =>
    onStatusChange({ ...sop, ...extra, SOPStatus: { ...(sop.SOPStatus ?? { '@odata.type': '', Id: 0 }), Value: value } });

  const updateStep = (s: ProcessStepsRead) => setAnalysis((a) => a && { ...a, steps: a.steps.map((x) => (x.ID === s.ID ? s : x)) });

  /** Every owner decision is logged; when the owner has decided everything sent so far, the SOP is "Owner reviewed". */
  async function updateRec(r: RecommendationsRead) {
    const before = recs.find((x) => x.ID === r.ID);
    const next = recs.map((x) => (x.ID === r.ID ? r : x));
    setAnalysis((a) => a && { ...a, recommendations: next });
    const was = choice(before?.RecStatus) || 'Proposed', now = choice(r.RecStatus) || 'Proposed';
    if (was === now || IS_DEMO) return;
    try {
      const verb = now === 'Proposed' ? 'decision undone' : now.toLowerCase();
      await logReview(sop.ID!, `${r.Title} ${verb} by process owner`, user, now === 'Rejected' ? r.RejectionReason ?? '' : r.OwnerNote ?? '', r.BatchNo);
      const stillOpen = next.filter((x) => x.BatchNo && (choice(x.RecStatus) || 'Proposed') === 'Proposed').length;
      if (r.BatchNo && stillOpen === 0 && status !== 'Owner reviewed') {
        await setSopStatus(sop.ID!, 'Owner reviewed');
        await logReview(sop.ID!, 'Owner decided every change sent so far', user, '', r.BatchNo);
        setStatusLocal('Owner reviewed');
      } else if (stillOpen > 0 && status === 'Owner reviewed') {
        await setSopStatus(sop.ID!, 'With owner');
        setStatusLocal('With owner');
      }
      refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the decision');
    }
  }

  const [sending, setSending] = useState(false);
  async function send(email: string) {
    try {
      const { batch, ids, emailError } = await sendBatch(sop.ID!, email, recs);
      setAnalysis((a) => a && { ...a, recommendations: a.recommendations.map((x) => (ids.has(x.ID) ? { ...x, BatchNo: batch } : x)) });
      setStatusLocal('With owner', { ProcessOwner: email, CurrentBatch: batch });
      setSending(false);
      refreshHistory();
      setTab('log');
      if (emailError) setError(`Batch ${batch} was saved but the email did not go out: ${emailError}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send to the owner');
    }
  }
  const canSend = !IS_DEMO && unsent.length > 0;

  return (
    <div className="stack">
      <div>
        <button className="link" onClick={onBack}>← SOP inbox</button>
        <div className="row" style={{ marginTop: 8 }}>
          <h1 style={{ margin: 0 }}>{IS_DEMO ? sop.Title : sopName(sop)}</h1>
          <StatusChip status={status} />
          <span className="spacer" />
          {canSend && !sending && (
            <button className="btn primary" onClick={() => setSending(true)}>Send {unsent.length} to process owner</button>
          )}
        </div>
        <p className="sub row" style={{ marginTop: 6, gap: 6 }}>
          <IndustryField value={sop.Department ?? ''} onSave={async (v) => { await setIndustry(sop.ID!, v); onStatusChange({ ...sop, Department: v }); }} />
          {analysis?.model && <span>· Analyzed with {modelName(analysis.model)}</span>}
        </p>
        {sending && analysis && <SendToOwner initial={sop.ProcessOwner || user} user={user} unsent={unsent} onSend={send} onCancel={() => setSending(false)} />}
        {sop.ProcessOwner && sent.length > 0 && (
          <div className="banner" style={{ marginTop: 12 }}>
            {undecided.length ? <><b>{undecided.length}</b> of {sent.length} sent changes are waiting on <b>{sop.ProcessOwner}</b>.</>
                : <><b>{sop.ProcessOwner}</b> has decided all {sent.length} changes sent so far.</>}
            {' '}<button className="link" onClick={() => setTab('log')}>Open the review log</button>
          </div>
        )}
      </div>
      {error && <div className="banner error">{error}</div>}
      {!analysis ? <div className="empty">Loading analysis…</div> : analysis.steps.length === 0 ? (
        <div className="panel empty">No analysis yet. It appears here once the Analyze SOP flow finishes.</div>
      ) : (
        <>
          <ProcessPicker analysis={analysis} value={process} onChange={setProcess} />
          <div className="tabs" role="tablist">
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setFocusRec(null); }}>
                {label}{t === 'changes' && role === 'owner' && undecided.length ? ` (${undecided.length} to decide)` : ''}
              </button>
            ))}
          </div>
          {tab === 'map' && <ProcessMap key={process} analysis={analysis} process={process} mode={mode} onModeChange={setMode} onStepSaved={updateStep} initialHighlight={INITIAL_LINK.get('highlight')} />}
          {tab === 'risks' && <Risks analysis={analysis} process={process} onOpenChange={openChange} />}
          {tab === 'changes' && <Changes key={focusRec ?? process} analysis={analysis} process={process} focus={focusRec} role={role} initialBatch={INITIAL_LINK.get('batch')} onRecUpdated={updateRec} />}
          {tab === 'future' && <FutureState analysis={analysis} process={process} mode={mode} onModeChange={setMode} />}
          {tab === 'log' && <ReviewLog analysis={analysis} history={history} onOpenChange={openChange} />}
          {askUsed && (
            <div hidden={!askOpen}>
              <AskAI sopId={sop.ID!} sopName={IS_DEMO ? sop.Title ?? '' : sopName(sop)} process={process} tab={tab}
                tabLabel={TABS.find(([t]) => t === tab)?.[1] ?? ''} onClose={() => setAskOpen(false)} />
            </div>
          )}
          {!askOpen && <button className="btn primary ask-toggle" onClick={() => { setAskOpen(true); setAskUsed(true); }}>Ask AI</button>}
        </>
      )}
    </div>
  );
}

function SendToOwner({ initial, user, unsent, onSend, onCancel }: { initial: string; user: string; unsent: RecommendationsRead[]; onSend: (email: string) => Promise<void>; onCancel: () => void }) {
  const recommended = unsent.filter((r) => choice(r.AnalystRec) === 'Recommend').length;
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  // Email reaches anyone, but the owner must sign in to the app, so they need an account in this organization.
  const orgDomain = user.split('@')[1]?.toLowerCase() ?? '';
  const outsideOrg = valid && !!orgDomain && email.trim().toLowerCase().split('@')[1] !== orgDomain;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>Send a batch to the process owner</h3>
      <p style={{ marginTop: 0 }}>
        This batch has the <b>{unsent.length}</b> changes you reviewed since the last batch: <b>{recommended}</b> recommended and <b>{unsent.length - recommended}</b> dropped.
        Changes already sent are not sent again.
      </p>
      <p className="muted" style={{ marginTop: 0 }}>
        The owner gets one email with every change in full (current step, proposed change, how to implement, risks resolved, impact, your notes)
        and a link to decide each change in the app. You can keep reviewing and send another batch at any time.
      </p>
      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
          <label htmlFor="owner">Process owner's work email</label>
          <input id="owner" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@organization.gov" />
        </div>
        <button className="btn primary" disabled={!valid || busy} onClick={async () => { setBusy(true); await onSend(email.trim()); setBusy(false); }}>
          {busy ? 'Sending…' : `Send batch of ${unsent.length}`}
        </button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
      {outsideOrg && <div className="banner error" style={{ marginTop: 10 }}>This address is outside your organization (@{orgDomain}). The owner needs a work account here to open the app and decide.</div>}
    </div>
  );
}

function IndustryField({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button className="link" title="Edit industry" onClick={() => { setDraft(value); setEditing(true); }}>
        {value || 'Add industry'} ✎
      </button>
    );
  }
  return (
    <span className="row" style={{ gap: 6 }}>
      <input aria-label="Industry" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
        style={{ border: '1px solid var(--border-strong)', borderRadius: 6, padding: '2px 6px' }} />
      <button className="btn" onClick={async () => { await onSave(draft.trim()); setEditing(false); }}>Save</button>
      <button className="link" onClick={() => setEditing(false)}>Cancel</button>
    </span>
  );
}
