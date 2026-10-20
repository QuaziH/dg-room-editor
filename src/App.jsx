import { encode, decode, derivedFill } from "./codec.js";
import {
  ROOM, tileKey, roomOrigin, isBlocked, targetRooms, findGroup, markersInRoom,
  countGroupMarkers, rotateCCW, straightPath, diveTargets,
} from "./rooms.js";

const { useState, useEffect, useMemo, useCallback, useRef } = React;

const STORAGE_KEY = "dg-room-markers-v1";
const SWATCHES = [
  { name: "Violet", rgba: 0xc864ffff },
  { name: "Ice", rgba: 0x4fd1ffff },
  { name: "Moss", rgba: 0x6be38aff },
  { name: "Gold", rgba: 0xffd24aff },
  { name: "Blood", rgba: 0xff5a5aff },
  { name: "Bone", rgba: 0xffffffff },
];
const ABILITIES = {
  surge: { name: "Surge", hint: "Straight ahead", defaultRange: 10 },
  escape: { name: "Escape", hint: "Straight back", defaultRange: 7 },
  dive: { name: "Dive", hint: "Any tile in range", defaultRange: 10 },
};
const DEFAULT_RANGES = Object.fromEntries(
  Object.entries(ABILITIES).map(([id, a]) => [id, a.defaultRange]));
// The one puzzle column whose puzzle differs per theme, so marks there stay in one theme.
const THEME_PUZZLE_COL = 11;
// Screen-relative facing: the arrow points the way your character faces on screen.
const FACINGS = [
  { id: "up-left", label: "↖", vec: [-1, 1] },
  { id: "up", label: "↑", vec: [0, 1] },
  { id: "up-right", label: "↗", vec: [1, 1] },
  { id: "left", label: "←", vec: [-1, 0] },
  null,
  { id: "right", label: "→", vec: [1, 0] },
  { id: "down-left", label: "↙", vec: [-1, -1] },
  { id: "down", label: "↓", vec: [0, -1] },
  { id: "down-right", label: "↘", vec: [1, -1] },
];

// Door tags: "[W] dive" shows only when the room was entered through the
// template's west door (Tile Markers (doors) build). Sides are template sides.
// Doorway buttons sit on the template's walls inside the rotating board, so
// they turn with the room and always name the same wall.
const DOORWAYS = [
  { side: "N", arrow: "↓" },
  { side: "E", arrow: "←" },
  { side: "S", arrow: "↑" },
  { side: "W", arrow: "→" },
];
function splitTag(label) {
  const m = /^\[([NESW]+)\]\s*(.*)$/.exec(label || "");
  return m ? { tag: m[1], text: m[2] } : { tag: "", text: label || "" };
}
const joinTag = (tag, text) => {
  const sorted = [..."NESW"].filter((c) => tag.includes(c)).join("");
  return sorted ? `[${sorted}]${text ? " " + text : ""}` : text;
};
const toMarker = (c, l) => (l ? { c, l } : { c });

const css = (rgba) => {
  const r = (rgba >>> 24) & 255, g = (rgba >>> 16) & 255, b = (rgba >>> 8) & 255;
  return `rgb(${r} ${g} ${b})`;
};

function loadMarkers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveMarkers(markers) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(markers)); } catch { /* storage off */ }
}

