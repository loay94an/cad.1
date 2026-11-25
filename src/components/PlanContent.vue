<script setup lang="ts">
/**
 * Draws rooms, furniture, walls, doors, windows and labels in millimetre coordinates.
 * Used on the floor view, in the room editor and for export.
 */
import { computed } from 'vue';
import { type Furniture, type LengthUnit, type Opening, type Room, hasWallType } from '../model/schema';
import { floorGeometry, openingGeometry, toWorld, type RoomGeom } from '../geometry/floor';
import { interiorAngle } from '../geometry/room';
import { HEADROOM_MM, ceilingCells, ceilingPlanes, hasSlope, headroomPolygon, innerEdges } from '../geometry/ceiling';
import { add, angleDeg, centroid, cross, dot, mid, rotate, scale, signedArea, sub, unit as unitVec, type Vec } from '../geometry/vec';
import { formatLength } from '../units';
import { floorCovering, floorLabel } from '../model/finishes';
import { PLAN, type Highlight } from './planStyle';

const props = withDefaults(
  defineProps<{
    rooms: Room[];
    openings: Opening[];
    unit: LengthUnit;
    selectedId?: string | null;
    /** Floor view: invisible tap area for rooms that aren't closed yet, and badges. */
    interactive?: boolean;
    /** Room editor (layout): walls, corners, openings and diagonals can be tapped. */
    editable?: boolean;
    /** Floor view: doors and windows of this room can be dragged. */
    openingsRoomId?: string | null;
    /** Room editor (furniture): furniture can be tapped and dragged. */
    furnitureEditable?: boolean;
    showCorners?: boolean;
    showAngles?: boolean;
    showDiagonals?: boolean;
    showDimensions?: boolean;
    showNames?: boolean;
    showFurniture?: boolean;
    showPins?: boolean;
    /** Room editor (notes): note dots can be dragged. */
    pinsEditable?: boolean;
    /** Note dot radius in mm (the floor view passes a size that stays readable when zoomed out). */
    pinRadius?: number;
    highlight?: Highlight;
    /** Short text under a room's area, e.g. "📝 2 files". */
    badges?: Record<string, string>;
    /** Highlight colour: the accent of the current mode. */
    accent?: string;
    /** Free height that counts as usable under sloped ceilings (mm). */
    headroom?: number;
    /** Tint floors by covering and name the covering under the area. */
    showFinishes?: boolean;
    /** Wall types: demolish / new colours, load-bearing hatch, heavier exterior walls. */
    showWallTypes?: boolean;
  }>(),
  {
    selectedId: null,
    interactive: true,
    editable: false,
    furnitureEditable: false,
    openingsRoomId: null,
    showCorners: false,
    showAngles: false,
    showDiagonals: false,
    showDimensions: true,
    showNames: true,
    showFurniture: true,
    showPins: true,
    pinsEditable: false,
    pinRadius: 160,
    highlight: () => ({}),
    badges: () => ({}),
    accent: PLAN.accent,
    headroom: HEADROOM_MM,
    showFinishes: false,
    showWallTypes: true,
  },
);

/** Floor fill of a room: selected, tinted by its covering, or plain. */
function floorFill(room: Room) {
  if (room.id === props.selectedId) return selectedFill.value;
  if (props.showFinishes) return floorCovering(room.finish?.floor)?.plan ?? (room.finish?.floor?.trim() ? '#f0ece2' : PLAN.floor);
  return PLAN.floor;
}

/** Selected room fill: a pale tint of the accent. */
const selectedFill = computed(() => (props.accent === PLAN.accent ? PLAN.selected : `${props.accent}22`));

const r1 = (x: number) => Math.round(x * 10) / 10;
const pts = (ps: Vec[]) => ps.map((p) => `${r1(p.x)},${r1(p.y)}`).join(' ');
const ring = (ps: Vec[]) => 'M' + ps.map((p) => `${r1(p.x)} ${r1(p.y)}`).join(' L') + ' Z';
const upright = (deg: number) => (deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg);
const fmtAngle = (a: number) => (Math.abs(a - Math.round(a)) < 0.05 ? `${Math.round(a)}°` : `${a.toFixed(1)}°`);

const geoms = computed(() => floorGeometry(props.rooms));
const closed = computed(() => geoms.value.filter((g) => g.solved.closed));
const open = computed(() => geoms.value.filter((g) => !g.solved.closed && g.inner.length > 1));
/** All the wall pieces of a room (a straight corner can step from one thickness to another). */
const wallPath = (g: RoomGeom) => g.pieces.filter((p) => p.length >= 3).map(ring).join(' ');

// ---- wall types ------------------------------------------------------------------

