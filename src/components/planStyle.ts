/** What the room editor highlights in the drawing. */
export interface Highlight {
  wall?: number | null;
  corner?: number | null;
  opening?: string | null;
  diagonal?: number | null;
  furniture?: string | null;
  pin?: string | null;
  stair?: string | null;
  fixed?: string | null;
}

/**
 * Colours of the drawing itself. These are plain values, not CSS variables,
 * because the same SVG is exported to files and PDF. The plan is always drawn
 * on white "paper", also in dark mode.
 */
export const PLAN = {
  paper: '#ffffff',
  floor: '#f6f5f1',
  selected: '#dbeafe',
  wall: '#3a3a3a',
  dim: '#5f6368',
  label: '#202124',
  arc: '#80868b',
  warn: '#d93025',
  accent: '#2563eb',
  grid: '#e8eaed',
  angle: '#b45309',
  diagonal: '#7c3aed',
  furniture: '#ffffff',
  furnitureLine: '#9aa0a6',
  pin: '#e8710a',
  ok: '#188038',
  ramp: '#eef3e8',
  /** Glass in sliding doors. */
  glass: '#cfe6f7',
  /** Wall types, after the usual Belgian renovation colours. */
  wallNew: '#e2463a',
  wallDemolish: '#f6d32d',
  font: 'Helvetica, Arial, sans-serif',
  wallLabelSize: 120,
  roomNameSize: 170,
  roomAreaSize: 130,
};
