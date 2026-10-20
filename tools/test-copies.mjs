// Checks that every room's copies line up: a tile turned into each copy has the
// same blocked state, and turning there and back returns the same tile.
import { readFileSync } from "node:fs";
import { indexRooms, copiesOf, turnTile, turnSides, ROOM } from "../src/rooms.js";

const data = JSON.parse(readFileSync(new URL("../public/rooms.json", import.meta.url)));
const families = indexRooms(data);
const blocked = new Map();
for (const theme of data.themes) for (const s of theme.sections) for (const g of s.groups)
  for (const v of g.variants) blocked.set(`${g.col}:${v.row}`, v.blocked);
const isBlocked = (col, row, tx, tz) =>
  (parseInt(blocked.get(`${col}:${row}`).slice(tz * 4, tz * 4 + 4), 16) >> tx) & 1;

let failures = 0, pairs = 0;
const fail = (msg) => { if (failures++ < 10) console.log("FAIL", msg); };
data.themes.forEach((theme, t) => {
  for (const s of theme.sections) for (const g of s.groups) for (const v of g.variants) {
    for (const copy of copiesOf(families, new Set(), t, g.id, v)) {
      pairs++;
      let diff = 0;
      for (let tz = 2; tz < ROOM - 2; tz++) for (let tx = 2; tx < ROOM - 2; tx++) {
        const [cx, cz] = turnTile(tx, tz, copy.delta);
        diff += isBlocked(g.col, v.row, tx, tz) !== isBlocked(copy.col, copy.row, cx, cz);
        const [bx, bz] = turnTile(cx, cz, (4 - copy.delta) % 4);
        if (bx !== tx || bz !== tz) fail(`round trip ${tx},${tz}`);
      }
      if (diff > 6) fail(`${theme.name} ${g.name} #${g.variants.indexOf(v) + 1} → col ${copy.col} row ${copy.row}: ${diff} tiles differ`);
    }
  }
});
if (turnSides("NW", 1) !== "EN" || turnSides("S", 3) !== "E") fail("door sides turn clockwise");
const sep = copiesOf(families, new Set(["4:p15"]), 4, "p15", data.themes[4].sections.find((s) => s.id === "puzzle").groups.find((g) => g.id === "p15").variants[0]);
if (sep.some((r) => r.t !== 4)) fail("separated Warped Lodestones only links Warped Lodestones");
const rest = copiesOf(families, new Set(["4:p15"]), 0, "p15", data.themes[0].sections.find((s) => s.id === "puzzle").groups.find((g) => g.id === "p15").variants[0]);
if (rest.some((r) => r.t === 4)) fail("other Lodestones skip the separated Warped copy");
console.log(failures ? `${failures} failures` : `all ${pairs} room pairs line up`);
process.exit(failures ? 1 : 0);
