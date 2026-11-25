import {
  DEFAULT_VIEW,
  SCHEMA_VERSION,
  type NotePin,
  type Stair,
  type ViewSettings,
  type Attachment,
  type Diagonal,
  type Floor,
  type FixedElement,
  type FixedKind,
  type Furniture,
  type Layer,
  type Opening,
  type Project,
  type Room,
  type Wall,
  uid,
} from './schema';
import { normalizeElectrical } from './electrical';
import { normalizeUtilities } from './utilities';

/** Marker written into exported files so we can recognise them on import. */
export const FILE_FORMAT = 'floorplan-project';

/** Photos and documents travel inside the project file as data: URLs, keyed by file id. */
export type EmbeddedFiles = Record<string, string>;

export function serializeProject(project: Project, files?: EmbeddedFiles): string {
  const data = files && Object.keys(files).length ? { format: FILE_FORMAT, ...project, files } : { format: FILE_FORMAT, ...project };
  return JSON.stringify(data, null, 2);
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const str = (x: unknown, fallback: string) => (typeof x === 'string' ? x : fallback);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/**
 * Reads an exported project file. Throws an Error with a readable message
 * if the file isn't a floor plan or was made by a newer version.
 */
export function parseProject(text: string): Project {
  return parseProjectFile(text).project;
}

/** Like parseProject, and also returns the embedded photos/documents. */
export function parseProjectFile(text: string): { project: Project; files: EmbeddedFiles } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isObj(data)) throw new Error('This file is not a floor plan.');
  if (data.format !== undefined && data.format !== FILE_FORMAT) throw new Error('This file is not a floor plan.');
  const version = data.schemaVersion;
  if (typeof version !== 'number') throw new Error('This file has no format version, so it is not a floor plan export.');
  if (version > SCHEMA_VERSION) {
    throw new Error(`This file was made by a newer version of the app (format ${version}). Update the app first.`);
  }
  // Future: `if (version < 2) data = migrateV1toV2(data)` etc.
  const files: EmbeddedFiles = {};
  if (isObj(data.files)) {
    for (const [id, url] of Object.entries(data.files)) {
      if (typeof url === 'string' && url.startsWith('data:')) files[id] = url;
    }
  }
  return { project: normalizeProject(data), files };
}

function normalizeProject(d: Obj): Project {
  const settings = isObj(d.settings) ? d.settings : {};
  const unit = settings.unit === 'cm' || settings.unit === 'mm' ? settings.unit : 'm';
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: str(d.id, uid()),
    name: str(d.name, 'Imported plan'),
    createdAt: str(d.createdAt, now),
    updatedAt: str(d.updatedAt, now),
    settings: {
      unit,
      defaultThickness_mm: num(settings.defaultThickness_mm, 100),
      defaultHeight_mm: num(settings.defaultHeight_mm, 2600),
      ...(typeof settings.headroom_mm === 'number' && settings.headroom_mm > 0 ? { headroom_mm: settings.headroom_mm } : {}),
      view: normalizeView(settings.view),
    },
    floors: arr(d.floors).filter(isObj).map(normalizeFloor),
    layers: arr(d.layers).filter(isObj) as unknown as Layer[],
    attachments: arr(d.attachments).filter(isObj) as unknown as Attachment[],
    ...(isObj(d.electrical) ? { electrical: normalizeElectrical(d.electrical) } : {}),
    ...(isObj(d.utilities) ? { utilities: normalizeUtilities(d.utilities) } : {}),
    meta: isObj(d.meta) ? d.meta : {},
  };
}

function normalizeView(v: unknown): ViewSettings {
  const view = { ...DEFAULT_VIEW };
  if (isObj(v)) {
    for (const key of Object.keys(view) as (keyof ViewSettings)[]) {
      if (typeof v[key] === 'boolean') view[key] = v[key] as boolean;
    }
  }
  return view;
}

function normalizeFloor(f: Obj): Floor {
  return {
    id: str(f.id, uid()),
    name: str(f.name, 'Floor'),
    level: num(f.level, 0),
    rooms: arr(f.rooms).filter(isObj).map(normalizeRoom),
    openings: arr(f.openings).filter(isObj).map(normalizeOpening),
  };
}

