/**
 * Plans saved in your account on the server (ASP.NET Core API). Same interface
 * as the on-device storage, plus sharing.
 */
import type { Id, Project } from '../model/schema';
import { apiUrl, authHeaders, renewToken } from '../auth/session';
import { ConflictError, type ProjectSummary, type Role, type StorageAdapter, type VersionSummary } from './types';

export interface Share {
  email: string;
  role: Exclude<Role, 'owner'>;
}

interface HomeDto extends ProjectSummary {
  role: Role;
  version: number;
  ownerName: string;
  document?: Project;
}

const MAX_UPLOAD = 20 * 1024 * 1024;
/** Photos bigger than this are shrunk on the phone first, to save mobile data. */
const SHRINK_ABOVE = 4 * 1024 * 1024;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(apiUrl(path), { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) } });
  let res = await send();
  // The access token ran out: get a new one without leaving the page, then try once more.
  if (res.status === 401 && (await renewToken())) res = await send();
  if (res.status === 401) throw new Error('You are logged out. Log in again to save.');
  return res;
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await call(path, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  return (await res.json()) as T;
}

const body = (x: unknown): RequestInit => ({ body: JSON.stringify(x), headers: { 'Content-Type': 'application/json' } });

/** Large photos: scale down to 4000 px and re-encode as JPEG. */
export async function shrinkImage(blob: Blob): Promise<Blob> {
  if (!blob.type.startsWith('image/') || blob.type === 'image/gif' || blob.size <= SHRINK_ABOVE) return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 4000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob; // putFile refuses it if it is still over 20 MiB
  }
}

export class RestAdapter implements StorageAdapter {
  readonly label = 'your account';
  readonly filesAllowed = true;
  private versions = new Map<Id, number>();
  private roles = new Map<Id, Role>();
  private names = new Map<Id, string>();
  private blobs = new Map<Id, Blob>();
  /** The plan open now: new files are stored under it. */
  private current: Id | null = null;

  roleOf(id: Id): Role | undefined {
    return this.roles.get(id);
  }

  async list(): Promise<ProjectSummary[]> {
    const homes = await json<HomeDto[]>('homes');
    for (const h of homes) this.roles.set(h.id, h.role);
    return homes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: Id): Promise<Project | undefined> {
    const res = await call(`homes/${encodeURIComponent(id)}`);
    if (res.status === 404 || res.status === 403) return undefined;
    if (!res.ok) throw new Error(`Could not load the plan: ${res.status}`);
    const h = (await res.json()) as HomeDto;
    this.versions.set(id, h.version);
    this.roles.set(id, h.role);
    this.names.set(id, h.ownerName);
    this.current = id;
    return h.document;
  }

  /** Creates the plan if the server doesn't know it yet, else saves a new version. */
  async put(project: Project): Promise<void> {
    const v = this.versions.get(project.id);
    if (v === undefined) {
      await this.create(project);
      return;
    }
    const res = await call(`homes/${encodeURIComponent(project.id)}`, {
      method: 'PUT',
      ...body({ name: project.name, document: project, version: v }),
    });
    if (res.status === 409) throw new ConflictError();
    if (res.status === 403) throw new Error('You can only view this plan.');
    if (!res.ok) throw new Error(`Could not save: ${res.status}`);
    const r = (await res.json()) as { version: number };
    this.versions.set(project.id, r.version);
  }

  /** New plan in the account. Throws if the id is taken (e.g. uploaded before). */
  async create(project: Project): Promise<void> {
    const res = await call('homes', { method: 'POST', ...body({ id: project.id, name: project.name, document: project }) });
    if (res.status === 409) throw new ConflictError();
    if (!res.ok) throw new Error(`Could not create the plan: ${res.status}`);
    const h = (await res.json()) as HomeDto;
    this.versions.set(project.id, h.version ?? 1);
    this.roles.set(project.id, 'owner');
    this.current = project.id;
  }

  async delete(id: Id): Promise<void> {
    const res = await call(`homes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Could not delete: ${res.status}`);
    this.versions.delete(id);
  }

  async putFile(id: Id, blob: Blob, roomId?: Id, homeId?: Id): Promise<void> {
    const home = homeId ?? this.current;
    if (!home) throw new Error('Open a plan first.');
    const file = await shrinkImage(blob);
    if (file.size > MAX_UPLOAD) {
      throw new Error(file.type.startsWith('image/') ? 'This picture could not be made smaller than 20 MB.' : 'Files can be at most 20 MB.');
    }
    const form = new FormData();
    form.append('id', id);
    form.append('file', file, (blob as File).name || `${id}.${file.type.split('/')[1] ?? 'bin'}`);
    const res = await call(
      `homes/${encodeURIComponent(home)}/rooms/${encodeURIComponent(roomId ?? 'home')}/files`,
      { method: 'POST', body: form },
    );
    if (res.status === 413) throw new Error('The file is too large (max 20 MB).');
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    this.blobs.set(id, file);
  }

  async getFile(id: Id): Promise<Blob | undefined> {
    const cached = this.blobs.get(id);
    if (cached) return cached;
    // Not from the browser cache: it doesn't know who's logged in (shared devices).
    const res = await call(`files/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const b = await res.blob();
    this.blobs.set(id, b);
    return b;
  }

  async deleteFiles(ids: Id[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        this.blobs.delete(id);
        await call(`files/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
      }),
    );
  }

  // ---- versions ----

  private versionsPath = (homeId: Id, versionId?: Id) =>
    `homes/${encodeURIComponent(homeId)}/versions${versionId ? `/${encodeURIComponent(versionId)}` : ''}`;

  listVersions(homeId: Id): Promise<VersionSummary[]> {
    return json<VersionSummary[]>(this.versionsPath(homeId));
  }

  async putVersion(homeId: Id, name: string, project: Project, auto = false): Promise<VersionSummary> {
    const res = await call(this.versionsPath(homeId), { method: 'POST', ...body({ name, auto, document: project }) });
    if (res.status === 403) throw new Error('You can only view this plan.');
    if (!res.ok) throw new Error(`Could not save the version: ${res.status}`);
    return (await res.json()) as VersionSummary;
  }

  async getVersion(homeId: Id, versionId: Id): Promise<Project | undefined> {
    const res = await call(this.versionsPath(homeId, versionId));
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Could not open the version: ${res.status}`);
    return ((await res.json()) as { document: Project }).document;
  }

  async deleteVersion(homeId: Id, versionId: Id): Promise<void> {
    const res = await call(this.versionsPath(homeId, versionId), { method: 'DELETE' });
    if (res.status === 403) throw new Error('You can only view this plan.');
    if (!res.ok && res.status !== 404) throw new Error(`Could not delete the version: ${res.status}`);
  }

  // ---- sharing ----

  shares(homeId: Id): Promise<Share[]> {
    return json<Share[]>(`homes/${encodeURIComponent(homeId)}/shares`);
  }

  async share(homeId: Id, email: string, role: Share['role']): Promise<void> {
    const res = await call(`homes/${encodeURIComponent(homeId)}/shares`, { method: 'POST', ...body({ email, role }) });
    if (!res.ok) throw new Error(`Could not share: ${res.status} ${await res.text().catch(() => '')}`);
  }

  async unshare(homeId: Id, email: string): Promise<void> {
    const res = await call(`homes/${encodeURIComponent(homeId)}/shares/${encodeURIComponent(email)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Could not remove: ${res.status}`);
  }
}