/** One piece per wall that isn't a plain existing interior wall: status colour, hatch, heavy outside line. */
const wallTypeItems = computed(() =>
  !props.showWallTypes
    ? []
    : closed.value.flatMap((g) => {
        const n = g.inner.length;
        return g.room.walls.flatMap((w, k) => {
          if (!hasWallType(w) || !g.thickness[k]) return [];
          const a = g.inner[k];
          const b = g.inner[(k + 1) % n];
          const [ao, bo] = g.outerFace[k];
          const t = g.thickness[k];
          // The heavy outside line runs on over the corner when the next wall is exterior too.
          const ext = (i: number) => (g.room.walls[i]?.kind === 'exterior' ? 18 : 0);
          const L = Math.hypot(b.x - a.x, b.y - a.y);
          const hatch: [Vec, Vec][] = [];
          if (w.loadBearing) {
            const step = Math.max(120, t * 0.9);
            for (let s = step / 2; s + t <= L; s += step) {
              const p = add(a, scale(g.dirs[k], s));
              hatch.push([p, add(p, add(scale(g.normals[k], t), scale(g.dirs[k], t)))]);
            }
          }
          return [
            {
              key: `${g.room.id}-t${k}`,
              status: w.status ?? 'existing',
              quad: pts(g.pieces[k]),
              hatch,
              exterior: w.kind === 'exterior' ? exteriorLine(g, k, ao, bo, ext((k - 1 + n) % n), ext((k + 1) % n)) : [],
            },
          ];
        });
      }),
);

/** The heavy outside line of an exterior wall, broken where its doors and windows are. */
function exteriorLine(g: RoomGeom, k: number, ao: Vec, bo: Vec, before: number, after: number): [Vec, Vec][] {
  const d = g.dirs[k];
  const L = Math.hypot(bo.x - ao.x, bo.y - ao.y);
  // Gaps as distances along the outside face.
  const holes = props.openings
    .filter((op) => op.roomId === g.room.id && op.wallIndex === k)
    .flatMap((op) => {
      const o = openingGeometry(g, op, geoms.value);
      return o?.fits ? [[dot(sub(o.ao, ao), d), dot(sub(o.bo, ao), d)] as [number, number]] : [];
    })
    .sort((x, y) => x[0] - y[0]);
  const out: [Vec, Vec][] = [];
  let from = -before;
  for (const [a, b] of holes) {
    if (a > from) out.push([add(ao, scale(d, from)), add(ao, scale(d, a))]);
    from = Math.max(from, b);
  }
  if (L + after > from) out.push([add(ao, scale(d, from)), add(ao, scale(d, L + after))]);
  return out;
}

// ---- sloped ceilings ----------------------------------------------------------

/** Attic rooms: the floor that is too low to stand on, the headroom line and where each slope ends. */
const slopes = computed(() =>
  closed.value
    .filter((g) => hasSlope(g.room.walls))
    .map((g) => {
      const planes = ceilingPlanes(g.inner, g.room.walls, g.room.height_mm ?? 2600);
      const head = headroomPolygon(g.inner, planes, props.headroom);
      const lines = innerEdges(head, g.inner);
      // The longest piece of the headroom line carries its label.
      const longest = lines.reduce<[Vec, Vec] | null>((b, l) => (!b || distSq(l) > distSq(b) ? l : b), null);
      const breaks = ceilingCells(g.inner, planes).flatMap((c) => (c.plane.wall < 0 ? [] : innerEdges(c.poly, g.inner)));
      return {
        id: g.room.id,
        low: `${ring(g.inner)}${head.length >= 3 ? ' ' + ring(head) : ''}`,
        lines,
        breaks,
        label: longest
          ? { p: mid(longest[0], longest[1]), angle: upright(angleDeg(sub(longest[1], longest[0]))) }
          : null,
        area: Math.abs(signedArea(head)) / 1e6,
      };
    }),
);
const distSq = (l: [Vec, Vec]) => (l[1].x - l[0].x) ** 2 + (l[1].y - l[0].y) ** 2;
const headroomText = computed(() => `${(props.headroom / 1000).toFixed(2)} m`);

// ---- furniture ----------------------------------------------------------------

interface FurnitureItem {
  id: string;
  roomId: string;
  name: string;
  round: boolean;
  points: string;
  c: Vec;
  rx: number;
  ry: number;
  angle: number;
  labelAngle: number;
  fontSize: number;
  /** Hangs above the floor (wall cupboard, shelf): drawn dashed, like on building plans. */
  raised: boolean;
  fill: string;
  line: string;
}

/**
 * Chimneys, columns, ducts and blocks: solid like the walls. A chimney shows its
 * flue, a duct is crossed through (the usual sign for a shaft).
 */
const fixedItems = computed(() =>
  props.rooms.flatMap((room) =>
    (room.fixed ?? []).map((f) => {
      const angle = f.rotation_deg + room.rotation_deg;
      const c = toWorld(room, { x: f.x_mm, y: f.y_mm });
      const box = (w: number, d: number) =>
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([sx, sy]) => add(c, rotate({ x: (sx * w) / 2, y: (sy * d) / 2 }, angle)));
      const outline = box(f.width_mm, f.depth_mm);
      const flue = Math.min(f.width_mm, f.depth_mm) * 0.45;
      return {
        id: f.id,
        roomId: room.id,
        kind: f.kind,
        round: f.shape === 'round',
        points: pts(outline),
        c: { x: r1(c.x), y: r1(c.y) },
        rx: f.width_mm / 2,
        ry: f.depth_mm / 2,
        angle: r1(angle),
        flue: f.kind === 'chimney' ? (f.shape === 'round' ? null : pts(box(flue, flue))) : null,
        flueR: flue / 2,
        cross:
          f.kind === 'duct' && f.shape !== 'round'
            ? ([
                [outline[0], outline[2]],
                [outline[1], outline[3]],
              ] as [Vec, Vec][])
            : [],
      };
    }),
  ),
);

