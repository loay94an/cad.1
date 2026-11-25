import { createApp, h } from 'vue';
import { DEFAULT_VIEW, GHOST_COLOR, type Floor, type Project, type ViewSettings, fileIdOf, neighbourFloor } from '../model/schema';
import type { UtilityId } from '../model/utilities';
import GhostFloor from '../components/GhostFloor.vue';
import { type EmbeddedFiles, serializeProject } from '../model/migrate';
import type { StorageAdapter } from '../storage/types';
import { boundsOf, roomGeometry } from '../geometry/floor';
import PlanContent from '../components/PlanContent.vue';
import { PLAN } from '../components/planStyle';
import ElectricalLayer from '../components/ElectricalLayer.vue';
import UtilityLayer from '../components/UtilityLayer.vue';
import EendraadschemaSvg from '../components/EendraadschemaSvg.vue';
import { circuitCodes } from '../model/electrical';
import { roomNameFn } from '../electrical/rooms';

const MARGIN_MM = 600;
/** Height of one legend row, in mm. */
const LEGEND_ROW_MM = 350;

type LegendKey = 'existing' | 'new' | 'demolish' | 'loadBearing' | 'exterior';
const LEGEND_LABEL: Record<LegendKey, string> = {
  existing: 'Existing wall',
  new: 'New wall',
  demolish: 'Wall to demolish',
  loadBearing: 'Load-bearing',
  exterior: 'Exterior wall',
};

/** The wall types drawn on a floor, for the legend. Empty when every wall is a plain existing one. */
export function wallLegend(floor: Floor): LegendKey[] {
  const walls = floor.rooms.flatMap((r) => r.walls);
  const used = new Set<LegendKey>();
  for (const w of walls) {
    if (w.status === 'new') used.add('new');
    if (w.status === 'demolish') used.add('demolish');
    if (w.loadBearing) used.add('loadBearing');
    if (w.kind === 'exterior') used.add('exterior');
  }
  if (used.has('new') || used.has('demolish')) used.add('existing');
  return (Object.keys(LEGEND_LABEL) as LegendKey[]).filter((k) => used.has(k));
}

const SW = 500;
const SH = 180;
const LEGEND_FONT = 140;
const itemWidth = (k: LegendKey) => SW + 160 + LEGEND_LABEL[k].length * LEGEND_FONT * 0.55 + 400;

/** Where each legend item goes: rows that fit in `maxWidth`. */
function legendLayout(keys: LegendKey[], maxWidth: number) {
  let cx = 0;
  let row = 0;
  const at = keys.map((k) => {
    if (cx > 0 && cx + itemWidth(k) > maxWidth) {
      cx = 0;
      row++;
    }
    const p = { k, dx: cx, row };
    cx += itemWidth(k);
    return p;
  });
  return { at, rows: keys.length ? row + 1 : 0 };
}

/** Swatches with labels, `x`,`y` the top left, in mm. */
function legendNode(layout: ReturnType<typeof legendLayout>, x: number, y0: number) {
  const sw = SW;
  const sh = SH;
  const font = LEGEND_FONT;
  const items = layout.at.map(({ k, dx, row }) => {
    const x0 = x + dx;
    const y = y0 + row * LEGEND_ROW_MM;
    const box = { x: x0, y, width: sw, height: sh };
    const swatch =
      k === 'existing'
        ? [h('rect', { ...box, fill: PLAN.wall })]
        : k === 'new'
          ? [h('rect', { ...box, fill: PLAN.wallNew })]
          : k === 'demolish'
            ? [h('rect', { ...box, fill: PLAN.wallDemolish, stroke: PLAN.wall, 'stroke-width': 12, 'stroke-dasharray': '60 40' })]
            : k === 'loadBearing'
              ? [
                  h('rect', { ...box, fill: PLAN.wall }),
                  ...[60, 190, 320].map((dx) =>
                    h('line', { x1: x0 + dx, y1: y + sh, x2: x0 + dx + sh, y2: y, stroke: PLAN.paper, 'stroke-width': 10 }),
                  ),
                ]
              : [h('rect', { ...box, fill: PLAN.wall }), h('line', { x1: x0, y1: y + sh, x2: x0 + sw, y2: y + sh, stroke: '#000', 'stroke-width': 36 })];
    return h('g', {}, [
      ...swatch,
      h('text', { x: x0 + sw + 160, y: y + sh * 0.5 + font * 0.35, 'font-size': font, fill: PLAN.label, 'font-family': PLAN.font }, LEGEND_LABEL[k]),
    ]);
  });
  return h('g', { 'pointer-events': 'none' }, items);
}

