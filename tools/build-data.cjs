// Builds the room catalogue and one image sheet per theme from mejrs map tiles.
// Usage: node tools/build-data.cjs <mejrs dir with z3/ and nomove2/> <out dir>
//
// Template layout (one block per theme, same order everywhere):
//   normal rooms  rows T..T+4 (all columns) and T+8..T+12 (columns <= 12), T = 120 + 24*i
//   puzzle rooms  rows P..P+6, P = 264 + 8*i, one column per puzzle
//   home / boss   rows H..H+4, H = 312 + 8*i; column 7 is the home room
// Each column is one layout; the rows under it are its door variants.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const [mejrsDir, outDir] = process.argv.slice(2);
const ROOM_PX = 128; // zoom 3: 8px per tile
const SHEET_COLS = 24;

const THEMES = ["Frozen", "Abandoned", "Furnished", "Occult", "Warped"];
const THEME_PUZZLES = ["Icy tiles", "Seeker", "Brutes", "Books", "Portals"];
const PUZZLES = {
  4: "Monolith", 5: "Mining room", 6: "Lights", 7: "Ghosts", 8: "3-stat",
  9: "Emotes", 10: "Key maze", 12: "Runecraft tiles", 13: "Fremennik",
  14: "10-stat", 15: "Lodestones", 16: "Fish ferret", 17: "Grooves",
  18: "Agility maze", 19: "Levers", 20: "Barrels", 21: "Push / pull",
  22: "Hunter ferret", 23: "Robot", 24: "Riddle", 25: "Vines",
  26: "Herb sarcophagus", 27: "Mining bridge", 28: "Grapple", 29: "Pondskaters",
  30: "Unhappy ghost", 31: "Plank bridge", 32: "Statue bridge",
  33: "Return the flow", 34: "Coloured blocks", 35: "Winch", 36: "Mercenary",
  37: "Ramokee", 38: "Sliding tiles", 39: "Coloured ferrets", 40: "Books",
};

const cache = new Map();
function read(dir, x, y) {
  const key = `${dir}/${x}_${y}`;
  if (!cache.has(key)) {
    const file = path.join(mejrsDir, dir, `0_${x}_${y}.png`);
    cache.set(key, fs.existsSync(file) ? PNG.sync.read(fs.readFileSync(file)) : null);
  }
  return cache.get(key);
}

// Room image at zoom 3: each 256px image holds 2x2 rooms, north up.
function roomImage(col, row) {
  const img = read("z3", col >> 1, row >> 1);
  if (!img) return null;
  return { img, px: (col % 2) * ROOM_PX, py: (1 - (row % 2)) * ROOM_PX };
}

function isEmpty(r) {
  let lit = 0;
  for (let y = 4; y < ROOM_PX; y += 8) {
    for (let x = 4; x < ROOM_PX; x += 8) {
      const i = ((r.py + y) * r.img.width + r.px + x) * 4;
      if (r.img.data[i + 3] > 0 && r.img.data[i] + r.img.data[i + 1] + r.img.data[i + 2] > 30) lit++;
    }
  }
  return lit < 13;
}

// 16x16 blocked-tile mask from the nomove layer (zoom 2: 4px per tile, magenta = blocked).
// Row 0 of the mask is the room's south edge, matching tile z offsets.
function blockedMask(col, row) {
  const img = read("nomove2", col >> 2, row >> 2);
  let hex = "";
  for (let tz = 0; tz < 16; tz++) {
    let bits = 0;
    for (let tx = 0; tx < 16; tx++) {
      let blocked = 0;
      if (img) {
        const px = (col % 4) * 64 + tx * 4 + 2;
        const py = (3 - (row % 4)) * 64 + (15 - tz) * 4 + 2;
        const i = (py * img.width + px) * 4;
        const d = img.data;
        blocked = d[i + 3] > 128 && d[i] > 200 && d[i + 1] < 80 && d[i + 2] > 200 ? 1 : 0;
      }
      bits |= blocked << tx;
    }
    hex += bits.toString(16).padStart(4, "0");
  }
  return hex;
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function buildTheme(index) {
  const T = 120 + 24 * index, P = 264 + 8 * index, H = 312 + 8 * index;
  const sheetRooms = [];
  function group(id, name, col, rows) {
    const variants = [];
    for (const row of rows) {
      const r = roomImage(col, row);
      if (!r || isEmpty(r)) continue;
      variants.push({ row, sprite: sheetRooms.length, blocked: blockedMask(col, row) });
      sheetRooms.push(r);
    }
    return variants.length ? { id, name, col, variants } : null;
  }

  const normal = [];
  for (const col of range(4, 39)) {
    const g = group(`n${col}`, `Layout ${col}`, col, range(T, T + 4));
    if (g) normal.push(g);
  }
  for (const col of range(4, 12)) {
    const g = group(`m${col}`, `Layout ${col}b`, col, range(T + 8, T + 12));
    if (g) normal.push(g);
  }
  const puzzles = [];
  for (const col of range(4, 40)) {
    const name = col === 11 ? THEME_PUZZLES[index] : PUZZLES[col] || `Puzzle ${col}`;
    const g = group(`p${col}`, name, col, range(P, P + 6));
    if (g) puzzles.push(g);
  }
  const special = [];
  for (const col of [7, 4, 5, 6, 12, 13, 14, 15]) {
    const name = col === 7 ? "Home" : `Special ${col}`;
    const g = group(`h${col}`, name, col, range(H, H + 4));
    if (g) special.push(g);
  }

  const rows = Math.ceil(sheetRooms.length / SHEET_COLS);
  const sheet = new PNG({ width: SHEET_COLS * ROOM_PX, height: rows * ROOM_PX });
  sheetRooms.forEach((r, i) => {
    PNG.bitblt(r.img, sheet, r.px, r.py, ROOM_PX, ROOM_PX,
      (i % SHEET_COLS) * ROOM_PX, Math.floor(i / SHEET_COLS) * ROOM_PX);
  });
  const sheetName = `sheet-${THEMES[index].toLowerCase()}.png`;
  fs.writeFileSync(path.join(outDir, sheetName), PNG.sync.write(sheet, { deflateLevel: 9 }));

  return {
    id: THEMES[index].toLowerCase(),
    name: THEMES[index],
    sheet: sheetName,
    sheetCols: SHEET_COLS,
    roomCount: sheetRooms.length,
    sections: [
      { id: "special", name: "Home & special", groups: special },
      { id: "normal", name: "Rooms", groups: normal },
      { id: "puzzle", name: "Puzzles", groups: puzzles },
    ],
  };
}

fs.mkdirSync(outDir, { recursive: true });
const themes = THEMES.map((_, i) => buildTheme(i));
fs.writeFileSync(path.join(outDir, "rooms.json"), JSON.stringify({ roomPx: ROOM_PX, themes }));
for (const t of themes) {
  const size = fs.statSync(path.join(outDir, t.sheet)).size;
  console.log(t.name, t.roomCount, "rooms,", t.sections.map(s => `${s.name} ${s.groups.length}`).join(", "),
    `sheet ${(size / 1e6).toFixed(2)}MB`);
}
