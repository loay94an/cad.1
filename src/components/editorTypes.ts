import type { Wall } from '../model/schema';
export type EditorMode = 'layout' | 'notes' | 'furniture' | 'installations';

/** What's selected in the room editor (drawing and form stay in sync through this). */
export type Selection =
  | { kind: 'wall'; index: number }
  | { kind: 'corner'; index: number }
  | { kind: 'diagonal'; index: number }
  | { kind: 'opening'; id: string }
  | { kind: 'furniture'; id: string }
  | { kind: 'pin'; id: string }
  | { kind: 'stair'; id: string }
  | { kind: 'fixed'; id: string };

/** The type of a wall: kind, load-bearing and renovation status. */
export type WallType = Pick<Wall, 'kind' | 'loadBearing' | 'status'>;

/** A wall type set on another room's wall (the other side of a shared wall). */
export interface WallTypePatch extends WallType {
  roomId: string;
  wallIndex: number;
}
