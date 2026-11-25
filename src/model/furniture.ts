import { type Furniture, type FurnitureShape, uid } from './schema';
import type { Vec } from '../geometry/vec';

export interface FurniturePreset {
  kind: string;
  name: string;
  width_mm: number;
  depth_mm: number;
  shape: FurnitureShape;
  height_mm: number;
  /** Hangs on the wall: its bottom above the floor. */
  elevation_mm?: number;
}

/** Common sizes; change them per item after adding. */
export const FURNITURE_PRESETS: FurniturePreset[] = [
  { kind: 'bed-double', name: 'Double bed', width_mm: 1600, depth_mm: 2000, shape: 'rect', height_mm: 500 },
  { kind: 'bed-single', name: 'Single bed', width_mm: 900, depth_mm: 2000, shape: 'rect', height_mm: 500 },
  { kind: 'sofa', name: 'Sofa', width_mm: 2000, depth_mm: 900, shape: 'rect', height_mm: 800 },
  { kind: 'armchair', name: 'Armchair', width_mm: 850, depth_mm: 850, shape: 'rect', height_mm: 800 },
  { kind: 'table', name: 'Dining table', width_mm: 1600, depth_mm: 900, shape: 'rect', height_mm: 750 },
  { kind: 'table-round', name: 'Round table', width_mm: 1000, depth_mm: 1000, shape: 'round', height_mm: 750 },
  { kind: 'chair', name: 'Chair', width_mm: 450, depth_mm: 500, shape: 'rect', height_mm: 850 },
  { kind: 'desk', name: 'Desk', width_mm: 1400, depth_mm: 700, shape: 'rect', height_mm: 750 },
  { kind: 'wardrobe', name: 'Wardrobe', width_mm: 1500, depth_mm: 600, shape: 'rect', height_mm: 2000 },
  { kind: 'cabinet', name: 'Cabinet', width_mm: 800, depth_mm: 400, shape: 'rect', height_mm: 900 },
  { kind: 'counter', name: 'Kitchen counter', width_mm: 2400, depth_mm: 600, shape: 'rect', height_mm: 900 },
  { kind: 'fridge', name: 'Fridge', width_mm: 600, depth_mm: 650, shape: 'rect', height_mm: 1800 },
  { kind: 'washer', name: 'Washing machine', width_mm: 600, depth_mm: 600, shape: 'rect', height_mm: 850 },
  { kind: 'bathtub', name: 'Bathtub', width_mm: 1700, depth_mm: 750, shape: 'rect', height_mm: 550 },
  { kind: 'shower', name: 'Shower', width_mm: 900, depth_mm: 900, shape: 'rect', height_mm: 2000 },
  { kind: 'toilet', name: 'Toilet', width_mm: 400, depth_mm: 650, shape: 'rect', height_mm: 420 },
  { kind: 'sink', name: 'Sink', width_mm: 600, depth_mm: 450, shape: 'rect', height_mm: 850 },
  { kind: 'wall-cabinet', name: 'Wall cupboard', width_mm: 800, depth_mm: 350, shape: 'rect', height_mm: 700, elevation_mm: 1400 },
  { kind: 'shelf', name: 'Shelf', width_mm: 800, depth_mm: 250, shape: 'rect', height_mm: 30, elevation_mm: 1500 },
  { kind: 'custom', name: 'Item', width_mm: 1000, depth_mm: 600, shape: 'rect', height_mm: 700 },
];

export function newFurniture(preset: FurniturePreset, at: Vec): Furniture {
  return {
    id: uid(),
    name: preset.name,
    kind: preset.kind,
    shape: preset.shape,
    x_mm: Math.round(at.x),
    y_mm: Math.round(at.y),
    width_mm: preset.width_mm,
    depth_mm: preset.depth_mm,
    rotation_deg: 0,
    height_mm: preset.height_mm,
    ...(preset.elevation_mm ? { elevation_mm: preset.elevation_mm } : {}),
  };
}

/** How tall a piece is: its own height, or the usual height for its kind (older plans have none). */
export function furnitureHeight(f: Pick<Furniture, 'kind' | 'height_mm'>): number {
  return f.height_mm ?? FURNITURE_PRESETS.find((p) => p.kind === f.kind)?.height_mm ?? 700;
}
