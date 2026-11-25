import type { Id, Project } from '../model/schema';

export type Role = 'owner' | 'editor' | 'viewer';

export interface ProjectSummary {
  id: Id;
  name: string;
  updatedAt: string;
  /** Server homes: your role and who owns it. */
  role?: Role;
  ownerName?: string;
}

/** A named snapshot of a plan, stored next to it (not inside it). */
export interface VersionSummary {
  id: Id;
  name: string;
  createdAt: string;
  /** Made by the app (e.g. before a restore); only the newest few are kept. */
  auto?: boolean;
  /** Who saved it (server plans). */
  createdBy?: string;
}

/** Automatic versions kept per plan; named ones are never removed automatically. */
export const KEEP_AUTO_VERSIONS = 10;

/** Saving failed because someone else saved a newer version. */
export class ConflictError extends Error {
  constructor() {
    super('This plan was changed somewhere else. Reload it to see the newest version.');
  }
}

/**
 * Where projects and their files (photos, documents) are saved: IndexedDB on
 * this device (anonymous), or the server (logged in, RestAdapter).
 */
export interface StorageAdapter {
  /** Where it saves, for the save indicator: 'this device' or 'your account'. */
  readonly label: string;
  /** Photos and documents can be added (only for logged-in users). */
  readonly filesAllowed: boolean;
  /** Your role on a plan you've opened; undefined means full control. */
  roleOf?(id: Id): Role | undefined;

  list(): Promise<ProjectSummary[]>;
  get(id: Id): Promise<Project | undefined>;
  put(project: Project): Promise<void>;
  delete(id: Id): Promise<void>;

  /** `roomId`: the room the file belongs to (the server stores files per home and room). */
  putFile(id: Id, blob: Blob, roomId?: Id): Promise<void>;
  getFile(id: Id): Promise<Blob | undefined>;
  deleteFiles(ids: Id[]): Promise<void>;

  /** Newest first. */
  listVersions(projectId: Id): Promise<VersionSummary[]>;
  putVersion(projectId: Id, name: string, project: Project, auto?: boolean): Promise<VersionSummary>;
  getVersion(projectId: Id, versionId: Id): Promise<Project | undefined>;
  deleteVersion(projectId: Id, versionId: Id): Promise<void>;
}
