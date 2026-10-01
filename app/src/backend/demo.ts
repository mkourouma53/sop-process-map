import type { Backend, ListName } from './types';

type Row = Record<string, unknown> & { ID: number; SOPId?: number };
type Store = Record<ListName, Row[]>;

const EDITS_KEY = 'sop-demo-edits-v1';
// Choice columns come back from SharePoint as { Value }; keep the demo's shape identical.
const CHOICE_FIELDS = new Set(['SOPStatus', 'RecStatus', 'AnalystRec', 'Label', 'RiskType', 'Severity', 'ChangeType']);

let store: Promise<Store> | null = null;

function readEdits(): Record<string, Record<string, unknown>> {
  try { return JSON.parse(localStorage.getItem(EDITS_KEY) ?? '{}'); } catch { return {}; }
}

function load(): Promise<Store> {
  store ??= import('../demo/demo-data.json').then((m) => {
    const data = structuredClone(m.default) as unknown as Store;
    for (const [key, fields] of Object.entries(readEdits())) {
      const [name, id] = key.split(':');
      const row = data[name as ListName]?.find((r) => r.ID === Number(id));
      if (row) Object.assign(row, fields);
    }
    return data;
  });
  return store;
}

/** Public demo: the same screens over bundled results. Edits stay in this browser only. */
export const demoBackend: Backend = {
  async list<T>(name: ListName, sopId?: number) {
    const rows = (await load())[name] ?? ((await load())[name] = []);
    return (sopId === undefined ? rows : rows.filter((r) => r.SOPId === sopId)).map((r) => ({ ...r })) as T[];
  },
  async update(name, id, fields) {
    const row = (await load())[name].find((r) => r.ID === id);
    if (!row) throw new Error('Item not found');
    const shaped = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, CHOICE_FIELDS.has(k) ? { Value: v } : v]));
    Object.assign(row, shaped);
    const edits = readEdits();
    edits[`${name}:${id}`] = { ...edits[`${name}:${id}`], ...shaped };
    try { localStorage.setItem(EDITS_KEY, JSON.stringify(edits)); } catch { /* private mode: keep in memory only */ }
  },
  async create(name, fields) {
    const rows = (await load())[name] ?? ((await load())[name] = []);
    const id = Math.max(0, ...rows.map((r) => r.ID)) + 1;
    rows.push({ ID: id, Created: new Date().toISOString(), ...fields } as Row);
  },
  async context() {
    return { userEmail: 'visitor@demo', userName: 'Demo visitor', params: {} };
  },
};
