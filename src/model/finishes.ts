/** Floor coverings a room can have, with the colours used to tint the plan and the 3D floor. */
import type { Room } from './schema';

export interface FloorCovering {
  id: string;
  label: string;
  /** Tint on the plan (light, so the drawing stays readable). */
  plan: string;
  /** Floor colour in 3D. */
  three: number;
}

export const FLOOR_COVERINGS: FloorCovering[] = [
  { id: 'tiles', label: 'Tiles', plan: '#e3ecf3', three: 0xc9d3dc },
  { id: 'laminate', label: 'Laminate', plan: '#f3e6cf', three: 0xd8b98a },
  { id: 'parquet', label: 'Parquet', plan: '#eedcc0', three: 0xb88a56 },
  { id: 'vinyl', label: 'Vinyl', plan: '#e6efe1', three: 0xb7c6ad },
  { id: 'carpet', label: 'Carpet', plan: '#efe1ea', three: 0xb59aaa },
  { id: 'concrete', label: 'Concrete', plan: '#e7e7e4', three: 0xa9a9a4 },
  { id: 'screed', label: 'Screed', plan: '#ecebe3', three: 0xbebcb0 },
  { id: 'other', label: 'Other', plan: '#f0ece2', three: 0xd0c6b2 },
];

/** Plain floor in 3D, when a room has no covering set. */
export const DEFAULT_FLOOR_3D = 0xd9cdb8;

/** A covering by id, or undefined for free text and empty values. */
export const floorCovering = (id?: string) => FLOOR_COVERINGS.find((c) => c.id === id);

/** What to show for a room's floor: the covering's label, or the free text. Empty when not set. */
export function floorLabel(room: Pick<Room, 'finish'>): string {
  const f = room.finish?.floor?.trim();
  if (!f) return '';
  return floorCovering(f)?.label ?? f;
}

/** Skirting unless the room says otherwise. */
export const hasSkirting = (room: Pick<Room, 'finish'>) => room.finish?.skirting !== false;
