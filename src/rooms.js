// Room catalogue helpers. Template coordinates: tile x = col * 16 + tx, z = row * 16 + tz,
// with tz = 0 on the room's south edge (images are drawn north-up).

export const ROOM = 16;

export const tileKey = (x, z) => `${x}:${z}`;

export function roomOrigin(col, row) {
  return { x: col * ROOM, z: row * ROOM };
}

export function isBlocked(variant, tx, tz) {
  if (!variant || tx < 0 || tz < 0 || tx >= ROOM || tz >= ROOM) return true;
  const bits = parseInt(variant.blocked.slice(tz * 4, tz * 4 + 4), 16);
  return ((bits >> tx) & 1) === 1;
}

// Every room in the catalogue with its copy family (see tools/build-links.mjs).
// A room is the family's first room turned clockwise `turn` times.
export function indexRooms(data) {
  const families = new Map();
  data.themes.forEach((theme, t) => {
    for (const section of theme.sections) {
      for (const group of section.groups) {
        group.variants.forEach((variant, v) => {
          const room = { t, groupId: group.id, v, col: group.col, row: variant.row, turn: variant.turn };
          if (!families.has(variant.family)) families.set(variant.family, []);
          families.get(variant.family).push(room);
        });
      }
    }
  });
  return families;
}

// Marks in one theme's copy of a room can be kept apart from the other copies.
export const separateKey = (themeIndex, groupId) => `${themeIndex}:${groupId}`;

// The rooms that share marks with this one: the copies in its family that are
// on the same side of a separation, each with the turn from this room to it.
export function copiesOf(families, separate, themeIndex, groupId, variant) {
  const own = separate.has(separateKey(themeIndex, groupId)) ? separateKey(themeIndex, groupId) : null;
  return families.get(variant.family)
    .filter((room) => {
      const key = separateKey(room.t, room.groupId);
      return own ? key === own : !separate.has(key);
    })
    .map((room) => ({ ...room, delta: (room.turn - variant.turn + 4) % 4 }));
}

// Tile and door side after turning the room clockwise k times.
export function turnTile(tx, tz, k) {
  for (let i = 0; i < k; i++) [tx, tz] = [tz, ROOM - 1 - tx];
  return [tx, tz];
}

export const turnSides = (sides, k) => [...sides].map((s) => "NESW"["NESW".indexOf(s) + k & 3]).join("");

export function findGroup(theme, sectionId, groupId) {
  const section = theme.sections.find((s) => s.id === sectionId);
  return section && section.groups.find((g) => g.id === groupId);
}

export function markersInRoom(markers, col, row) {
  const { x, z } = roomOrigin(col, row);
  const found = [];
  for (let tz = 0; tz < ROOM; tz++) {
    for (let tx = 0; tx < ROOM; tx++) {
      const m = markers[tileKey(x + tx, z + tz)];
      if (m) found.push({ tx, tz, ...m });
    }
  }
  return found;
}

export function countGroupMarkers(markers, group) {
  let count = 0;
  for (const v of group.variants) count += markersInRoom(markers, group.col, v.row).length;
  return count;
}

// Rotations: k quarter turns clockwise, as the board is drawn on screen.
// Template vectors use (x east, z north).
function rotateCW([x, z], k) {
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) [x, z] = [z, -x];
  return [x, z];
}

export function rotateCCW(v, k) {
  return rotateCW(v, 4 - (((k % 4) + 4) % 4));
}

// Tiles a straight-line ability passes through, stopping at the room edge and,
// optionally, before a blocked tile. Returns the path without the start tile.
export function straightPath(variant, start, dir, range, stopAtBlocked) {
  const path = [];
  let { tx, tz } = start;
  for (let i = 0; i < range; i++) {
    const nx = tx + dir[0], nz = tz + dir[1];
    if (nx < 0 || nz < 0 || nx >= ROOM || nz >= ROOM) break;
    if (stopAtBlocked && isBlocked(variant, nx, nz)) break;
    tx = nx; tz = nz;
    path.push({ tx, tz });
  }
  return path;
}

export function diveTargets(variant, start, range, stopAtBlocked) {
  const targets = [];
  for (let tz = 0; tz < ROOM; tz++) {
    for (let tx = 0; tx < ROOM; tx++) {
      const d = Math.max(Math.abs(tx - start.tx), Math.abs(tz - start.tz));
      if (d === 0 || d > range) continue;
      if (stopAtBlocked && isBlocked(variant, tx, tz)) continue;
      targets.push({ tx, tz });
    }
  }
  return targets;
}