/** What an export shows. Without it, the plan's own Show choices are used. */
export interface ExportOptions {
  view?: ViewSettings;
  /** Only these utilities (all when left out). */
  utilities?: UtilityId[];
}

/** Renders a floor into a detached SVG whose width/height are the real size in mm. Call dispose() after use. */
export function renderFloorSvg(project: Project, floor: Floor, opts: ExportOptions = {}) {
  const view = { ...DEFAULT_VIEW, ...project.settings.view, ...opts.view };
  const ghosts = ([['below', -1], ['above', 1]] as const).flatMap(([key, step]) => {
    const other = view[key] ? neighbourFloor(project.floors, floor, step) : undefined;
    return other ? [{ key, floor: other }] : [];
  });
  const b = boundsOf([floor, ...ghosts.map((g) => g.floor)].flatMap((f) => f.rooms.map(roomGeometry))) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const wanted = (u: UtilityId) => !opts.utilities || opts.utilities.includes(u);
  const x = b.minX - MARGIN_MM;
  const y = b.minY - MARGIN_MM;
  const width_mm = b.maxX - b.minX + 2 * MARGIN_MM;
  const legend = legendLayout(wallLegend(floor), b.maxX - b.minX);
  const height_mm = b.maxY - b.minY + 2 * MARGIN_MM + legend.rows * LEGEND_ROW_MM;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden';
  document.body.appendChild(host);
  const app = createApp({
    render: () =>
      h(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: `${x} ${y} ${width_mm} ${height_mm}`,
          width: `${width_mm}mm`,
          height: `${height_mm}mm`,
        },
        [
          h('rect', { x, y, width: width_mm, height: height_mm, fill: PLAN.paper }),
          h(PlanContent, {
            rooms: floor.rooms,
            openings: floor.openings,
            unit: project.settings.unit,
            interactive: false,
            // Exports show what the plan shows (the View menu).
            showDimensions: view.dimensions,
            showNames: view.names,
            showAngles: view.angles,
            showFurniture: view.furniture,
            showPins: view.notes,
            showFinishes: view.finishes,
            headroom: project.settings.headroom_mm,
          }),
          legend.rows ? legendNode(legend, x + MARGIN_MM, b.maxY + MARGIN_MM * 0.6) : null,
          ...ghosts.map((g) => h(GhostFloor, { rooms: g.floor.rooms, color: GHOST_COLOR[g.key], label: g.floor.name })),
          // The situatieschema: electrical points on the plan.
          view.installations && project.electrical
            ? h(ElectricalLayer, {
                points: project.electrical.points.filter((p) => p.floorId === floor.id),
                boards: project.electrical.boards.filter((b) => b.location?.floorId === floor.id),
                codes: circuitCodes(project.electrical),
                r: 110,
              })
            : null,
          view.utilities !== false && project.utilities
            ? h(UtilityLayer, {
                points: project.utilities.points.filter((p) => p.floorId === floor.id && wanted(p.utility)),
                runs: project.utilities.runs.filter((r) => r.floorId === floor.id && wanted(r.utility)),
                r: 110,
              })
            : null,
        ],
      ),
  });
  app.mount(host);
  const svg = host.querySelector('svg') as SVGSVGElement;
  return {
    svg,
    width_mm,
    height_mm,
    dispose() {
      app.unmount();
      host.remove();
    },
  };
}

export const safeName = (s: string) => s.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'plan';

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const svgText = (svg: SVGSVGElement) => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);

/** One SVG file per floor. */
export function exportSvg(project: Project, floors: Floor[], opts: ExportOptions = {}) {
  for (const floor of floors) {
    const r = renderFloorSvg(project, floor, opts);
    try {
      downloadBlob(new Blob([svgText(r.svg)], { type: 'image/svg+xml' }), `${safeName(project.name)}-${safeName(floor.name)}.svg`);
    } finally {
      r.dispose();
    }
  }
}