function Sprite({ theme, sprite, className }) {
  const col = sprite % theme.sheetCols;
  const row = Math.floor(sprite / theme.sheetCols);
  const rows = Math.ceil(theme.roomCount / theme.sheetCols);
  return (
    <div
      className={className}
      style={{
        backgroundImage: `url(${theme.sheet})`,
        backgroundSize: `${theme.sheetCols * 100}% ${rows * 100}%`,
        backgroundPosition: `${(col / (theme.sheetCols - 1)) * 100}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
      }}
    />
  );
}

function RoomCard({ theme, group, count, onOpen }) {
  return (
    <button className="card" onClick={onOpen} type="button">
      <Sprite theme={theme} sprite={group.variants[0].sprite} className="card-img" />
      <span className="card-name">{group.name}</span>
      <span className="card-meta">
        {group.variants.length} door {group.variants.length === 1 ? "variant" : "variants"}
        {count > 0 && <span className="pill">{count} marked</span>}
      </span>
    </button>
  );
}

function Board({ theme, group, variant, rotation, markers, ability, onTile, doorSide, setDoorSide }) {
  const { x: ox, z: oz } = roomOrigin(group.col, variant.row);
  const overlay = ability.overlay;
  const cells = [];
  for (let sy = 0; sy < ROOM; sy++) {
    for (let tx = 0; tx < ROOM; tx++) {
      const tz = ROOM - 1 - sy;
      const raw = markers[tileKey(ox + tx, oz + tz)];
      const parts = raw && splitTag(raw.l);
      // With a door picked, show what the plugin would show for that door.
      const hidden = raw && doorSide && parts.tag && !parts.tag.includes(doorSide);
      const m = raw && !hidden ? { c: raw.c, l: doorSide ? parts.text : raw.l } : null;
      const key = `${tx},${tz}`;
      const cls = ["tile"];
      if (overlay.path.has(key)) cls.push("t-path");
      if (overlay.reach.has(key)) cls.push("t-reach");
      if (overlay.end === key) cls.push("t-end");
      if (overlay.start === key) cls.push("t-start");
      if (isBlocked(variant, tx, tz)) cls.push("t-blocked");
      cells.push(
        <button
          key={key}
          type="button"
          className={cls.join(" ")}
          aria-label={`Tile ${tx}, ${tz}${m ? `, marked${m.l ? ` "${m.l}"` : ""}` : ""}`}
          onClick={() => onTile(tx, tz)}
          style={m ? { "--mk": css(m.c) } : undefined}
          data-marked={m ? "" : undefined}
        >
          {m && m.l && <span className="tile-label" style={{ transform: `rotate(${-rotation * 90}deg)` }}>{m.l}</span>}
        </button>
      );
    }
  }
  return (
    <div className="board-wrap">
      <div className="board" style={{ transform: `rotate(${rotation * 90}deg)` }}>
        <Sprite theme={theme} sprite={variant.sprite} className="board-img" />
        <div className="grid">{cells}</div>
        {DOORWAYS.map((d) => (
          <button key={d.side} type="button" className={`doorway doorway-${d.side}`}
            aria-pressed={doorSide === d.side} aria-label="Came in through this door"
            title={doorSide === d.side ? "Click again for any door" : "I came in through this door"}
            onClick={() => setDoorSide(doorSide === d.side ? null : d.side)}>{d.arrow}</button>
        ))}
      </div>
    </div>
  );
}

// "Furnished · Home (door variant 5)" for each room the tiles fall in.
function describePlaces(data, tiles) {
  const places = new Map();
  for (const t of tiles) {
    const col = Math.floor(t.x / ROOM), row = Math.floor(t.z / ROOM);
    for (const theme of data.themes) {
      for (const section of theme.sections) {
        for (const g of section.groups) {
          if (g.col !== col) continue;
          const i = g.variants.findIndex((v) => v.row === row);
          if (i < 0) continue;
          const name = `${theme.name} · ${g.name}${g.variants.length > 1 ? ` (door variant ${i + 1})` : ""}`;
          places.set(name, (places.get(name) || 0) + 1);
        }
      }
    }
  }
  return [...places.keys()].slice(0, 4).join(", ") + (places.size > 4 ? ` and ${places.size - 4} more rooms` : "");
}

function ExportPanel({ data, markers, themeIndex, group, sectionId, onImport, onClose }) {
  const [scope, setScope] = useState("theme");
  const [name, setName] = useState(`DG ${data.themes[themeIndex].name}`);
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  const tiles = useMemo(() => {
    const keep = new Set();
    const addGroup = (theme, g) => {
      for (const v of g.variants) {
        const { x, z } = roomOrigin(g.col, v.row);
        for (let tz = 0; tz < ROOM; tz++) for (let tx = 0; tx < ROOM; tx++) keep.add(tileKey(x + tx, z + tz));
      }
    };
    if (scope === "room" && group) {
      for (const theme of data.themes) {
        const g = findGroup(theme, sectionId, group.id);
        if (g) addGroup(theme, g);
      }
    }
    if (scope === "theme") {
      const theme = data.themes[themeIndex];
      for (const s of theme.sections) for (const g of s.groups) addGroup(theme, g);
    }
    return Object.entries(markers)
      .filter(([k]) => scope === "all" || keep.has(k))
      .map(([k, m]) => {
        const [x, z] = k.split(":").map(Number);
        return { x, z, level: 0, outlineColour: m.c, fillColour: derivedFill(m.c), label: m.l || "" };
      });
  }, [scope, markers, data, themeIndex, group, sectionId]);

  const key = useMemo(() => {
    try { return tiles.length ? encode(name || "DG markers", tiles) : ""; } catch { return ""; }
  }, [tiles, name]);

  const copy = (e) => {
    const area = e.currentTarget.parentElement.querySelector("textarea");
    navigator.clipboard?.writeText(key).then(() => setCopied(true), () => area.select());
    if (!navigator.clipboard) area.select();
    setTimeout(() => setCopied(false), 1600);
  };

  const runImport = () => {
    try {
      const preset = decode(importText);
      const added = onImport(preset.tiles);
      const where = describePlaces(data, preset.tiles);
      setMessage({ ok: true, text: `Loaded "${preset.name}": ${added} tiles${where ? ` in ${where}` : ""}.` });
      setImportText("");
    } catch (e) {
      setMessage({ ok: false, text: e.message });
    }
  };

  return (
    <div className="sheet" role="dialog" aria-label="Export and import">
      <div className="sheet-head">
        <h2>Export to Tile Markers</h2>
        <button type="button" className="ghost" onClick={onClose}>Close</button>
      </div>
      <div className="sheet-body">
        <section className="stack">
          <div className="seg" role="radiogroup" aria-label="What to export">
            {group && <button type="button" aria-pressed={scope === "room"} onClick={() => setScope("room")}>This room, all themes</button>}
            <button type="button" aria-pressed={scope === "theme"} onClick={() => setScope("theme")}>{data.themes[themeIndex].name}</button>
            <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>Everything</button>
          </div>
          <label className="field">
            <span>Preset name</span>
            <input id="preset-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="keybox">
            <textarea id="export-key" readOnly value={key || "Mark some tiles first."} rows={4} onFocus={(e) => e.target.select()} />
            <button type="button" className="primary" disabled={!key} onClick={copy}>{copied ? "Copied" : "Copy key"}</button>
          </div>
          <p className="note">{tiles.length} tiles. In game: Tile Markers → Presets → Import, then paste the key. Markers turn with the room automatically.</p>
        </section>
        <section className="stack">
          <h3>Load a key</h3>
          <textarea id="import-key" rows={3} placeholder="TM2…" value={importText} onChange={(e) => setImportText(e.target.value)} />
          <button type="button" onClick={runImport} disabled={!importText.trim()}>Load into editor</button>
          {message && <p className={message.ok ? "note ok" : "note err"}>{message.text}</p>}
        </section>
      </div>
    </div>
  );
}

function Editor({ data, themeIndex, sectionId, group, markers, setMarkers, onClose }) {
  const theme = data.themes[themeIndex];
  const [variantIndex, setVariantIndex] = useState(() => {
    const i = group.variants.findIndex((v) => markersInRoom(markers, group.col, v.row).length > 0);
    return i < 0 ? 0 : i;
  });
  const [rotation, setRotation] = useState(0);
  const [tool, setTool] = useState("mark");
  const [colour, setColour] = useState(SWATCHES[0].rgba);
  const [label, setLabel] = useState("");
  const [allVariants, setAllVariants] = useState(true);
  const [allThemes, setAllThemes] = useState(sectionId !== "puzzle" || group.col !== THEME_PUZZLE_COL);
  const [facing, setFacing] = useState("up");
  const [ranges, setRanges] = useState(DEFAULT_RANGES);
  const [stopAtBlocked, setStopAtBlocked] = useState(true);
  const [start, setStart] = useState(null);
  const [diveEnd, setDiveEnd] = useState(null);
  const [doorSide, setDoorSide] = useState(null); // template side letter, or null for every door

  const variant = group.variants[Math.min(variantIndex, group.variants.length - 1)];
  const isAbility = tool in ABILITIES;
  const facingVec = FACINGS.find((f) => f && f.id === facing).vec;

  useEffect(() => { setStart(null); setDiveEnd(null); }, [tool, variantIndex]);

  const result = useMemo(() => {
    if (!isAbility || !start) return null;
    if (tool === "dive") {
      return { reach: diveTargets(variant, start, ranges.dive, stopAtBlocked), path: [], end: diveEnd };
    }
    const dirScreen = tool === "escape" ? facingVec.map((v) => -v) : facingVec;
    const dir = rotateCCW(dirScreen, rotation);
    const path = straightPath(variant, start, dir, ranges[tool], stopAtBlocked);
    return { reach: [], path, end: path.length ? path[path.length - 1] : null };
  }, [isAbility, start, tool, variant, ranges, stopAtBlocked, facingVec, rotation, diveEnd]);

  const overlay = useMemo(() => ({
    start: start ? `${start.tx},${start.tz}` : null,
    end: result && result.end ? `${result.end.tx},${result.end.tz}` : null,
    path: new Set(result ? result.path.map((p) => `${p.tx},${p.tz}`) : []),
    reach: new Set(result ? result.reach.map((p) => `${p.tx},${p.tz}`) : []),
  }), [start, result]);

  const rooms = useMemo(
    () => targetRooms(data, themeIndex, sectionId, group.id, variantIndex, allVariants, allThemes),
    [data, themeIndex, sectionId, group.id, variantIndex, allVariants, allThemes]);

  // mode: "set", "erase" or "toggle". Tiles carry { tx, tz, c, text }; the
  // current door (if any) is added to or removed from the marker's door tag.
  const apply = useCallback((tiles, mode) => {
    setMarkers((prev) => {
      const next = { ...prev };
      for (const room of rooms) {
        const { x, z } = roomOrigin(room.col, room.row);
        for (const t of tiles) {
          const k = tileKey(x + t.tx, z + t.tz);
          const e = next[k];
          const ep = e && splitTag(e.l);
          const same = e && e.c === t.c && ep.text === (t.text || "");
          const removeDoor = () => {
            if (!doorSide || !ep.tag) { delete next[k]; return; }
            const tag = ep.tag.replace(doorSide, "");
            if (tag) next[k] = toMarker(e.c, joinTag(tag, ep.text));
            else delete next[k];
          };
          if (mode === "erase") { if (e) removeDoor(); continue; }
          if (mode === "toggle" && same && (!doorSide || ep.tag.includes(doorSide) || !ep.tag)) {
            removeDoor();
            continue;
          }
          const tag = doorSide ? (same && ep.tag ? ep.tag + doorSide : doorSide) : "";
          next[k] = toMarker(t.c, joinTag(tag, t.text || ""));
        }
      }
      return next;
    });
  }, [rooms, setMarkers, doorSide]);

  const onTile = (tx, tz) => {
    if (tool === "mark" || tool === "erase") {
      // Clicking a tile that already has this exact marker removes it.
      apply([{ tx, tz, c: colour, text: label.trim() }], tool === "erase" ? "erase" : "toggle");
      return;
    }
    if (tool === "dive" && start && overlay.reach.has(`${tx},${tz}`)) {
      setDiveEnd({ tx, tz });
      return;
    }
    setStart({ tx, tz });
    setDiveEnd(null);
  };

  const saveAbility = () => {
    if (!start || !result || !result.end) return;
    const name = ABILITIES[tool].name;
    apply([
      { ...start, c: colour, text: `${name} from` },
      { ...result.end, c: colour, text: `${name} to` },
    ], "set");
  };

  const clearRoom = () => {
    const tiles = [];
    for (let tz = 0; tz < ROOM; tz++) for (let tx = 0; tx < ROOM; tx++) tiles.push({ tx, tz });
    apply(tiles, "erase");
  };

  const marked = markersInRoom(markers, group.col, variant.row).length;
  const spreadMarks = () => {
    // Copies markers exactly as they are, door tags included.
    setMarkers((prev) => {
      const next = { ...prev };
      const source = markersInRoom(prev, group.col, variant.row);
      for (const room of rooms) {
        const { x, z } = roomOrigin(room.col, room.row);
        for (const m of source) next[tileKey(x + m.tx, z + m.tz)] = toMarker(m.c, m.l);
      }
      return next;
    });
  };

  return (
    <div className="editor">
      <header className="editor-head">
        <button type="button" className="ghost back" onClick={onClose}>← {theme.name}</button>
        <div className="editor-title">
          <h2>{group.name}</h2>
          <span className="coords">template col {group.col} · row {variant.row} · {marked} marked</span>
        </div>
      </header>

      <div className="editor-body">
        <div className="board-col">
          <Board theme={theme} group={group} variant={variant} rotation={rotation}
            markers={markers} ability={{ overlay }} onTile={onTile} doorSide={doorSide} setDoorSide={setDoorSide} />
          <div className="rotate-bar">
            <button type="button" onClick={() => setRotation((r) => (r + 3) % 4)} aria-label="Turn left">⟲</button>
            <span className="rot-readout">{rotation === 0 ? "As in the template" : `Turned ${rotation * 90}°`}</span>
            <button type="button" onClick={() => setRotation((r) => (r + 1) % 4)} aria-label="Turn right">⟳</button>
          </div>
          <p className="note center">Turn the room to match what you see in game. Saved markers aren't affected, and they show in every rotation.</p>
        </div>

        <aside className="tools">
          {group.variants.length > 1 && (
            <div className="panel">
              <h3>Door variants</h3>
              <div className="variants">
                {group.variants.map((v, i) => {
                  const n = markersInRoom(markers, group.col, v.row).length;
                  return (
                    <button key={v.row} type="button" className="variant" aria-pressed={i === variantIndex}
                      onClick={() => setVariantIndex(i)} aria-label={`Variant ${i + 1}${n ? `, ${n} marked` : ""}`}>
                      <Sprite theme={theme} sprite={v.sprite} className="variant-img" />
                      {n > 0 && <span className="variant-count">{n}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="panel">
            <h3>Came in through</h3>
            <button type="button" className="door-any" aria-pressed={doorSide === null} onClick={() => setDoorSide(null)}>Any door</button>
            <p className="note">
              {doorSide
                ? "New marks only show in game when you come in through the glowing door. Marks for other doors are hidden here. Click the door again to go back to any door."
                : "Marks show whichever door you come in through. To make marks for one door only, click the arrow in that doorway on the room."}
            </p>
          </div>

          <div className="panel">
            <div className="seg tools-seg">
              <button type="button" aria-pressed={tool === "mark"} onClick={() => setTool("mark")}>Mark</button>
              <button type="button" aria-pressed={tool === "erase"} onClick={() => setTool("erase")}>Erase</button>
              {Object.entries(ABILITIES).map(([id, a]) => (
                <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)}>{a.name}</button>
              ))}
            </div>

            {!isAbility && (
              <div className="stack">
                <div className="swatches" role="radiogroup" aria-label="Marker colour">
                  {SWATCHES.map((s) => (
                    <button key={s.name} type="button" className="swatch" aria-label={s.name}
                      aria-pressed={colour === s.rgba} style={{ "--sw": css(s.rgba) }} onClick={() => setColour(s.rgba)} />
                  ))}
                </div>
                <label className="field">
                  <span>Label (optional)</span>
                  <input id="marker-label" value={label} maxLength={24} placeholder="e.g. surge here" onChange={(e) => setLabel(e.target.value)} />
                </label>
              </div>
            )}

            {isAbility && (
              <div className="stack">
                {tool !== "dive" && (
                  <div className="facing">
                    <span>Facing</span>
                    <div className="compass">
                      {FACINGS.map((f, i) => f ? (
                        <button key={f.id} type="button" aria-pressed={facing === f.id} onClick={() => setFacing(f.id)} aria-label={`Facing ${f.id}`}>{f.label}</button>
                      ) : <span key={i} className="compass-you" aria-hidden="true">●</span>)}
                    </div>
                  </div>
                )}
                <label className="field inline">
                  <span>{ABILITIES[tool].name} range</span>
                  <input id={`range-${tool}`} type="number" min={1} max={20} value={ranges[tool]}
                    onChange={(e) => setRanges((r) => ({ ...r, [tool]: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))} />
                </label>
                <label className="check">
                  <input id="stop-blocked" type="checkbox" checked={stopAtBlocked} onChange={(e) => setStopAtBlocked(e.target.checked)} />
                  <span>Stop at blocked tiles</span>
                </label>
                <p className="note">
                  {!start ? "Click the tile you start on." :
                    tool === "dive" ? (diveEnd ? "Dive target set." : "Click a highlighted tile to dive to.") :
                    `${ABILITIES[tool].hint}: lands ${result && result.end ? `${result.path.length} tiles away` : "nowhere, it's blocked"}.`}
                  {" "}Thin walls drawn on the map aren't checked, only blocked tiles.
                </p>
                <button type="button" className="primary" disabled={!result || !result.end} onClick={saveAbility}>
                  Save as markers
                </button>
              </div>
            )}
          </div>

          <div className="panel stack">
            <h3>Apply marks to</h3>
            <label className="check">
              <input id="all-variants" type="checkbox" checked={allVariants} onChange={(e) => setAllVariants(e.target.checked)} />
              <span>Every door variant of this room</span>
            </label>
            <label className="check">
              <input id="all-themes" type="checkbox" checked={allThemes} onChange={(e) => setAllThemes(e.target.checked)} />
              <span>Every theme</span>
            </label>
            <p className="note">Marks go to {rooms.length} template {rooms.length === 1 ? "room" : "rooms"}.</p>
            <button type="button" disabled={marked === 0 || rooms.length < 2} onClick={spreadMarks}>
              Copy this room's {marked} marks to them
            </button>
            <button type="button" className="ghost danger" onClick={clearRoom}>Clear these rooms</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [themeIndex, setThemeIndex] = useState(2);
  const [open, setOpen] = useState(null); // { sectionId, groupId }
  const [markers, setMarkers] = useState(loadMarkers);
  const [showExport, setShowExport] = useState(false);
  const [query, setQuery] = useState("");
  const scrollRef = useRef(0);

  useEffect(() => {
    fetch("rooms.json").then((r) => r.json()).then(setData, () => setError("The room list didn't load. Refresh the page to try again."));
  }, []);
  useEffect(() => { saveMarkers(markers); }, [markers]);

  const total = Object.keys(markers).length;

  // Returns how many tiles were loaded; DG templates are all on level 0.
  const importTiles = (tiles) => {
    const usable = tiles.filter((t) => t.level === 0);
    setMarkers((prev) => {
      const next = { ...prev };
      for (const t of usable) {
        next[tileKey(t.x, t.z)] = t.label ? { c: t.outlineColour, l: t.label } : { c: t.outlineColour };
      }
      return next;
    });
    return usable.length;
  };

  if (error) return <main className="shell"><p className="note err">{error}</p></main>;
  if (!data) return <main className="shell"><p className="note">Loading rooms…</p></main>;

  const theme = data.themes[themeIndex];
  const openGroup = open && findGroup(theme, open.sectionId, open.groupId);
  const q = query.trim().toLowerCase();

  return (
    <div className={`app theme-${theme.id}`}>
      <header className="top">
        <div className="brand">
          <h1>DG Room Markers</h1>
          <span className="sub">Daemonheim templates for Tile Markers</span>
        </div>
        <button type="button" className="primary" onClick={() => setShowExport(true)}>
          Export / Import{total > 0 && <span className="count">{total}</span>}
        </button>
      </header>

      <nav className="themes" aria-label="Themes">
        {data.themes.map((t, i) => (
          <button key={t.id} type="button" className={`theme-tab tab-${t.id}`} aria-pressed={i === themeIndex}
            onClick={() => { setThemeIndex(i); }}>
            {t.name}
          </button>
        ))}
      </nav>

      <main className="shell">
        {openGroup ? (
          <Editor key={`${themeIndex}-${open.groupId}`} data={data} themeIndex={themeIndex} sectionId={open.sectionId}
            group={openGroup} markers={markers} setMarkers={setMarkers}
            onClose={() => { setOpen(null); requestAnimationFrame(() => window.scrollTo(0, scrollRef.current)); }} />
        ) : (
          <>
            <div className="filter">
              <input id="room-filter" type="search" placeholder="Find a room or puzzle" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {theme.sections.map((section) => {
              const groups = section.groups.filter((g) => !q || g.name.toLowerCase().includes(q));
              if (!groups.length) return null;
              return (
                <section key={section.id} className="section">
                  <h2>{section.name} <span className="muted">{groups.length}</span></h2>
                  <div className="cards">
                    {groups.map((g) => (
                      <RoomCard key={g.id} theme={theme} group={g} count={countGroupMarkers(markers, g)}
                        onOpen={() => { scrollRef.current = window.scrollY; setOpen({ sectionId: section.id, groupId: g.id }); window.scrollTo(0, 0); }} />
                    ))}
                  </div>
                </section>
              );
            })}
            <p className="note credit">Room pictures from mejrs' RuneScape map. Puzzle names from dg-utils.</p>
          </>
        )}
      </main>

      {showExport && (
        <ExportPanel data={data} markers={markers} themeIndex={themeIndex}
          group={openGroup} sectionId={open && open.sectionId}
          onImport={importTiles} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}
