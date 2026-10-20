// Round-trips random marker sets through the DG Tile Markers key format.
import { encodeKey, decodeKey } from "../src/keys.js";

let failures = 0;
const sort = (list) => [...list].sort((a, b) => a.z - b.z || a.x - b.x);
for (let run = 0; run < 200; run++) {
  const seen = new Set(), markers = [];
  for (let n = Math.floor(Math.random() * 60); n > 0; n--) {
    const x = Math.floor(Math.random() * 700), z = Math.floor(Math.random() * 6000);
    if (seen.has(`${x}:${z}`)) continue;
    seen.add(`${x}:${z}`);
    markers.push({
      x, z, colour: [0x4a90ffff, 0xc864ffff, 0x00ff0080][n % 3],
      doors: ["", "N", "SW", "NESW"][n % 4], label: ["", "Surge from", "dive ✓"][n % 3],
    });
  }
  const back = decodeKey(encodeKey(markers));
  if (JSON.stringify(sort(back)) !== JSON.stringify(sort(markers))) {
    failures++;
    if (failures < 3) console.log("FAIL", JSON.stringify(markers).slice(0, 200));
  }
}
for (const bad of ["TM2abc", "DGM1!!", "DGM1AQ"]) {
  try { decodeKey(bad); failures++; console.log("FAIL accepted", bad); } catch { /* expected */ }
}
console.log(failures ? `${failures} failures` : "all key checks pass");
process.exit(failures ? 1 : 0);
