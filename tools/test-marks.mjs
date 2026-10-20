// Checks what a click does to a tile's marker, with and without a door picked,
// and that marks copied into every copy of a room count once.
import { readFileSync } from "node:fs";
import { markAfter, indexRooms, roomsByPos, copiesOf, countMarks, roomOrigin, turnTile, tileKey } from "../src/rooms.js";

let failures = 0;
const check = (actual, expected, what) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.log(`FAIL ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const RED = 1, BLUE = 2;
const red = { c: RED, text: "surge" };

check(markAfter(null, red, null, "toggle"), { c: RED, l: "surge" }, "click marks an empty tile");
check(markAfter({ c: RED, l: "surge" }, red, null, "toggle"), null, "clicking the same mark removes it");
check(markAfter({ c: RED, l: "surge" }, { c: BLUE, text: "surge" }, null, "toggle"), { c: BLUE, l: "surge" }, "another colour recolours");
check(markAfter(null, red, "W", "toggle"), { c: RED, l: "[W] surge" }, "door picked: mark is tagged");
check(markAfter({ c: RED, l: "[N] surge" }, red, "W", "toggle"), { c: RED, l: "[NW] surge" }, "same mark for another door adds the door");
check(markAfter({ c: RED, l: "[NW] surge" }, red, "W", "toggle"), { c: RED, l: "[N] surge" }, "clicking again takes only this door out");
check(markAfter({ c: RED, l: "[W] surge" }, red, "W", "toggle"), null, "last door out removes the mark");
check(markAfter({ c: RED, l: "[NW] surge" }, null, "N", "erase"), { c: RED, l: "[W] surge" }, "erase with a door keeps the others");
check(markAfter({ c: RED, l: "[NW] surge" }, null, null, "erase"), null, "erase with any door removes it");
check(markAfter({ c: RED, l: "surge" }, red, "W", "toggle"), null, "an any-door mark is removed (left as is on purpose)");
check(markAfter({ c: RED, l: "[NESW]" }, { c: RED, text: "Surge from" }, null, "set"), { c: RED, l: "[NESW] Surge from" }, "saving an ability keeps the tile's doors");
check(markAfter({ c: RED, l: "[N] surge" }, { c: BLUE, text: "dive" }, null, "toggle"), { c: BLUE, l: "[N] dive" }, "a new colour or label keeps the doors");
check(markAfter({ c: RED, l: "[N] surge" }, { c: BLUE, text: "dive" }, "W", "toggle"), { c: BLUE, l: "[NW] dive" }, "with a door picked it is added to the doors");

const data = JSON.parse(readFileSync(new URL("../public/rooms.json", import.meta.url)));
const families = indexRooms(data);
const byPos = roomsByPos(families);
const group = data.themes[0].sections.find((s) => s.id === "puzzle").groups.find((g) => g.name === "Fremennik");
const copies = copiesOf(families, [], 0, group.id, group.variants[0]);
const keys = copies.map((room) => {
  const { x, z } = roomOrigin(room.col, room.row);
  const [tx, tz] = turnTile(3, 12, room.delta);
  return tileKey(x + tx, z + tz);
});
check(countMarks(keys, byPos, []), 1, `one mark in ${keys.length} copies counts once`);
check(countMarks([...keys, tileKey(roomOrigin(group.col, group.variants[0].row).x + 4, roomOrigin(group.col, group.variants[0].row).z + 4)], byPos, []), 2, "a second tile counts");
check(countMarks(keys, byPos, ["4:" + group.id]), 2, "a separate copy's marks count on their own");

console.log(failures ? `${failures} failures` : "all mark checks pass");
process.exit(failures ? 1 : 0);