function normalizeRoom(r: Obj): Room {
  const origin = isObj(r.origin) ? r.origin : {};
  const room: Room = {
    id: str(r.id, uid()),
    name: str(r.name, 'Room'),
    origin: { x: num(origin.x, 0), y: num(origin.y, 0) },
    rotation_deg: num(r.rotation_deg, 0),
    walls: arr(r.walls)
      .filter(isObj)
      .map(
        (w): Wall => {
          const wall: Wall = {
            id: str(w.id, uid()),
            length_mm: num(w.length_mm, 0),
            angle_deg: num(w.angle_deg, 90),
            thickness_mm: num(w.thickness_mm, 100),
          };
          if (typeof w.angle_measured === 'boolean') wall.angle_measured = w.angle_measured;
          if (typeof w.height_mm === 'number' && Number.isFinite(w.height_mm)) wall.height_mm = w.height_mm;
          if (typeof w.slope_deg === 'number' && w.slope_deg > 0 && w.slope_deg < 90) wall.slope_deg = w.slope_deg;
          if (w.kind === 'interior' || w.kind === 'exterior') wall.kind = w.kind;
          if (typeof w.loadBearing === 'boolean') wall.loadBearing = w.loadBearing;
          if (w.status === 'existing' || w.status === 'new' || w.status === 'demolish') wall.status = w.status;
          return wall;
        },
      ),
    diagonals: arr(r.diagonals)
      .filter(isObj)
      .map(
        (g): Diagonal => ({
          id: str(g.id, uid()),
          from: num(g.from, 0),
          to: num(g.to, 0),
          length_mm: num(g.length_mm, 0),
        }),
      ),
  };
  if (typeof r.height_mm === 'number') room.height_mm = r.height_mm;
  if (typeof r.notes === 'string') room.notes = r.notes;
  if (typeof r.locked === 'boolean') room.locked = r.locked;
  if (isObj(r.finish)) {
    const f = r.finish;
    room.finish = {};
    if (typeof f.floor === 'string') room.finish.floor = f.floor;
    if (typeof f.walls === 'string') room.finish.walls = f.walls;
    if (typeof f.ceiling === 'string') room.finish.ceiling = f.ceiling;
    if (typeof f.skirting === 'boolean') room.finish.skirting = f.skirting;
  }
  if (typeof r.floorLevel_mm === 'number' && Number.isFinite(r.floorLevel_mm)) room.floorLevel_mm = r.floorLevel_mm;
  if (Array.isArray(r.stairs)) {
    room.stairs = r.stairs.filter(isObj).map(
      (s): Stair => ({
        id: str(s.id, uid()),
        kind: s.kind === 'ramp' ? 'ramp' : 'stairs',
        name: str(s.name, s.kind === 'ramp' ? 'Slope' : 'Stairs'),
        x_mm: num(s.x_mm, 0),
        y_mm: num(s.y_mm, 0),
        width_mm: num(s.width_mm, 900),
        length_mm: num(s.length_mm, 3000),
        rotation_deg: num(s.rotation_deg, 0),
        rise_mm: num(s.rise_mm, 0),
        steps: Math.max(0, Math.round(num(s.steps, 0))),
        ...(s.down === true ? { down: true } : {}),
        ...(s.solid === true ? { solid: true } : {}),
      }),
    );
  }
  if (Array.isArray(r.pins)) {
    room.pins = r.pins.filter(isObj).map(
      (p): NotePin => ({
        id: str(p.id, uid()),
        x_mm: num(p.x_mm, 0),
        y_mm: num(p.y_mm, 0),
        title: str(p.title, ''),
        text: str(p.text, ''),
        createdAt: str(p.createdAt, new Date().toISOString()),
      }),
    );
  }
  if (Array.isArray(r.fixed)) {
    const kinds = ['chimney', 'column', 'duct', 'block'];
    room.fixed = r.fixed.filter(isObj).map(
      (f): FixedElement => ({
        id: str(f.id, uid()),
        kind: kinds.includes(f.kind as string) ? (f.kind as FixedKind) : 'block',
        name: str(f.name, 'Block'),
        shape: f.shape === 'round' ? 'round' : 'rect',
        x_mm: num(f.x_mm, 0),
        y_mm: num(f.y_mm, 0),
        width_mm: num(f.width_mm, 500),
        depth_mm: num(f.depth_mm, 500),
        rotation_deg: num(f.rotation_deg, 0),
        ...(typeof f.height_mm === 'number' && f.height_mm > 0 ? { height_mm: f.height_mm } : {}),
      }),
    );
  }
  if (Array.isArray(r.furniture)) {
    room.furniture = r.furniture.filter(isObj).map(
      (f): Furniture => ({
        id: str(f.id, uid()),
        name: str(f.name, 'Item'),
        kind: str(f.kind, 'custom'),
        shape: f.shape === 'round' ? 'round' : 'rect',
        x_mm: num(f.x_mm, 0),
        y_mm: num(f.y_mm, 0),
        width_mm: num(f.width_mm, 1000),
        depth_mm: num(f.depth_mm, 600),
        rotation_deg: num(f.rotation_deg, 0),
        ...(typeof f.height_mm === 'number' && f.height_mm > 0 ? { height_mm: f.height_mm } : {}),
        ...(typeof f.elevation_mm === 'number' && f.elevation_mm !== 0 ? { elevation_mm: f.elevation_mm } : {}),
        ...(typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color) ? { color: f.color.toLowerCase() } : {}),
        ...(typeof f.group === 'string' && f.group.trim() ? { group: f.group.trim() } : {}),
      }),
    );
  }
  return room;
}

function normalizeOpening(o: Obj): Opening {
  const type = o.type === 'window' || o.type === 'opening' ? o.type : 'door';
  const op: Opening = {
    id: str(o.id, uid()),
    roomId: str(o.roomId, ''),
    wallIndex: num(o.wallIndex, 0),
    offset_mm: num(o.offset_mm, 0),
    width_mm: num(o.width_mm, 800),
    height_mm: num(o.height_mm, 2000),
    sill_mm: num(o.sill_mm, 0),
    type,
  };
  if (isObj(o.swing)) {
    op.swing = {
      hinge: o.swing.hinge === 'end' ? 'end' : 'start',
      side: o.swing.side === 'out' ? 'out' : 'in',
    };
  } else if (type === 'door') {
    op.swing = { hinge: 'start', side: 'in' };
  }
  if (o.from === 'end') op.from = 'end';
  if (typeof o.frame_mm === 'number' && o.frame_mm > 0) op.frame_mm = o.frame_mm;
  if (o.sizeWithFrame === false) op.sizeWithFrame = false;
  if (type === 'door' && o.operation === 'sliding') op.operation = 'sliding';
  if (type === 'door' && o.glass === true) op.glass = true;
  return op;
}
