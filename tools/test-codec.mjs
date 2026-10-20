// Checks src/codec.js against Tile Markers' Lua codec.
// Usage: node tools/test-codec.mjs <lua binary> <tilemarkers repo>
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode, decode } from "../src/codec.js";

const [lua, repo] = process.argv.slice(2);
let failures = 0;
const check = (ok, message) => { if (!ok) { failures++; console.log("FAIL", message); } };

// Lua side: reads lines "E <json-ish>" / "D <token>" and answers one line each.
const LUA = `
package.path = "./?.lua;" .. package.path
local Codec = require("src/preset_codec")
local function dump(d)
  local out = {}
  for _, t in ipairs(d.tiles) do
    out[#out+1] = string.format("%d,%d,%d,%08X,%08X,%s,%s,%.1f,%s", t.level, t.x, t.z,
      t.outlineColour, t.fillColour, tostring(t.fill), tostring(t.outlineCornersOnly),
      t.outlineThickness, t.label or "")
  end
  table.sort(out)
  return d.name .. "|" .. table.concat(out, ";")
end
for line in io.lines() do
  local kind, rest = line:sub(1,1), line:sub(3)
  if kind == "D" then
    local d, err = Codec.decode(rest)
    print(d and dump(d) or ("ERR " .. err))
  else
    local f = load("return " .. rest)()
    print(Codec.encode(f.name, f.tiles) or "ERR")
  end
end
`;

function dumpJs(d) {
  const hex = (v) => (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
  const out = d.tiles.map((t) => [t.level, t.x, t.z, hex(t.outlineColour), hex(t.fillColour),
    t.fill === undefined ? "nil" : String(t.fill),
    t.outlineCornersOnly === undefined ? "nil" : String(t.outlineCornersOnly),
    t.outlineThickness.toFixed(1), t.label || ""].join(","));
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return d.name + "|" + out.join(";");
}

const luaString = (s) => '"' + [...new TextEncoder().encode(s)].map((b) => "\\" + b).join("") + '"';
function luaTable(name, tiles) {
  const t = tiles.map((x) => `{x=${x.x},z=${x.z},level=${x.level},outlineColour=${x.outlineColour},fillColour=${x.fillColour},` +
    `fill=${x.fill ?? "nil"},outlineCornersOnly=${x.outlineCornersOnly ?? "nil"},outlineThickness=${x.outlineThickness},label=${luaString(x.label || "")}}`);
  return `{name=${luaString(name)},tiles={${t.join(",")}}}`;
}

let seed = 12345;
const rand = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
const LABELS = ["", "", "surge", "surge here", "dive", "sürge ✓", "esc"];
const COLOURS = [0xc864ffff, 0xffffffff, 0x00ff88cc, 0xff0000ff];
const cases = [];
for (let c = 0; c < 60; c++) {
  const n = 1 + rand(c % 10 === 0 ? 400 : 30);
  const base = { x: rand(700), z: 1900 + rand(3700) };
  const seen = new Set(), tiles = [];
  while (tiles.length < n) {
    const t = { x: base.x + rand(40), z: base.z + rand(40), level: rand(5) === 0 ? rand(4) : 0 };
    const key = `${t.level}:${t.x}:${t.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const oc = COLOURS[rand(4)] >>> 0;
    tiles.push({ ...t, outlineColour: oc, fillColour: (oc & 0xffffff00 | 0x8c) >>> 0,
      fill: [undefined, true, false][rand(3)], outlineCornersOnly: [undefined, true, false][rand(3)],
      outlineThickness: [2, 1.5, 3.2][rand(3)], label: LABELS[rand(LABELS.length)] });
  }
  cases.push({ name: `Case ${c}`, tiles });
}

const input = ["D TM2IQZkZ2Z1cm4EsfTBCAopCgHIZP__oFDMjAwUAAAAAA"];
for (const c of cases) input.push("E " + luaTable(c.name, c.tiles));
const jsTokens = cases.map((c) => encode(c.name, c.tiles));
for (const t of jsTokens) input.push("D " + t);
// Run Lua with the script as a file argument and the cases on stdin.
const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "codec-"));
writeFileSync(join(dir, "harness.lua"), LUA);
const lines = execFileSync(lua, [join(dir, "harness.lua")], { cwd: repo, input: input.join("\n") + "\n", encoding: "utf8" }).trimEnd().split("\n");

// 1. The user's key decodes the same in both.
const furn = decode(input[0].slice(2));
check(dumpJs(furn) === lines[0], `dgfurn: js ${dumpJs(furn)} vs lua ${lines[0]}`);
console.log("dgfurn:", dumpJs(furn));

// 2. Lua-encoded tokens decode in JS, and JS tokens are byte-identical to Lua's.
cases.forEach((c, i) => {
  const luaToken = lines[1 + i];
  check(luaToken === jsTokens[i], `case ${i}: tokens differ`);
  const fromLua = dumpJs(decode(luaToken));
  const fromJs = lines[1 + cases.length + i];
  check(fromLua === fromJs, `case ${i}: JS decode of Lua token != Lua decode of JS token`);
  check(dumpJs(decode(jsTokens[i])) === fromJs, `case ${i}: round trip mismatch`);
});
console.log(failures === 0 ? `all ${cases.length} cases match` : `${failures} failures`);
process.exit(failures ? 1 : 0);
