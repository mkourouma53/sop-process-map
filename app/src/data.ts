import type { SOPsRead } from './generated/models/SOPsModel';
import type { ProcessStepsRead, ProcessStepsWrite } from './generated/models/ProcessStepsModel';
import type { DecisionPointsRead } from './generated/models/DecisionPointsModel';
import type { RisksRead } from './generated/models/RisksModel';
import type { RecommendationsRead } from './generated/models/RecommendationsModel';
import type { FutureStepsRead } from './generated/models/FutureStepsModel';
import type { AIRunsRead } from './generated/models/AIRunsModel';
import type { Backend } from './backend/types';

/** Public demo build (GitHub Pages): bundled results, no sign-in, no AI calls. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

let backendPromise: Promise<Backend> | null = null;
const backend = () => (backendPromise ??= IS_DEMO
  ? import('./backend/demo').then((m) => m.demoBackend)
  : import('./backend/sharepoint').then((m) => m.sharepointBackend));

// SharePoint returns choice columns as { Value } on read and takes plain strings on write.
export const choice = (c?: { Value: string }) => c?.Value ?? '';

export interface Branch { label: string; next_step: string }

export interface ProcessGroup {
  name: string;
  stepIds: string[];
  trigger?: string;
  outcome?: string;
}

/** Fields prompt v3+ adds to risks and recommendations; read from the stored analysis, absent for older runs. */
export interface RichRisk {
  process?: string;
  what_could_go_wrong?: string;
  cause?: string;
  impact?: string;
  quantified_impact?: { metric: string; value: string; basis: string }[];
  severity_reason?: string;
  addressed_by?: string[];
}
export interface RichRec {
  process?: string;
  proposed_change?: string;
  implementation_steps?: string[];
  resolves_risks?: string[];
  impact?: {
    handoffs_removed?: number; steps_removed?: number; wait_days_removed?: number; manual_entries_removed?: number;
    minutes_saved_per_occurrence?: number; occurrence?: string; basis?: string;
  };
}

export interface SopAnalysis {
  processes: ProcessGroup[];
  model: string;
  richRisks: Map<string, RichRisk>;
  richRecs: Map<string, RichRec>;
  steps: ProcessStepsRead[];
  decisions: (DecisionPointsRead & { branches: Branch[] })[];
  risks: RisksRead[];
  recommendations: RecommendationsRead[];
  future: FutureStepsRead[];
  runs: AIRunsRead[];
}

const stepNum = (ref?: string) => Number((ref ?? '').replace(/\D/g, '')) || 0;

export async function loadSops(): Promise<SOPsRead[]> {
  const sops = await (await backend()).list<SOPsRead>('sops');
  return sops.sort((a, b) => (a['{Name}'] ?? a.Title ?? '').localeCompare(b['{Name}'] ?? b.Title ?? ''));
}

export async function loadAnalysis(sopId: number): Promise<SopAnalysis> {
  const b = await backend();
  const [steps, decisions, risks, recs, future, runs] = await Promise.all([
    b.list<ProcessStepsRead>('steps', sopId),
    b.list<DecisionPointsRead>('decisions', sopId),
    b.list<RisksRead>('risks', sopId),
    b.list<RecommendationsRead>('recommendations', sopId),
    b.list<FutureStepsRead>('future', sopId),
    b.list<AIRunsRead>('runs', sopId),
  ]);
  let recommendations = recs;
  const sortedSteps = steps.sort((a, b) => (a.StepOrder ?? 0) - (b.StepOrder ?? 0));
  const latest = runs.sort((a, b) => (a.ID ?? 0) - (b.ID ?? 0))[runs.length - 1];
  const raw = parseRaw(latest?.RawOutput);
  // A "keep human" item that resolves no risk only restates the step: it is not a change, so it is not shown.
  const richById = new Map((raw.recommendations ?? []).map((r) => [r.id, r]));
  const isRealChange = (r: RecommendationsRead) =>
    choice(r.Label) !== 'keep_human' || (richById.get(r.Title)?.resolves_risks?.length ?? 0) > 0;
  recommendations = recommendations.filter(isRealChange);
  return {
    processes: groupProcesses(sortedSteps, raw),
    model: latest?.Model ?? '',
    richRisks: new Map((raw.risks ?? []).map((r) => [r.id, r])),
    richRecs: new Map((raw.recommendations ?? []).map((r) => [r.id, r])),
    steps: sortedSteps,
    decisions: decisions
      .map((d) => ({ ...d, branches: parseBranches(d.Branches) }))
      .sort((a, b) => stepNum(a.AfterStep) - stepNum(b.AfterStep)),
    risks,
    recommendations: recommendations.sort((a, b) => (b.Priority ?? 0) - (a.Priority ?? 0)),
    future: future.sort((a, b) => (a.StepOrder ?? 0) - (b.StepOrder ?? 0)),
    runs,
  };
}