/** Stairs: outline, a line per step and an arrow the way it goes (up or down). Slopes: outline, arrow and gradient. */
const stairItems = computed(() =>
  props.rooms.flatMap((room) =>
    (room.stairs ?? []).map((s) => {
      const angle = s.rotation_deg + room.rotation_deg;
      const c = toWorld(room, { x: s.x_mm, y: s.y_mm });
      const at = (lx: number, ly: number) => add(c, rotate({ x: lx, y: ly }, angle));
      const hl2 = s.length_mm / 2;
      const hw = s.width_mm / 2;
      const steps =
        s.kind === 'stairs' && s.steps > 1
          ? Array.from({ length: s.steps - 1 }, (_, i) => {
              const x = -hl2 + ((i + 1) * s.length_mm) / s.steps;
              return [at(x, -hw), at(x, hw)] as [Vec, Vec];
            })
          : [];
      const tail = at(-hl2 + s.length_mm * 0.08, 0);
      const head = at(hl2 - s.length_mm * 0.06, 0);
      const ah = Math.min(220, s.width_mm * 0.3);
      const wing1 = at(hl2 - s.length_mm * 0.06 - ah, -ah * 0.6);
      const wing2 = at(hl2 - s.length_mm * 0.06 - ah, ah * 0.6);
      const slope = s.length_mm > 0 ? (s.rise_mm / s.length_mm) * 100 : 0;
      const labelPos = at(0, 0);
      const fontSize = Math.max(70, Math.min(120, s.width_mm / 6));
      return {
        id: s.id,
        roomId: room.id,
        kind: s.kind,
        outline: pts([at(-hl2, -hw), at(hl2, -hw), at(hl2, hw), at(-hl2, hw)]),
        steps,
        arrow: `M${r1(tail.x)} ${r1(tail.y)} L${r1(head.x)} ${r1(head.y)} M${r1(wing1.x)} ${r1(wing1.y)} L${r1(head.x)} ${r1(head.y)} L${r1(wing2.x)} ${r1(wing2.y)}`,
        label:
          s.kind === 'stairs'
            ? `${s.down ? 'down' : 'up'} ${formatLength(s.rise_mm, 'cm')} cm · ${s.steps} steps`
            : `${s.down ? 'down' : 'up'} ${slope.toFixed(1)} %`,
        lx: r1(labelPos.x),
        ly: r1(labelPos.y),
        labelAngle: r1(upright(angle)),
        fontSize,
        offset: hw * 0.45,
      };
    }),
  ),
);

const pinItems = computed(() =>
  props.showPins
    ? props.rooms.flatMap((room) =>
        (room.pins ?? []).map((p, i) => {
          const c = toWorld(room, { x: p.x_mm, y: p.y_mm });
          return { id: p.id, roomId: room.id, x: r1(c.x), y: r1(c.y), label: String(i + 1), title: p.title };
        }),
      )
    : [],
);