/** The drawing as a picture, `longSide` pixels on its longest side. */
async function rasterize(r: { svg: SVGSVGElement; width_mm: number; height_mm: number }, longSide: number, type: string): Promise<Blob> {
  const k = longSide / Math.max(r.width_mm, r.height_mm);
  const w = Math.max(1, Math.round(r.width_mm * k));
  const h = Math.max(1, Math.round(r.height_mm * k));
  const svg = r.svg.cloneNode(true) as SVGSVGElement;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([svgText(svg)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The drawing could not be turned into a picture.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be saved.'))), type, 0.92),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One PNG or JPG per floor. */
export async function exportImage(project: Project, floors: Floor[], format: 'png' | 'jpg', longSide: number, opts: ExportOptions = {}) {
  for (const floor of floors) {
    const r = renderFloorSvg(project, floor, opts);
    try {
      const blob = await rasterize(r, longSide, format === 'png' ? 'image/png' : 'image/jpeg');
      downloadBlob(blob, `${safeName(project.name)}-${safeName(floor.name)}.${format}`);
    } finally {
      r.dispose();
    }
  }
}

/** A small picture of what the export will look like, as an object URL (revoke it after use). */
export async function previewUrl(project: Project, floor: Floor, opts: ExportOptions = {}): Promise<string> {
  const r = renderFloorSvg(project, floor, opts);
  try {
    return URL.createObjectURL(await rasterize(r, 900, 'image/png'));
  } finally {
    r.dispose();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** The whole project as one JSON file, with photos and documents embedded. Returns how many files went in. */
export async function exportJson(project: Project, storage?: StorageAdapter): Promise<number> {
  const data = { ...JSON.parse(JSON.stringify(project)), updatedAt: new Date().toISOString() } as Project;
  const files: EmbeddedFiles = {};
  if (storage) {
    for (const a of data.attachments) {
      const id = fileIdOf(a.uri);
      const blob = id && (await storage.getFile(id));
      if (id && blob) files[id] = await blobToDataUrl(blob);
    }
  }
  downloadBlob(
    new Blob([serializeProject(data, files)], { type: 'application/json' }),
    `${safeName(project.name)}.floorplan.json`,
  );
  return Object.keys(files).length;
}

export type Paper = 'A4' | 'A3';
const PAPER: Record<Paper, [number, number]> = { A4: [297, 210], A3: [420, 297] };
export const STANDARD_SCALES = [20, 25, 50, 75, 100, 150, 200, 250, 500];
const UNIT_NAME = { m: 'metres', cm: 'centimetres', mm: 'millimetres' } as const;

/**
 * To-scale PDF, one page per floor, all at the same scale. With scale 'auto',
 * picks the largest standard scale at which every floor fits. Returns the scale used.
 */
export async function exportPdf(project: Project, floors: Floor[], paper: Paper, scale: number | 'auto', opts: ExportOptions = {}): Promise<number> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const margin = 10;
  const footer = 14;
  const sheets = floors.map((floor) => {
    const r = renderFloorSvg(project, floor, opts);
    const landscape = r.width_mm >= r.height_mm;
    const [pw, ph] = landscape ? PAPER[paper] : [PAPER[paper][1], PAPER[paper][0]];
    const availW = pw - 2 * margin;
    const availH = ph - 2 * margin - footer;
    return { floor, r, landscape, pw, ph, availW, availH, needed: Math.max(r.width_mm / availW, r.height_mm / availH) };
  });
  try {
    const needed = Math.max(...sheets.map((x) => x.needed));
    const fitting = STANDARD_SCALES.find((s) => s >= needed) ?? Math.ceil(needed / 100) * 100;
    let s: number;
    if (scale === 'auto') s = fitting;
    else if (scale < needed) {
      throw new Error(`The plan doesn't fit on ${paper} at 1:${scale}. Use 1:${fitting} or bigger paper.`);
    } else s = scale;

    const orient = (l: boolean) => (l ? 'landscape' : 'portrait');
    const doc = new jsPDF({ orientation: orient(sheets[0].landscape), unit: 'mm', format: paper.toLowerCase() });
    for (const [i, sheet] of sheets.entries()) {
      if (i > 0) doc.addPage(paper.toLowerCase(), orient(sheet.landscape));
      await pdfPage(doc, project, sheet, s, paper, margin, footer);
    }
    const name = floors.length === 1 ? safeName(floors[0].name) : 'all-floors';
    downloadBlob(doc.output('blob'), `${safeName(project.name)}-${name}-1to${s}.pdf`);
    return s;
  } finally {
    for (const sheet of sheets) sheet.r.dispose();
  }
}

async function pdfPage(
  doc: import('jspdf').jsPDF,
  project: Project,
  sheet: { floor: Floor; r: ReturnType<typeof renderFloorSvg>; pw: number; ph: number; availW: number; availH: number },
  s: number,
  paper: Paper,
  margin: number,
  footer: number,
) {
  const { floor, r, pw, ph, availW, availH } = sheet;
  {
    const w = r.width_mm / s;
    const h = r.height_mm / s;
    await doc.svg(r.svg, { x: margin + (availW - w) / 2, y: margin + (availH - h) / 2, width: w, height: h });

    // Footer: title, scale, and a scale bar you can check with a ruler.
    const fy = ph - margin;
    doc.setDrawColor(150, 150, 150);
    doc.line(margin, fy - footer + 2, pw - margin, fy - footer + 2);
    doc.setFontSize(10);
    doc.text(`${project.name} – ${floor.name}`, margin, fy - 6);
    doc.setFontSize(8);
    doc.text(
      `Scale 1:${s} on ${paper} · dimensions in ${UNIT_NAME[project.settings.unit]} · ${new Date().toLocaleDateString()}`,
      margin,
      fy - 1.5,
    );
    const barM = [0.5, 1, 2, 5, 10, 20, 50].find((m) => (m * 1000) / s >= 15) ?? 50;
    const barLen = (barM * 1000) / s;
    const bx = pw - margin - barLen;
    doc.setDrawColor(0, 0, 0);
    doc.setFillColor(0, 0, 0);
    doc.rect(bx, fy - 6, barLen / 2, 1.5, 'F');
    doc.rect(bx + barLen / 2, fy - 6, barLen / 2, 1.5, 'S');
    doc.text('0', bx, fy - 1.5, { align: 'center' });
    doc.text(`${barM} m`, bx + barLen, fy - 1.5, { align: 'center' });
  }
}

/** The single-line diagram in a detached SVG (pixels; 1 px = 0.25 mm on paper). Call dispose() after use. */
export function renderSchemaSvg(project: Project) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden';
  document.body.appendChild(host);
  const app = createApp({
    render: () =>
      h(EendraadschemaSvg, {
        electrical: project.electrical!,
        title: `${project.name} – eendraadschema`,
        roomName: roomNameFn(project),
      }),
  });
  app.mount(host);
  const svg = host.querySelector('svg') as SVGSVGElement;
  return {
    svg,
    width: Number(svg.getAttribute('width')),
    height: Number(svg.getAttribute('height')),
    dispose() {
      app.unmount();
      host.remove();
    },
  };
}

export function exportSchemaSvg(project: Project) {
  const r = renderSchemaSvg(project);
  try {
    const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(r.svg);
    downloadBlob(new Blob([text], { type: 'image/svg+xml' }), `${safeName(project.name)}-eendraadschema.svg`);
  } finally {
    r.dispose();
  }
}

/** The single-line diagram on A4 or A3 landscape, shrunk to fit. */
export async function exportSchemaPdf(project: Project, paper: Paper) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const r = renderSchemaSvg(project);
  try {
    const [pw, ph] = PAPER[paper];
    const margin = 10;
    const k = Math.min((pw - 2 * margin) / r.width, (ph - 2 * margin - 8) / r.height, 0.35);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: paper.toLowerCase() });
    await doc.svg(r.svg, { x: margin, y: margin, width: r.width * k, height: r.height * k });
    doc.setFontSize(8);
    doc.text(
      `${project.name} · eendraadschema · ${new Date().toLocaleDateString()} · made with Floor Plan, check it against the AREI`,
      margin,
      ph - margin,
    );
    downloadBlob(doc.output('blob'), `${safeName(project.name)}-eendraadschema.pdf`);
  } finally {
    r.dispose();
  }
}