function parseBranches(raw?: string): Branch[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Analyst correction of a step. Marks the row as corrected so evals can count edits. */
export async function saveStep(id: number, fields: Pick<ProcessStepsWrite, 'Actor' | 'Action' | 'SystemUsed'>) {
  await (await backend()).update('steps', id, { ...fields, Corrected: true });
}

export type Role = 'analyst' | 'owner';

export async function getUserContext() {
  return (await backend()).context();
}

export interface HistoryEntry { ID?: number; Title?: string; Person?: string; Comments?: string; Created?: string; BatchNo?: number }

export async function loadHistory(sopId: number): Promise<HistoryEntry[]> {
  const rows = await (await backend()).list<HistoryEntry>('history', sopId);
  return rows.sort((a, b) => (a.ID ?? 0) - (b.ID ?? 0));
}

/** Analyst advice on a change: recommend it to the owner or drop it (with a note). */
export async function adviseRecommendation(id: number, advice: 'Recommend' | 'Drop' | 'Pending', note = '') {
  await (await backend()).update('recommendations', id, { AnalystRec: advice, AnalystNote: note });
}

/** The owner's decision on a change. This is the decision the future state follows. */
export async function decideRecommendation(id: number, status: 'Approved' | 'Rejected' | 'Proposed', note = '') {
  await (await backend()).update('recommendations', id, {
    RecStatus: status, RejectionReason: status === 'Rejected' ? note : '', OwnerNote: status === 'Approved' ? note : '',
  });
}

/**
 * Send the analyst's new advice to the process owner as one batch: every recommend/drop decision made since the
 * last batch gets the next batch number, then the Send Batch to Owner flow emails it.
 */
export async function sendBatch(sopId: number, ownerEmail: string, recs: RecommendationsRead[]) {
  const b = await backend();
  const batch = Math.max(0, ...recs.map((r) => r.BatchNo ?? 0)) + 1;
  const unsent = recs.filter((r) => !r.BatchNo && ['Recommend', 'Drop'].includes(choice(r.AnalystRec)));
  await Promise.all(unsent.map((r) => b.update('recommendations', r.ID!, { BatchNo: batch })));
  await b.update('sops', sopId, { ProcessOwner: ownerEmail, CurrentBatch: batch, SOPStatus: 'With owner' });
  let emailError = '';
  if (!IS_DEMO) {
    // The flow builds and sends the batch email and answers right away (no polling, no race with decisions).
    const { SendBatchtoOwnerService } = await import('./generated/services/SendBatchtoOwnerService');
    const result = await SendBatchtoOwnerService.Run({ text: String(sopId), text_1: String(batch) });
    if (!result.success) emailError = result.error instanceof Error ? result.error.message : 'The email flow did not respond';
    else if (result.data?.sent !== 'yes') emailError = result.data?.error || 'The email was not sent';
  }
  return { batch, ids: new Set(unsent.map((r) => r.ID)), emailError };
}

export async function logReview(sopId: number, title: string, person: string, comments = '', batch?: number) {
  await (await backend()).create('history', { Title: title, SOPId: sopId, Person: person, Comments: comments, ...(batch ? { BatchNo: batch } : {}) });
}

/** The SOP's industry (stored in the library's Department column, displayed as Industry). */
export async function setIndustry(id: number, industry: string) {
  await (await backend()).update('sops', id, { Department: industry });
}

export async function setSopStatus(id: number, status: string) {
  await (await backend()).update('sops', id, { SOPStatus: status });
}

/**
 * Split an SOP's steps into separate processes. Uses the AI's `process` label when the analysis has one
 * (prompt v3+); otherwise falls back to the top-level SOP section each step cites.
 */
interface RawAnalysis {
  steps?: { id: string; process?: string }[];
  sections?: { section: string; title: string }[];
  processes?: { name: string; trigger: string; outcome: string }[];
  risks?: (RichRisk & { id: string })[];
  recommendations?: (RichRec & { id: string })[];
}

function parseRaw(rawOutput?: string): RawAnalysis {
  try { return JSON.parse(rawOutput ?? '{}'); } catch { return {}; }
}

function groupProcesses(steps: ProcessStepsRead[], raw: RawAnalysis): ProcessGroup[] {
  const aiProcess = new Map((raw.steps ?? []).filter((s) => s.process).map((s) => [s.id, s.process!]));
  const sectionTitle = new Map((raw.sections ?? []).map((s) => [s.section.trim(), s.title]));

  const keyFor = (step: ProcessStepsRead) => {
    const labeled = aiProcess.get(step.Title);
    if (labeled) return labeled;
    const source = (step.SourceSection ?? '').trim();
    const top = source.match(/^\D{0,2}(\d+)/)?.[1];
    if (top) return `${top}. ${sectionTitle.get(top) ?? 'Section ' + top}`;
    return source.split(',')[0] || 'Other';
  };

  const groups: ProcessGroup[] = [];
  for (const step of steps) {
    const name = keyFor(step);
    let g = groups.find((x) => x.name === name);
    if (!g) {
      const info = raw.processes?.find((p) => p.name === name);
      groups.push((g = { name, stepIds: [], trigger: info?.trigger, outcome: info?.outcome }));
    }
    g.stepIds.push(step.Title);
  }
  // Section-based fallback: list processes in document order (AI-labeled processes keep flow order).
  if (!aiProcess.size) groups.sort((a, b) => (parseInt(a.name) || 999) - (parseInt(b.name) || 999));
  return groups;
}

const MODEL_NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-fable-5-1': 'Claude Fable 5.1',
};
export const modelName = (id: string) => MODEL_NAMES[id] ?? id;

