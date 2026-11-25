import { describe, expect, it } from 'vite-plus/test';
import { parseProject, parseProjectFile, serializeProject } from './migrate';
import { newOpening, newProject, newRoom, newStair, SCHEMA_VERSION } from './schema';

describe('project files', () => {
  it('gives back the same plan after export and import', () => {
    const p = newProject('Home');
    const room = newRoom('Kitchen', 115, { x: 10, y: 20 });
    room.walls[0].length_mm = 3456;
    room.diagonals.push({ id: 'd1', from: 0, to: 2, length_mm: 5000 });
    room.notes = 'Tiles 2019';
    p.floors[0].rooms.push(room);
    p.floors[0].openings.push(newOpening(room.id, 'door', 0), newOpening(room.id, 'window', 1));
    p.layers.push({ id: 'l1', kind: 'electrical', name: 'Power', items: [] });
    p.attachments.push({
      id: 'a1',
      kind: 'photo',
      name: 'Panel',
      tags: ['electrical'],
      linkedTo: [room.id],
      createdAt: p.createdAt,
    });

    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it('keeps furniture, the lock and embedded photos', () => {
    const p = newProject('Home');
    const room = newRoom('Bedroom');
    room.locked = true;
    room.height_mm = 2500;
    room.floorLevel_mm = -200;
    room.walls[1].height_mm = 2400;
    room.stairs = [newStair('stairs', 1000, 1000), newStair('ramp', 500, 500)];
    room.pins = [{ id: 'p1', x_mm: 100, y_mm: 200, title: 'Fuse box', text: 'Behind the door', createdAt: p.createdAt }];
    room.furniture = [
      { id: 'f1', name: 'Bed', kind: 'bed-double', shape: 'rect', x_mm: 2000, y_mm: 1500, width_mm: 1600, depth_mm: 2000, rotation_deg: 90 },
    ];
    p.floors[0].rooms.push(room);
    const files = { abc: 'data:image/png;base64,iVBORw0KGgo=' };
    const back = parseProjectFile(serializeProject(p, files));
    expect(back.project).toEqual(p);
    expect(back.files).toEqual(files);
    expect(parseProjectFile(serializeProject(p)).files).toEqual({});
  });

  it('rejects files that are not floor plans', () => {
    expect(() => parseProject('not json')).toThrow('not valid JSON');
    expect(() => parseProject('{"hello":1}')).toThrow('format version');
    expect(() => parseProject('{"format":"other","schemaVersion":1}')).toThrow('not a floor plan');
  });

  it('rejects files from a newer version', () => {
    expect(() => parseProject(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }))).toThrow('newer version');
  });

  it('fills in defaults for missing fields', () => {
    const p = parseProject(JSON.stringify({ schemaVersion: 1, floors: [{ rooms: [{ walls: [{ length_mm: 1000 }] }] }] }));
    expect(p.settings.unit).toBe('m');
    expect(p.floors[0].rooms[0].walls[0]).toMatchObject({ length_mm: 1000, angle_deg: 90, thickness_mm: 100 });
  });
});

describe('finishes, wall types and headroom', () => {
  it('loads old files without them unchanged', () => {
    const p = parseProject(
      JSON.stringify({ schemaVersion: 1, settings: { unit: 'cm' }, floors: [{ rooms: [{ id: 'r', walls: [{ length_mm: 1000 }] }] }] }),
    );
    const room = p.floors[0].rooms[0];
    expect(room.finish).toBeUndefined();
    expect(Object.keys(room.walls[0]).sort()).toEqual(['angle_deg', 'id', 'length_mm', 'thickness_mm']);
    expect(p.settings.headroom_mm).toBeUndefined();
    expect(p.settings.view?.finishes).toBe(false);
  });

  it('keeps them through export and import', () => {
    const p = newProject('Home');
    p.settings.headroom_mm = 1500;
    p.settings.view!.finishes = true;
    const room = newRoom('Bathroom');
    room.finish = { floor: 'tiles', walls: 'tiles to 1.2 m', ceiling: 'paint', skirting: false };
    Object.assign(room.walls[0], { kind: 'exterior', loadBearing: true, status: 'demolish' });
    room.walls[1].status = 'new';
    p.floors[0].rooms.push(room);
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it('drops values it does not know', () => {
    const p = parseProject(
      JSON.stringify({
        schemaVersion: 1,
        floors: [{ rooms: [{ finish: { floor: 3, skirting: 'no' }, walls: [{ length_mm: 1, kind: 'garden', status: 'gone' }] }] }],
      }),
    );
    expect(p.floors[0].rooms[0].finish).toEqual({});
    expect(p.floors[0].rooms[0].walls[0].kind).toBeUndefined();
    expect(p.floors[0].rooms[0].walls[0].status).toBeUndefined();
  });
});

describe('furniture height and elevation', () => {
  it('keeps them, and older plans get the usual height for the kind', async () => {
    const { FURNITURE_PRESETS, furnitureHeight, newFurniture } = await import('./furniture');
    const p = newProject('H');
    const room = newRoom('Kitchen');
    const cupboard = newFurniture(FURNITURE_PRESETS.find((x) => x.kind === 'wall-cabinet')!, { x: 0, y: 0 });
    const old = { ...newFurniture(FURNITURE_PRESETS.find((x) => x.kind === 'fridge')!, { x: 0, y: 0 }), height_mm: undefined };
    room.furniture = [cupboard, old];
    p.floors[0].rooms.push(room);
    const [c, f] = parseProject(serializeProject(p)).floors[0].rooms[0].furniture!;
    expect(c).toMatchObject({ height_mm: 700, elevation_mm: 1400 });
    expect(f.height_mm).toBeUndefined();
    expect(f.elevation_mm).toBeUndefined();
    expect(furnitureHeight(f)).toBe(1800);
    expect(furnitureHeight({ kind: 'unknown' })).toBe(700);
  });
});

describe('chimneys and columns', () => {
  it('are kept in the file', async () => {
    const { newFixed } = await import('./schema');
    const p = newProject('F');
    const room = newRoom('Living');
    room.fixed = [{ ...newFixed('chimney', 500, 300), height_mm: 3500 }, { ...newFixed('column', 2000, 1500), shape: 'round' }];
    p.floors[0].rooms.push(room);
    const fixed = parseProject(serializeProject(p)).floors[0].rooms[0].fixed!;
    expect(fixed[0]).toMatchObject({ kind: 'chimney', width_mm: 600, height_mm: 3500, x_mm: 500 });
    expect(fixed[1]).toMatchObject({ kind: 'column', shape: 'round' });
    expect(fixed[1].height_mm).toBeUndefined();
  });
});