/** `hex` mixed with white (45 % colour), as a plain value that exports keep. */
function pale(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(255 - (255 - ((v >> shift) & 255)) * 0.45);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

const furnitureItems = computed<FurnitureItem[]>(() =>
  !props.showFurniture
    ? []
    : props.rooms.flatMap((room) =>
    (room.furniture ?? []).map((f: Furniture) => {
      const angle = f.rotation_deg + room.rotation_deg;
      const c = toWorld(room, { x: f.x_mm, y: f.y_mm });
      const hw = f.width_mm / 2;
      const hd = f.depth_mm / 2;
      const corners = [
        { x: -hw, y: -hd },
        { x: hw, y: -hd },
        { x: hw, y: hd },
        { x: -hw, y: hd },
      ].map((p) => add(c, rotate(p, angle)));
      return {
        id: f.id,
        roomId: room.id,
        name: f.name,
        round: f.shape === 'round',
        points: pts(corners),
        c: { x: r1(c.x), y: r1(c.y) },
        rx: hw,
        ry: hd,
        angle: r1(angle),
        labelAngle: r1(upright(f.width_mm >= f.depth_mm ? angle : angle + 90)),
        fontSize: Math.max(60, Math.min(110, Math.min(f.width_mm, f.depth_mm) / 4)),
        raised: (f.elevation_mm ?? 0) > 0,
        // A colour is drawn pale, so the name stays readable.
        fill: f.color ? pale(f.color) : PLAN.furniture,
        line: f.color ?? PLAN.furnitureLine,
      };
    }),
  ),
);

// ---- doors and windows ------------------------------------------------------

interface OpeningItem {
  id: string;
  roomId: string;
  type: Opening['type'];
  fits: boolean;
  gap: string;
  /** Generous tap area around the gap (room editor). */
  hit: string;
  jambs: [Vec, Vec][];
  lines: [Vec, Vec][];
  leaf: [Vec, Vec] | null;
  arc: string;
  /** Frame profiles at both sides of the gap. */
  frames: string[];
  /** Sliding door panels. */
  panels: { points: string; glass: boolean }[];
  /** Sliding door: which way the panel opens. */
  arrow: string;
  /** Doors and passages: the floor runs on through the wall. */
  floor: string;
}

const openingItems = computed<OpeningItem[]>(() =>
  props.openings.flatMap((op) => {
    const g = geoms.value.find((x) => x.room.id === op.roomId);
    const o = g && openingGeometry(g, op, geoms.value);
    if (!o) return [];
    const item: OpeningItem = {
      id: op.id,
      roomId: op.roomId,
      type: op.type,
      fits: o.fits,
      gap: pts([o.a, o.b, o.bo, o.ao]),
      hit: pts([
        add(o.a, scale(o.n, -300)),
        add(o.b, scale(o.n, -300)),
        add(o.bo, scale(o.n, 200)),
        add(o.ao, scale(o.n, 200)),
      ]),
      jambs: [
        [o.a, o.ao],
        [o.b, o.bo],
      ],
      lines: [],
      leaf: null,
      arc: '',
      frames: [],
      panels: [],
      arrow: '',
      floor: floorFill(g.room),
    };
    const width = o.s1 - o.s0;
    const f = op.type === 'opening' ? 0 : Math.min(Math.max(0, op.frame_mm ?? 0), width / 3);
    const half = o.depth / 2;
    /** A point `along` mm into the gap and `across` mm into the wall from its inside face. */
    const at = (along: number, across: number) => add(add(o.a, scale(o.d, along)), scale(o.n, across));
    const box = (a0: number, a1: number, c0: number, c1: number) => pts([at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)]);
    const fd = Math.min(o.depth, Math.max(70, f));
    if (f > 0) item.frames = [box(0, f, half - fd / 2, half + fd / 2), box(width - f, width, half - fd / 2, half + fd / 2)];
    if (op.type === 'window') {
      item.lines = [
        [o.a, o.b],
        [o.ao, o.bo],
        [at(f, half), at(width - f, half)],
      ];
    } else if (op.type === 'door' && op.operation === 'sliding') {
      // Two panels side by side in the wall; the one that moves slides over the other towards `hinge`.
      const clear = width - 2 * f;
      const pw = clear / 2 + 40;
      const toEnd = (op.swing?.hinge ?? 'start') === 'end';
      const glass = !!op.glass;
      const fixedAt = toEnd ? width - f - pw : f;
      const movingAt = toEnd ? f : width - f - pw;
      item.panels = [
        { points: box(fixedAt, fixedAt + pw, half + 5, half + 45), glass },
        { points: box(movingAt, movingAt + pw, half - 45, half - 5), glass },
      ];
      const y = -Math.min(200, clear / 5);
      const dir = toEnd ? 1 : -1;
      const from = at(movingAt + pw / 2 - (dir * pw) / 4, y);
      const to = at(movingAt + pw / 2 + (dir * pw) / 4, y);
      const back = unitVec(sub(from, to));
      const side = scale({ x: -back.y, y: back.x }, 50);
      const head = add(to, scale(back, 90));
      item.arrow = `M${r1(from.x)} ${r1(from.y)} L${r1(to.x)} ${r1(to.y)} M${r1(head.x + side.x)} ${r1(head.y + side.y)} L${r1(to.x)} ${r1(to.y)} L${r1(head.x - side.x)} ${r1(head.y - side.y)}`;
    } else if (op.type === 'door') {
      const swing = op.swing ?? { hinge: 'start', side: 'in' };
      const inward = swing.side === 'in';
      const atStart = swing.hinge === 'start';
      // The leaf hangs inside the frame and is as wide as the clear opening.
      const face = inward ? 0 : o.depth;
      const hinge = at(atStart ? f : width - f, face);
      const other = at(atStart ? width - f : f, face);
      const w = width - 2 * f;
      const tip = add(hinge, scale(inward ? scale(o.n, -1) : o.n, w));
      const sweep = cross(sub(tip, hinge), sub(other, hinge)) > 0 ? 1 : 0;
      item.leaf = [hinge, tip];
      item.arc = `M${r1(tip.x)} ${r1(tip.y)} A${r1(w)} ${r1(w)} 0 0 ${sweep} ${r1(other.x)} ${r1(other.y)}`;
    }
    return [item];
  }),
);

// ---- labels -----------------------------------------------------------------

const wallLabels = computed(() =>
  (props.showDimensions ? closed.value : []).flatMap((g) =>
    g.room.walls.map((w, k) => {
      const a = g.inner[k];
      const b = g.inner[(k + 1) % g.inner.length];
      const p = add(mid(a, b), scale(g.normals[k], -PLAN.wallLabelSize * 1.6));
      return {
        key: `${g.room.id}-${k}`,
        x: r1(p.x),
        y: r1(p.y),
        angle: r1(upright(angleDeg(g.dirs[k]))),
        text: formatLength(w.length_mm, props.unit),
      };
    }),
  ),
);