/* ---------- Ask AI ---------- */

export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface Citation { citedText: string; page?: number; endPage?: number }
export interface ChatAnswer { parts: { text: string; citations: Citation[] }[]; error?: string }

interface ClaudeBlock {
  type: string;
  text?: string;
  citations?: { cited_text: string; start_page_number?: number; end_page_number?: number }[];
}

/** Ask a question about one SOP. Runs the Ask SOP flow, which holds the API key server-side. */
export async function askSop(sopId: number, messages: ChatTurn[], context: string): Promise<ChatAnswer> {
  if (IS_DEMO) throw new Error('Ask AI runs in the production app, where the API key stays on the server.');
  const { AskSOPService } = await import('./generated/services/AskSOPService');
  const result = await AskSOPService.Run({ text: String(sopId), text_1: JSON.stringify(messages), text_2: context });
  if (!result.success) throw result.error ?? new Error('The Ask SOP flow did not respond');
  if (result.data?.error) throw new Error(result.data.error);
  let blocks: ClaudeBlock[] = [];
  try { blocks = JSON.parse(result.data?.answer ?? '[]'); } catch { /* handled below */ }
  const parts = blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => ({
      text: b.text!,
      citations: (b.citations ?? []).map((c) => ({ citedText: c.cited_text, page: c.start_page_number, endPage: c.end_page_number })),
    }));
  if (!parts.length) throw new Error('The answer came back empty. Try asking again.');
  return { parts };
}
