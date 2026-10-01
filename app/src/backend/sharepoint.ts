import type { IGetAllOptions } from '../generated/models/CommonModels';
import { SOPsService } from '../generated/services/SOPsService';
import { ProcessStepsService } from '../generated/services/ProcessStepsService';
import { DecisionPointsService } from '../generated/services/DecisionPointsService';
import { RisksService } from '../generated/services/RisksService';
import { RecommendationsService } from '../generated/services/RecommendationsService';
import { FutureStepsService } from '../generated/services/FutureStepsService';
import { AIRunsService } from '../generated/services/AIRunsService';
import { ReviewHistoryService } from '../generated/services/ReviewHistoryService';
import { getContext } from '@microsoft/power-apps/app';
import type { Backend, ListName } from './types';

interface Service {
  create(record: never): Promise<{ success: boolean; error?: unknown }>;
  getAll(o?: IGetAllOptions): Promise<{ success: boolean; data: unknown[]; error?: unknown }>;
  update(id: string, fields: never): Promise<{ success: boolean; error?: unknown }>;
}

// The SharePoint connector reads and writes choice columns as { Value }. A plain string is accepted
// but silently stored as empty, despite the generated Write types declaring string.
const CHOICE_FIELDS = new Set(['SOPStatus', 'RecStatus', 'AnalystRec', 'Label', 'RiskType', 'Severity', 'ChangeType']);
const toConnector = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, CHOICE_FIELDS.has(k) && typeof v === 'string' ? { Value: v } : v]));

const SERVICES: Record<ListName, Service> = {
  sops: SOPsService as unknown as Service,
  steps: ProcessStepsService as unknown as Service,
  decisions: DecisionPointsService as unknown as Service,
  risks: RisksService as unknown as Service,
  recommendations: RecommendationsService as unknown as Service,
  future: FutureStepsService as unknown as Service,
  runs: AIRunsService as unknown as Service,
  history: ReviewHistoryService as unknown as Service,
};

export const sharepointBackend: Backend = {
  async list<T>(name: ListName, sopId?: number) {
    const result = await SERVICES[name].getAll({ filter: sopId === undefined ? undefined : `SOPId eq ${sopId}`, maxPageSize: 500 });
    if (!result.success) throw result.error ?? new Error('SharePoint request failed');
    return (result.data ?? []) as T[];
  },
  async update(name, id, fields) {
    const result = await SERVICES[name].update(String(id), toConnector(fields) as never);
    if (!result.success) throw result.error ?? new Error('Could not save the change');
  },
  async create(name, fields) {
    const result = await SERVICES[name].create(toConnector(fields) as never);
    if (!result.success) throw result.error ?? new Error('Could not save');
  },
  async context() {
    const ctx = await getContext();
    return { userEmail: ctx.user.userPrincipalName ?? '', userName: ctx.user.fullName ?? '', params: ctx.app.queryParams ?? {} };
  },
};