const slopeArea = computed(() => Object.fromEntries(slopes.value.map((s) => [s.id, s.area])));
const roomLabels = computed(() =>
  (props.showNames ? geoms.value : []).map((g) => {
    const c = g.solved.closed ? centroid(g.inner) : g.inner[0];
    return {
      key: g.room.id,
      x: r1(c.x),
      y: r1(c.y),
      name: g.room.name,
      area:
        (g.solved.closed ? `${g.solved.area_m2.toFixed(2)} m²` : 'not closed yet') +
        (slopeArea.value[g.room.id] !== undefined ? ` (${slopeArea.value[g.room.id].toFixed(2)} m² ≥ ${headroomText.value})` : '') +
        (g.room.floorLevel_mm
          ? ` · floor ${g.room.floorLevel_mm > 0 ? '+' : '−'}${formatLength(Math.abs(g.room.floorLevel_mm), 'cm')} cm`
          : ''),
      finish: props.showFinishes ? floorLabel(g.room) : '',
      badge: props.interactive ? props.badges[g.room.id] ?? '' : '',
    };
  }),
);

/** Inside angle at every corner, drawn as an arc with its value. */
const angleMarks = computed(() =>
  props.showAngles
    ? closed.value.flatMap((g) => {
        const n = g.inner.length;
        const sign = signedArea(g.inner) >= 0 ? 1 : -1;
        return g.inner.map((v, k) => {
          const theta = interiorAngle(g.inner, k);
          const u1 = unitVec(sub(g.inner[(k - 1 + n) % n], v));
          const u2 = unitVec(sub(g.inner[(k + 1) % n], v));
          const R = 230;
          const a = add(v, scale(u2, R));
          const b = add(v, scale(u1, R));
          const label = add(v, scale(rotate(u2, (sign * theta) / 2), 470));
          return {
            key: `${g.room.id}-a${k}`,
            k,
            arc: `M${r1(a.x)} ${r1(a.y)} A${R} ${R} 0 ${theta > 180 ? 1 : 0} ${sign > 0 ? 1 : 0} ${r1(b.x)} ${r1(b.y)}`,
            x: r1(label.x),
            y: r1(label.y),
            text: fmtAngle(theta),
          };
        });
      })
    : [],
);

const diagonalItems = computed(() =>
  props.showDiagonals
    ? geoms.value.flatMap((g) =>
        g.room.diagonals.flatMap((d, i) => {
          const a = g.inner[d.from];
          const b = g.inner[d.to];
          if (!a || !b || d.from === d.to) return [];
          const m = mid(a, b);
          return [
            {
              key: `${g.room.id}-d${i}`,
              i,
              a,
              b,
              x: r1(m.x),
              y: r1(m.y),
              angle: r1(upright(angleDeg(sub(b, a)))),
              text: d.length_mm > 0 ? formatLength(d.length_mm, props.unit) : '?',
            },
          ];
        }),
      )
    : [],
);

const corners = computed(() =>
  props.showCorners
    ? geoms.value.flatMap((g) => {
        // An open outline ends on the corner where the next wall starts; don't label it twice.
        const n = g.solved.closed ? g.inner.length : Math.min(g.inner.length, g.room.walls.length);
        return g.inner
          .slice(0, n)
          .map((p, k) => ({ key: `${g.room.id}-c${k}`, k, x: r1(p.x), y: r1(p.y), label: `C${k + 1}` }));
      })
    : [],
);

/** Inside face of every entered wall, for tapping and highlighting. */
const edges = computed(() =>
  geoms.value.flatMap((g) => {
    const m = g.inner.length;
    const count = g.solved.closed ? m : m - 1;
    return Array.from({ length: Math.max(0, count) }, (_, k) => ({
      key: `${g.room.id}-e${k}`,
      k,
      a: g.inner[k],
      b: g.inner[(k + 1) % m],
    }));
  }),
);

const hl = computed(() => props.highlight);
const activeEdge = computed(() => (hl.value.wall == null ? undefined : edges.value[hl.value.wall]));
const activeOpening = computed(() => openingItems.value.find((o) => o.id === hl.value.opening));
</script>

