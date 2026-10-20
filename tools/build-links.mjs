// Finds rooms that are copies of each other and writes a family id and turn to
// every door variant in public/rooms.json, so marks made in one copy can be
// placed in all of them, and records which sides have a door. Run after
// build-data.cjs.
//
// Two rooms are copies when, after turning one by a quarter-turn multiple, the
// inside of the room (doors and outer walls ignored) has the same blocked tiles
// and, within a theme, looks the same. Across themes only the walls can be
// compared, so a room is linked to the same door variant in other themes.
// The map has no thin walls or objects, so copies can still differ in game;
// the editor lets the player separate those.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const { PNG } = createRequire(import.meta.url)("pngjs");
const ROOM = 16;
const INNER = [2, 13]; // tiles compared: the room minus its door ring
const MAX_BLOCKED_DIFF = 2;
const MAX_PIXEL_DIFF = Number(process.env.MAX_PIXEL_DIFF || 1.5); // mean per-channel pixel difference
// Columns whose rooms are only compared within their own group.
const OWN_GROUP_ONLY = new Set(["puzzle", "special"]);
const THEME_PUZZLE = "p11";

const file = process.argv[2] || "public/rooms.json";
const data = JSON.parse(readFileSync(file, "utf8"));
const report = process.argv.includes("--report");

// Tile (tx, tz) after turning the room clockwise k times; z points north.
const turn = (tx, tz, k) => {
  for (let i = 0; i < k; i++) [tx, tz] = [tz, ROOM - 1 - tx];
  return [tx, tz];
};

// Blocked tiles, and the room image as RGB in tile order: pixel (px, pz) with
// pz counted from the south edge, like tile z.
function roomTiles(theme, sheet, variant) {
  const blocked = [];
  for (let tz = 0; tz < ROOM; tz++) {
    const bits = parseInt(variant.blocked.slice(tz * 4, tz * 4 + 4), 16);
    for (let tx = 0; tx < ROOM; tx++) blocked.push((bits >> tx) & 1);
  }
  const size = data.roomPx;
  const col = variant.sprite % theme.sheetCols, row = Math.floor(variant.sprite / theme.sheetCols);
  const pixels = new Uint8Array(size * size * 3);
  for (let pz = 0; pz < size; pz++) {
    for (let px = 0; px < size; px++) {
      const i = ((row * size + size - 1 - pz) * sheet.width + col * size + px) * 4;
      pixels.set(sheet.data.subarray(i, i + 3), (pz * size + px) * 3);
    }
  }
  return { blocked, pixels };
}

const turnPixel = (px, pz, k) => {
  const last = data.roomPx - 1;
  for (let i = 0; i < k; i++) [px, pz] = [pz, last - px];
  return [px, pz];
};

function pixelDiff(a, b, k) {
  const size = data.roomPx, from = INNER[0] * size / ROOM, to = (INNER[1] + 1) * size / ROOM;
  let sum = 0, n = 0;
  for (let pz = from; pz < to; pz++) {
    for (let px = from; px < to; px++) {
      const [ux, uz] = turnPixel(px, pz, k);
      const i = (pz * size + px) * 3, j = (uz * size + ux) * 3;
      for (let c = 0; c < 3; c++) sum += Math.abs(a.pixels[i + c] - b.pixels[j + c]);
      n += 3;
    }
  }
  return sum / n;
}

// Smallest k with b ≈ a turned k times, comparing only the inside tiles.
function match(a, b, withColour) {
  for (let k = 0; k < 4; k++) {
    let blockedDiff = 0;
    for (let tz = INNER[0]; tz <= INNER[1]; tz++) {
      for (let tx = INNER[0]; tx <= INNER[1]; tx++) {
        const [ux, uz] = turn(tx, tz, k);
        blockedDiff += a.blocked[tz * ROOM + tx] !== b.blocked[uz * ROOM + ux];
      }
    }
    if (blockedDiff <= MAX_BLOCKED_DIFF && (!withColour || pixelDiff(a, b, k) <= MAX_PIXEL_DIFF)) {
      return k;
    }
  }
  return -1;
}

// Sides with a door. Every template room has its south door; the map draws the
// others as red marks two tiles wide in the middle of a wall (some puzzle rooms
// also have one-tile red marks that aren't doors).
function doorSides(pixels) {
  const size = data.roomPx, tile = size / ROOM, depth = size * 3 / 32;
  const red = (px, pz) => {
    const i = (pz * size + px) * 3;
    return pixels[i] > 150 && pixels[i + 1] < 90 && pixels[i + 2] < 90;
  };
  // How many positions along the wall's middle stretch have red within `depth` of the edge.
  const width = (along) => {
    let n = 0;
    for (let a = size * 3 / 8; a < size * 5 / 8; a++) {
      for (let d = 0; d < depth; d++) if (along(a, d)) { n++; break; }
    }
    return n;
  };
  const sides = {
    N: width((a, d) => red(a, size - 1 - d)),
    E: width((a, d) => red(size - 1 - d, a)),
    S: Infinity,
    W: width((a, d) => red(d, a)),
  };
  return Object.keys(sides).filter((side) => sides[side] >= tile * 1.5).join("");
}

const rooms = [];
data.themes.forEach((theme, t) => {
  const sheet = PNG.sync.read(readFileSync(new URL(`../public/${theme.sheet}`, import.meta.url)));
  for (const section of theme.sections) {
    for (const group of section.groups) {
      group.variants.forEach((variant, v) => {
        const tiles = roomTiles(theme, sheet, variant);
        variant.doors = doorSides(tiles.pixels);
        rooms.push({ t, section: section.id, group: group.id, name: group.name, v, variant,
          ...tiles });
      });
    }
  }
});

// Edges: b = a turned k times.
const edges = rooms.map(() => []);
const link = (i, j, k) => { edges[i].push([j, k]); edges[j].push([i, (4 - k) % 4]); };
for (let i = 0; i < rooms.length; i++) {
  const a = rooms[i];
  for (let j = i + 1; j < rooms.length; j++) {
    const b = rooms[j];
    if (a.section !== b.section) continue;
    if (a.t === b.t) {
      if (OWN_GROUP_ONLY.has(a.section) && a.group !== b.group) continue;
      const k = match(a, b, true);
      if (k >= 0) link(i, j, k);
    } else if (a.group === b.group && a.v === b.v && a.group !== THEME_PUZZLE) {
      const k = match(a, b, false);
      if (k === 0) link(i, j, 0);
    }
  }
}

// Families: connected rooms, each with its turn from the family's first room.
let families = 0;
const seen = new Array(rooms.length).fill(false);
for (let start = 0; start < rooms.length; start++) {
  if (seen[start]) continue;
  const family = families++;
  const queue = [[start, 0]];
  seen[start] = true;
  const members = [];
  while (queue.length) {
    const [i, k] = queue.shift();
    rooms[i].variant.family = family;
    rooms[i].variant.turn = k;
    members.push(rooms[i]);
    for (const [j, dk] of edges[i]) {
      if (!seen[j]) { seen[j] = true; queue.push([j, (k + dk) % 4]); }
    }
  }
  if (report && members.length > 1) {
    const names = [...new Set(members.map((m) => `${data.themes[m.t].name.slice(0, 2)}:${m.name}#${m.v + 1}${m.variant.turn ? "↻" + m.variant.turn : ""}`))];
    console.log(`family ${family} (${members.length}): ${names.join(" ")}`);
  }
}
writeFileSync(file, JSON.stringify(data));
console.log(`${rooms.length} rooms in ${families} families`);
