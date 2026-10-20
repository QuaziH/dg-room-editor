// Room catalogue helpers. Template coordinates: tile x = col * 16 + tx, z = row * 16 + tz,
// with tz = 0 on the room's south edge (images are drawn north-up).

export const ROOM = 16;

export const tileKey = (x, z) => `${x}:${z}`;

export function roomOrigin(col, row) {
  return { x: col * ROOM, z: row * ROOM };
}

// Every room in the catalogue with its copy family (see tools/build-links.mjs).
// A room is the family's first room turned clockwise `turn` times.
export function indexRooms(data) {
  const families = new Map();
  data.themes.forEach((theme, t) => {
    for (const section of theme.sections) {
      for (const group of section.groups) {
        group.variants.forEach((variant, v) => {
          const room = { t, sectionId: section.id, groupId: group.id, groupName: group.name, v,
            sprite: variant.sprite, col: group.col, row: variant.row, turn: variant.turn };
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
  const own = separate.includes(separateKey(themeIndex, groupId)) ? separateKey(themeIndex, groupId) : null;
  return families.get(variant.family)
    .filter((room) => {
      const key = separateKey(room.t, room.groupId);
      return own ? key === own : !separate.includes(key);
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

// Door tags: "[W] dive" only shows in game when the room was entered through
// the template's west door (Tile Markers (doors) build).
export function splitTag(label) {
  const m = /^\[([NESW]+)\]\s*(.*)$/.exec(label || "");
  return m ? { tag: m[1], text: m[2] } : { tag: "", text: label || "" };
}

export function joinTag(tag, text) {
  const sorted = [..."NESW"].filter((c) => tag.includes(c)).join("");
  return sorted ? `[${sorted}]${text ? " " + text : ""}` : text;
}

export const toMarker = (c, l) => (l ? { c, l } : { c });

// A tile's marker after a click, or null for none. `mark` is { c, text },
// `side` the door being marked for (or null for any door), and `mode` one of
// "set", "toggle" (clicking the same marker again removes it) or "erase".
// With a door picked, removing only takes that door out of the marker's tag;
// placing adds the door to whatever doors the tile already had.
export function markAfter(existing, mark, side, mode) {
  const old = existing && splitTag(existing.l);
  const removeDoor = () => {
    if (!side || !old.tag) return null;
    const tag = old.tag.replace(side, "");
    return tag ? toMarker(existing.c, joinTag(tag, old.text)) : null;
  };
  if (mode === "erase") return existing ? removeDoor() : null;
  const same = existing && existing.c === mark.c && old.text === (mark.text || "");
  if (mode === "toggle" && same && (!side || !old.tag || old.tag.includes(side))) return removeDoor();
  // A new colour or label replaces the marker but keeps its doors.
  const tag = (old ? old.tag : "") + (side || "");
  return toMarker(mark.c, joinTag(tag, mark.text || ""));
}

export const roomsByPos = (families) =>
  new Map([...families.values()].flat().map((r) => [`${r.col}:${r.row}`, r]));

// How many marks the player made: a mark copied into every copy of a room
// counts once. `keys` are marker tile keys ("x:z").
export function countMarks(keys, byPos, separate) {
  const seen = new Set();
  for (const key of keys) {
    const [x, z] = key.split(":").map(Number);
    const room = byPos.get(`${Math.floor(x / ROOM)}:${Math.floor(z / ROOM)}`);
    if (!room) { seen.add(key); continue; }
    const [cx, cz] = turnTile(x % ROOM, z % ROOM, (4 - room.turn) % 4);
    const pool = separate.includes(separateKey(room.t, room.groupId)) ? separateKey(room.t, room.groupId) : "";
    seen.add(`${room.family}|${pool}|${cx},${cz}`);
  }
  return seen.size;
}

// Marks in one theme's door variants of a room, counted as above.
export function countGroupMarks(markers, group, byPos, separate) {
  const keys = [];
  for (const v of group.variants) {
    const { x, z } = roomOrigin(group.col, v.row);
    for (const m of markersInRoom(markers, group.col, v.row)) keys.push(tileKey(x + m.tx, z + m.tz));
  }
  return countMarks(keys, byPos, separate);
}

// Tiles a straight-line ability passes through, stopping at the room edge.
// Objects aren't known, so nothing inside the room stops it. Returns the path
// without the start tile.
export function straightPath(start, dir, range) {
  const path = [];
  let { tx, tz } = start;
  for (let i = 0; i < range; i++) {
    const nx = tx + dir[0], nz = tz + dir[1];
    if (nx < 0 || nz < 0 || nx >= ROOM || nz >= ROOM) break;
    tx = nx; tz = nz;
    path.push({ tx, tz });
  }
  return path;
}

// Tiles a dive can land on: anything in range inside the room.
export function diveTargets(start, range) {
  const targets = [];
  for (let tz = 0; tz < ROOM; tz++) {
    for (let tx = 0; tx < ROOM; tx++) {
      const d = Math.max(Math.abs(tx - start.tx), Math.abs(tz - start.tz));
      if (d === 0 || d > range) continue;
      targets.push({ tx, tz });
    }
  }
  return targets;
}
