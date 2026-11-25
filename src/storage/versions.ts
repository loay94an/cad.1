/**
 * Versions share the plan's photos and documents instead of copying them. So a
 * file is only really deleted when neither the plan nor any of its versions
 * still refers to it.
 */
import { type Id, type Project, fileIdOf } from '../model/schema';
import type { StorageAdapter } from './types';

export const fileIdsOf = (p: Pick<Project, 'attachments'>): Id[] =>
  p.attachments.map((a) => fileIdOf(a.uri)).filter((x): x is Id => !!x);

/** Every file id any version of the plan refers to. */
export async function fileIdsInVersions(storage: StorageAdapter, projectId: Id): Promise<Set<Id>> {
  const ids = new Set<Id>();
  const versions = await storage.listVersions(projectId);
  for (const v of versions) {
    const p = await storage.getVersion(projectId, v.id);
    for (const id of p ? fileIdsOf(p) : []) ids.add(id);
  }
  return ids;
}

/**
 * Deletes the files no version still uses. If the versions can't be read
 * (offline, server error) nothing is deleted: a stray file is better than a
 * version with missing photos.
 */
export async function deleteUnusedFiles(storage: StorageAdapter, projectId: Id, ids: Id[]): Promise<void> {
  if (!ids.length) return;
  let used: Set<Id>;
  try {
    used = await fileIdsInVersions(storage, projectId);
  } catch {
    return;
  }
  await storage.deleteFiles(ids.filter((id) => !used.has(id)));
}

/** The plan's files and those only its versions still use: everything to delete with the plan. */
export async function allFileIds(storage: StorageAdapter, project: Project): Promise<Id[]> {
  const ids = new Set(fileIdsOf(project));
  try {
    for (const id of await fileIdsInVersions(storage, project.id)) ids.add(id);
  } catch {
    // The versions go with the plan anyway; their extra files are left behind.
  }
  return [...ids];
}
