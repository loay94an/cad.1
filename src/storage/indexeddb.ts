import { type Id, type Project, uid } from '../model/schema';
import { KEEP_AUTO_VERSIONS, type ProjectSummary, type StorageAdapter, type VersionSummary } from './types';

const DB_NAME = 'floorplan';
const PROJECTS = 'projects';
const FILES = 'files';
const VERSIONS = 'versions';

interface VersionRecord extends VersionSummary {
  projectId: Id;
  document: Project;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly label = 'this device';
  /** Photos need an account: they're kept on the server. Old ones stay readable. */
  readonly filesAllowed = false;
  private db?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
        if (!db.objectStoreNames.contains(VERSIONS)) {
          db.createObjectStore(VERSIONS, { keyPath: 'id' }).createIndex('projectId', 'projectId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(name, mode).objectStore(name);
  }

  async list(): Promise<ProjectSummary[]> {
    const all = (await promisify((await this.store(PROJECTS, 'readonly')).getAll())) as Project[];
    return all
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: Id): Promise<Project | undefined> {
    return (await promisify((await this.store(PROJECTS, 'readonly')).get(id))) as Project | undefined;
  }

  async put(project: Project): Promise<void> {
    // Plain clone: Vue reactive proxies can't be stored in IndexedDB.
    await promisify((await this.store(PROJECTS, 'readwrite')).put(JSON.parse(JSON.stringify(project))));
  }

  async delete(id: Id): Promise<void> {
    await promisify((await this.store(PROJECTS, 'readwrite')).delete(id));
    const versions = await this.versionRecords(id);
    const store = await this.store(VERSIONS, 'readwrite');
    await Promise.all(versions.map((v) => promisify(store.delete(v.id))));
  }

  async putFile(id: Id, blob: Blob): Promise<void> {
    await promisify((await this.store(FILES, 'readwrite')).put(blob, id));
  }

  async getFile(id: Id): Promise<Blob | undefined> {
    return (await promisify((await this.store(FILES, 'readonly')).get(id))) as Blob | undefined;
  }

  async deleteFiles(ids: Id[]): Promise<void> {
    if (!ids.length) return;
    const store = await this.store(FILES, 'readwrite');
    await Promise.all(ids.map((id) => promisify(store.delete(id))));
  }

  // ---- versions ----

  private async versionRecords(projectId: Id): Promise<VersionRecord[]> {
    const store = await this.store(VERSIONS, 'readonly');
    return (await promisify(store.index('projectId').getAll(projectId))) as VersionRecord[];
  }

  async listVersions(projectId: Id): Promise<VersionSummary[]> {
    return (await this.versionRecords(projectId))
      .map(({ id, name, createdAt, auto }): VersionSummary => ({ id, name, createdAt, ...(auto ? { auto } : {}) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async putVersion(projectId: Id, name: string, project: Project, auto = false): Promise<VersionSummary> {
    const summary: VersionSummary = { id: uid(), name, createdAt: new Date().toISOString(), ...(auto ? { auto } : {}) };
    const record: VersionRecord = { ...summary, projectId, document: JSON.parse(JSON.stringify(project)) };
    await promisify((await this.store(VERSIONS, 'readwrite')).put(record));
    if (auto) {
      const old = (await this.listVersions(projectId)).filter((v) => v.auto).slice(KEEP_AUTO_VERSIONS);
      const store = await this.store(VERSIONS, 'readwrite');
      await Promise.all(old.map((v) => promisify(store.delete(v.id))));
    }
    return summary;
  }

  async getVersion(projectId: Id, versionId: Id): Promise<Project | undefined> {
    const r = (await promisify((await this.store(VERSIONS, 'readonly')).get(versionId))) as VersionRecord | undefined;
    return r?.projectId === projectId ? r.document : undefined;
  }

  async deleteVersion(projectId: Id, versionId: Id): Promise<void> {
    if (!(await this.getVersion(projectId, versionId))) return;
    await promisify((await this.store(VERSIONS, 'readwrite')).delete(versionId));
  }
}
