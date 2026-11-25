import { type Project, fileIdOf, uid } from '../model/schema';
import { ConflictError, type StorageAdapter } from './types';
import type { RestAdapter } from './rest';

/**
 * Copies a plan from this device into your account, photos and documents
 * included. If the account already has it (uploaded before), the copy gets a
 * new id. Returns the id in the account.
 */
export async function uploadToAccount(
  local: StorageAdapter,
  rest: RestAdapter,
  id: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const p = await local.get(id);
  if (!p) throw new Error('Plan not found on this device.');
  const project: Project = JSON.parse(JSON.stringify(p));
  try {
    await rest.create(project);
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    project.id = uid();
    project.name = `${project.name} (uploaded ${new Date().toLocaleDateString()})`;
    await rest.create(project);
  }
  const files = project.attachments.filter((a) => fileIdOf(a.uri));
  let done = 0;
  for (const a of files) {
    const fid = fileIdOf(a.uri)!;
    const blob = await local.getFile(fid);
    if (blob) {
      const roomId = a.linkedTo[0];
      await rest.putFile(fid, blob, roomId, project.id);
      a.size = blob.size;
    }
    onProgress?.(++done, files.length);
  }
  await rest.put(project);
  return project.id;
}
