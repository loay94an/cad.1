import type { EditorMode } from './editorTypes';

/** What you're working on. Chosen on the main screen; the room editor opens in the same mode. */
export type AppMode = 'view' | 'layout' | 'furniture' | 'electrical' | 'utilities';

export interface ModeInfo {
  id: AppMode;
  label: string;
  icon: string;
  /** Accent on the (always white) plan. The UI uses the matching CSS token `--mode-<id>`. */
  plan: string;
  editor: EditorMode;
  soon?: boolean;
}

export const MODES: ModeInfo[] = [
  { id: 'view', label: 'View & notes', icon: '👁', plan: '#2563eb', editor: 'notes' },
  { id: 'layout', label: 'Layout', icon: '📐', plan: '#0f766e', editor: 'layout' },
  { id: 'furniture', label: 'Furniture', icon: '🛋', plan: '#7c3aed', editor: 'furniture' },
  { id: 'electrical', label: 'Electrical', icon: '⚡', plan: '#c2410c', editor: 'installations' },
  { id: 'utilities', label: 'Utilities', icon: '💧', plan: '#0369a1', editor: 'installations' },
];

export const modeInfo = (m: AppMode): ModeInfo => MODES.find((x) => x.id === m) ?? MODES[0];
