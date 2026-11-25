/**
 * Changes to a plan in your account are first kept on this device, until the server has them.
 * If saving fails (logged out while idle, offline, server down), the draft stays, and the next
 * time the plan is opened you choose which one to keep.
 */
import type { Id, Project } from '../model/schema';

export interface Draft {
  /** `<user>/<plan id>`: several accounts on one device each see only their own drafts. */
  key: string;
  user: string;
  projectId: Id;
  name: string;
  project: Project;
  /** When it was last changed on this device. */
  savedAt: string;
}

const DB = 'floorplan-drafts';
const STORE = 'drafts';
let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('user', 'user');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      db = null;
      reject(req.error);
    };
  });
  return db;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const s = (await open()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const keyOf = (user: string, projectId: Id) => `${user}/${projectId}`;

export async function putDraft(user: string, project: Project): Promise<void> {
  const d: Draft = {
    key: keyOf(user, project.id),
    user,
    projectId: project.id,
    name: project.name,
    project: JSON.parse(JSON.stringify(project)) as Project,
    savedAt: new Date().toISOString(),
  };
  await run('readwrite', (s) => s.put(d));
}

export const getDraft = (user: string, projectId: Id) =>
  run<Draft | undefined>('readonly', (s) => s.get(keyOf(user, projectId)));

export const deleteDraft = (user: string, projectId: Id) => run('readwrite', (s) => s.delete(keyOf(user, projectId))).then(() => undefined);

export const listDrafts = (user: string) => run<Draft[]>('readonly', (s) => s.index('user').getAll(user));

/** Drafts of every account on this device (to remind you to log in). */
export const countDrafts = () => run<number>('readonly', (s) => s.count());

/** The same plan, apart from when it was saved. */
export function samePlan(a: Project, b: Project): boolean {
  return canonical({ ...a, updatedAt: '' }) === canonical({ ...b, updatedAt: '' });
}

/** JSON with sorted keys, so the order fields were added in does not matter. */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.keys(x)
      .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(x) ?? 'null';
}
