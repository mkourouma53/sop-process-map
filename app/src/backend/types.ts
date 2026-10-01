export type ListName = 'sops' | 'steps' | 'decisions' | 'risks' | 'recommendations' | 'future' | 'runs' | 'history';

/** The two operations the app needs, implemented by SharePoint (live) and a bundled file (public demo). */
export interface Backend {
  list<T>(name: ListName, sopId?: number): Promise<T[]>;
  update(name: ListName, id: number, fields: Record<string, unknown>): Promise<void>;
  create(name: ListName, fields: Record<string, unknown>): Promise<void>;
  /** Signed-in user and launch parameters (deep links from approval emails). */
  context(): Promise<{ userEmail: string; userName: string; params: Record<string, string> }>;
}