<template>
  <g :font-family="PLAN.font">
    <!-- floors -->
    <polygon
      v-for="g in closed"
      :key="'f' + g.room.id"
      :data-room="g.room.id"
      :points="pts(g.inner)"
      :fill="floorFill(g.room)"
    />

    <!-- sloped ceilings: low floor shaded, headroom line dashed, end of each slope dotted -->
    <g v-for="s in slopes" :key="'s' + s.id" pointer-events="none">
      <path :d="s.low" fill="#000" fill-opacity="0.07" fill-rule="evenodd" />
      <line
        v-for="(l, i) in s.breaks"
        :key="'b' + i"
        :x1="r1(l[0].x)"
        :y1="r1(l[0].y)"
        :x2="r1(l[1].x)"
        :y2="r1(l[1].y)"
        :stroke="PLAN.arc"
        stroke-width="10"
        stroke-dasharray="20 50"
      />
      <line
        v-for="(l, i) in s.lines"
        :key="'h' + i"
        :x1="r1(l[0].x)"
        :y1="r1(l[0].y)"
        :x2="r1(l[1].x)"
        :y2="r1(l[1].y)"
        :stroke="PLAN.dim"
        stroke-width="14"
        stroke-dasharray="120 70"
      />
      <text
        v-if="s.label && showDimensions"
        :x="r1(s.label.p.x)"
        :y="r1(s.label.p.y) - 40"
        :transform="`rotate(${s.label.angle} ${r1(s.label.p.x)} ${r1(s.label.p.y)})`"
        text-anchor="middle"
        :font-size="PLAN.wallLabelSize * 0.8"
        :fill="PLAN.dim"
      >
        {{ headroomText }}
      </text>
    </g>

    <!-- stairs and slopes -->
    <g
      v-for="s in stairItems"
      :key="s.id"
      :data-room="s.roomId"
      :data-stair="editable ? s.id : undefined"
      :class="{ tap: editable }"
    >
      <polygon
        :points="s.outline"
        :fill="s.kind === 'ramp' ? PLAN.ramp : PLAN.paper"
        :stroke="s.id === hl.stair ? accent : PLAN.wall"
        :stroke-width="s.id === hl.stair ? 35 : 14"
      />
      <line
        v-for="(l, i) in s.steps"
        :key="i"
        :x1="l[0].x"
        :y1="l[0].y"
        :x2="l[1].x"
        :y2="l[1].y"
        :stroke="PLAN.wall"
        stroke-width="8"
        pointer-events="none"
      />
      <path :d="s.arrow" fill="none" :stroke="PLAN.wall" stroke-width="16" stroke-linecap="round" pointer-events="none" />
      <text
        :x="s.lx"
        :y="s.ly + s.offset"
        :transform="`rotate(${s.labelAngle} ${s.lx} ${s.ly})`"
        text-anchor="middle"
        :font-size="s.fontSize"
        :fill="PLAN.label"
        pointer-events="none"
      >
        {{ s.label }}
      </text>
    </g>

    <!-- walls -->
    <path
      v-for="g in closed"
      :key="'w' + g.room.id"
      :data-room="g.room.id"
      :d="wallPath(g)"
      fill-rule="nonzero"
      :fill="PLAN.wall"
    />

    <!-- chimneys, columns, ducts and blocks -->
    <g
      v-for="f in fixedItems"
      :key="f.id"
      :data-room="f.roomId"
      :data-fixed="editable ? f.id : undefined"
      :class="{ tap: editable }"
    >
      <ellipse
        v-if="f.round"
        :cx="f.c.x"
        :cy="f.c.y"
        :rx="f.rx"
        :ry="f.ry"
        :transform="`rotate(${f.angle} ${f.c.x} ${f.c.y})`"
        :fill="f.kind === 'duct' ? PLAN.paper : PLAN.wall"
        :stroke="f.id === hl.fixed ? accent : PLAN.wall"
        :stroke-width="f.id === hl.fixed ? 35 : 14"
      />
      <polygon
        v-else
        :points="f.points"
        :fill="f.kind === 'duct' ? PLAN.paper : PLAN.wall"
        :stroke="f.id === hl.fixed ? accent : PLAN.wall"
        :stroke-width="f.id === hl.fixed ? 35 : 14"
        stroke-linejoin="round"
      />
      <polygon v-if="f.flue" :points="f.flue" :fill="PLAN.paper" pointer-events="none" />
      <circle v-else-if="f.kind === 'chimney'" :cx="f.c.x" :cy="f.c.y" :r="f.flueR" :fill="PLAN.paper" pointer-events="none" />
      <line
        v-for="(l, i) in f.cross"
        :key="i"
        :x1="r1(l[0].x)"
        :y1="r1(l[0].y)"
        :x2="r1(l[1].x)"
        :y2="r1(l[1].y)"
        :stroke="PLAN.wall"
        stroke-width="12"
        pointer-events="none"
      />
    </g>

    <!-- wall types: new red, to demolish yellow and dashed, load-bearing hatched, exterior heavier -->
    <g v-for="w in wallTypeItems" :key="w.key" pointer-events="none">
      <polygon
        v-if="w.status !== 'existing'"
        :points="w.quad"
        :fill="w.status === 'new' ? PLAN.wallNew : PLAN.wallDemolish"
        :stroke="w.status === 'demolish' ? PLAN.wall : 'none'"
        :stroke-width="w.status === 'demolish' ? 12 : 0"
        :stroke-dasharray="w.status === 'demolish' ? '60 40' : undefined"
      />
      <line
        v-for="(l, i) in w.hatch"
        :key="i"
        :x1="r1(l[0].x)"
        :y1="r1(l[0].y)"
        :x2="r1(l[1].x)"
        :y2="r1(l[1].y)"
        :stroke="w.status === 'existing' ? PLAN.paper : PLAN.wall"
        stroke-width="10"
      />
      <line
        v-for="(l, i) in w.exterior"
        :key="'e' + i"
        :x1="r1(l[0].x)"
        :y1="r1(l[0].y)"
        :x2="r1(l[1].x)"
        :y2="r1(l[1].y)"
        stroke="#000"
        stroke-width="36"
        stroke-linecap="butt"
      />
    </g>

    <!-- rooms that aren't closed yet -->
    <template v-for="g in open" :key="'o' + g.room.id">
      <polyline
        v-if="interactive"
        :data-room="g.room.id"
        :points="pts(g.inner)"
        fill="none"
        stroke="#000"
        stroke-opacity="0"
        stroke-width="400"
      />
      <polyline
        :data-room="g.room.id"
        :points="pts(g.inner)"
        fill="none"
        :stroke="PLAN.warn"
        stroke-width="30"
        stroke-dasharray="120 80"
      />
    </template>

    <!-- room editor: wide invisible tap targets on each wall (below doors and windows, so those win) -->
    <template v-if="editable">
      <line
        v-for="e in edges"
        :key="e.key"
        :data-wall="e.k"
        :x1="e.a.x"
        :y1="e.a.y"
        :x2="e.b.x"
        :y2="e.b.y"
        stroke="#000"
        stroke-opacity="0"
        stroke-width="450"
        class="tap"
      />
    </template>

    <!-- doors and windows -->
    <g
      v-for="o in openingItems"
      :key="o.id"
      :data-opening="editable || o.roomId === openingsRoomId ? o.id : undefined"
      :data-room="o.roomId"
      :class="{ tap: editable || o.roomId === openingsRoomId }"
    >
      <polygon v-if="editable || o.roomId === openingsRoomId" :points="o.hit" fill="#000" fill-opacity="0" />
      <polygon :points="o.gap" :fill="o.type === 'window' ? PLAN.paper : o.floor" />
      <line
        v-for="(j, i) in o.jambs"
        :key="'j' + i"
        :x1="j[0].x"
        :y1="j[0].y"
        :x2="j[1].x"
        :y2="j[1].y"
        :stroke="o.fits ? PLAN.wall : PLAN.warn"
        stroke-width="12"
      />
      <line
        v-for="(l, i) in o.lines"
        :key="'l' + i"
        :x1="l[0].x"
        :y1="l[0].y"
        :x2="l[1].x"
        :y2="l[1].y"
        :stroke="o.fits ? PLAN.wall : PLAN.warn"
        stroke-width="10"
      />
      <template v-if="o.leaf">
        <line
          :x1="o.leaf[0].x"
          :y1="o.leaf[0].y"
          :x2="o.leaf[1].x"
          :y2="o.leaf[1].y"
          :stroke="o.fits ? PLAN.wall : PLAN.warn"
          stroke-width="30"
        />
        <path :d="o.arc" :fill="editable ? 'rgba(0,0,0,0)' : 'none'" :stroke="PLAN.arc" stroke-width="8" />
      </template>
      <polygon
        v-for="(fr, i) in o.frames"
        :key="'f' + i"
        :points="fr"
        :fill="PLAN.paper"
        :stroke="o.fits ? PLAN.wall : PLAN.warn"
        stroke-width="8"
      />
      <polygon
        v-for="(p, i) in o.panels"
        :key="'p' + i"
        :points="p.points"
        :fill="p.glass ? PLAN.glass : PLAN.paper"
        :stroke="o.fits ? PLAN.wall : PLAN.warn"
        stroke-width="10"
      />
      <path v-if="o.arrow" :d="o.arrow" fill="none" :stroke="PLAN.arc" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
    </g>
    <polygon
      v-if="activeOpening"
      :points="activeOpening.gap"
      fill="none"
      :stroke="accent"
      stroke-width="40"
      stroke-linejoin="round"
      pointer-events="none"
    />

    <!-- furniture: above walls, doors and windows, so a piece against a wall stays visible and draggable -->
    <g
      v-for="f in furnitureItems"
      :key="f.id"
      :data-room="f.roomId"
      :data-furniture="furnitureEditable ? f.id : undefined"
      :class="{ tap: furnitureEditable }"
      :pointer-events="editable || f.roomId === openingsRoomId ? 'none' : undefined"
    >
      <ellipse
        v-if="f.round"
        :cx="f.c.x"
        :cy="f.c.y"
        :rx="f.rx"
        :ry="f.ry"
        :transform="`rotate(${f.angle} ${f.c.x} ${f.c.y})`"
        :fill="f.fill"
        :fill-opacity="f.raised ? 0 : 1"
        :stroke="f.id === hl.furniture ? accent : f.line"
        :stroke-width="f.id === hl.furniture ? 35 : 12"
        :stroke-dasharray="f.raised ? '70 45' : undefined"
      />
      <polygon
        v-else
        :points="f.points"
        :fill="f.fill"
        :fill-opacity="f.raised ? 0 : 1"
        :stroke="f.id === hl.furniture ? accent : f.line"
        :stroke-width="f.id === hl.furniture ? 35 : 12"
        :stroke-dasharray="f.raised ? '70 45' : undefined"
      />
      <text
        :x="f.c.x"
        :y="f.c.y + f.fontSize * 0.35"
        :transform="`rotate(${f.labelAngle} ${f.c.x} ${f.c.y})`"
        text-anchor="middle"
        :font-size="f.fontSize"
        :fill="PLAN.dim"
        pointer-events="none"
      >
        {{ f.name }}
      </text>
    </g>

    <!-- diagonals -->
    <g v-for="d in diagonalItems" :key="d.key" :data-diagonal="editable ? d.i : undefined" :class="{ tap: editable }">
      <line
        v-if="editable"
        :x1="d.a.x"
        :y1="d.a.y"
        :x2="d.b.x"
        :y2="d.b.y"
        stroke="#000"
        stroke-opacity="0"
        stroke-width="300"
      />
      <line
        :x1="d.a.x"
        :y1="d.a.y"
        :x2="d.b.x"
        :y2="d.b.y"
        :stroke="d.i === hl.diagonal ? accent : PLAN.diagonal"
        :stroke-width="d.i === hl.diagonal ? 40 : 18"
        stroke-dasharray="110 70"
      />
      <text
        :x="d.x"
        :y="d.y - 60"
        :transform="`rotate(${d.angle} ${d.x} ${d.y})`"
        text-anchor="middle"
        font-size="110"
        :font-weight="d.i === hl.diagonal ? 'bold' : 'normal'"
        :fill="d.i === hl.diagonal ? accent : PLAN.diagonal"
        pointer-events="none"
      >
        {{ d.text }}
      </text>
    </g>

    <!-- the wall being edited -->
    <line
      v-if="activeEdge"
      :x1="activeEdge.a.x"
      :y1="activeEdge.a.y"
      :x2="activeEdge.b.x"
      :y2="activeEdge.b.y"
      :stroke="accent"
      stroke-width="60"
      stroke-linecap="round"
      pointer-events="none"
    />

    <!-- labels -->
    <g pointer-events="none">
      <text
        v-for="l in wallLabels"
        :key="l.key"
        :x="l.x"
        :y="l.y + PLAN.wallLabelSize * 0.35"
        :transform="`rotate(${l.angle} ${l.x} ${l.y})`"
        text-anchor="middle"
        :font-size="PLAN.wallLabelSize"
        :fill="PLAN.dim"
      >
        {{ l.text }}
      </text>
      <g v-for="l in roomLabels" :key="'n' + l.key">
        <text
          :x="l.x"
          :y="l.y - 30"
          text-anchor="middle"
          :font-size="PLAN.roomNameSize"
          font-weight="bold"
          :fill="PLAN.label"
        >
          {{ l.name }}
        </text>
        <text
          :x="l.x"
          :y="l.y + PLAN.roomAreaSize + 20"
          text-anchor="middle"
          :font-size="PLAN.roomAreaSize"
          :fill="PLAN.dim"
        >
          {{ l.area }}
        </text>
        <text
          v-if="l.finish"
          :x="l.x"
          :y="l.y + PLAN.roomAreaSize * 2 + 60"
          text-anchor="middle"
          :font-size="PLAN.roomAreaSize * 0.9"
          font-style="italic"
          :fill="PLAN.dim"
        >
          {{ l.finish }}
        </text>
        <text
          v-if="l.badge"
          :x="l.x"
          :y="l.y + PLAN.roomAreaSize * (l.finish ? 3 : 2) + (l.finish ? 100 : 70)"
          text-anchor="middle"
          :font-size="PLAN.roomAreaSize * 0.9"
          :fill="PLAN.dim"
        >
          {{ l.badge }}
        </text>
      </g>
      <g v-for="a in angleMarks" :key="a.key">
        <path
          :d="a.arc"
          fill="none"
          :stroke="a.k === hl.corner ? accent : PLAN.angle"
          :stroke-width="a.k === hl.corner ? 22 : 10"
        />
        <text
          :x="a.x"
          :y="a.y + 38"
          text-anchor="middle"
          font-size="105"
          :font-weight="a.k === hl.corner ? 'bold' : 'normal'"
          :fill="a.k === hl.corner ? accent : PLAN.angle"
        >
          {{ a.text }}
        </text>
      </g>
    </g>

    <!-- note dots -->
    <g
      v-for="p in pinItems"
      :key="p.id"
      :data-room="p.roomId"
      :data-pin="p.id"
      :class="{ tap: pinsEditable || interactive }"
      :pointer-events="editable ? 'none' : undefined"
    >
      <circle
        v-if="p.id === hl.pin"
        :cx="p.x"
        :cy="p.y"
        :r="pinRadius * 1.45"
        fill="none"
        :stroke="accent"
        :stroke-width="pinRadius * 0.25"
      />
      <circle :cx="p.x" :cy="p.y" :r="pinRadius" :fill="PLAN.pin" stroke="#fff" :stroke-width="pinRadius * 0.15" />
      <text
        :x="p.x"
        :y="p.y + pinRadius * 0.38"
        text-anchor="middle"
        :font-size="pinRadius * 1.1"
        font-weight="bold"
        fill="#fff"
        pointer-events="none"
      >
        {{ p.label }}
      </text>
      <text
        v-if="p.title && pinsEditable"
        :x="p.x + pinRadius * 1.5"
        :y="p.y + pinRadius * 0.35"
        :font-size="pinRadius * 0.9"
        :fill="PLAN.label"
        pointer-events="none"
      >
        {{ p.title }}
      </text>
    </g>

    <!-- corner markers -->
    <g v-for="c in corners" :key="c.key" :data-corner="editable ? c.k : undefined" :class="{ tap: editable }">
      <circle
        v-if="c.k === hl.corner"
        :cx="c.x"
        :cy="c.y"
        r="175"
        fill="none"
        :stroke="accent"
        stroke-width="30"
      />
      <circle :cx="c.x" :cy="c.y" r="130" :fill="accent" />
      <text
        :x="c.x"
        :y="c.y + 32"
        text-anchor="middle"
        font-size="90"
        font-weight="bold"
        fill="#fff"
        pointer-events="none"
      >
        {{ c.label }}
      </text>
    </g>
  </g>
</template>
