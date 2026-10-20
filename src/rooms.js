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

// Every template room a mark should go to, given the copy options.
export function targetRooms(data, themeIndex, sectionId, groupId, variantIndex, allVariants, allThemes) {
  const rooms = [];
  const themes = allThemes ? data.themes.map((_, i) => i) : [themeIndex];
  for (const t of themes) {
    const group = findGroup(data.themes[t], sectionId, groupId);
    if (!group) continue;
    if (allVariants) {
      for (const v of group.variants) rooms.push({ col: group.col, row: v.row });
    } else {
      // The same door variant in another theme sits at the same position in its block.
      const v = group.variants[Math.min(variantIndex, group.variants.length - 1)];
      rooms.push({ col: group.col, row: v.row });
    }
  }
  return rooms;
}

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
