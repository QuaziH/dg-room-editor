import { encode, decode, derivedFill } from "./codec.js";
import {
  ROOM, tileKey, roomOrigin, isBlocked, findGroup, markersInRoom, indexRooms, copiesOf,
  separateKey, turnTile, turnSides, splitTag, joinTag, toMarker, markAfter, roomsByPos,
  countMarks, countGroupMarks, rotateCCW, straightPath, diveTargets,
} from "./rooms.js";

const { useState, useEffect, useMemo, useCallback, useRef } = React;

const MAX_RECENT = 6;
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
// Copies known to differ in game in ways the map can't show.
const KNOWN_SEPARATE = ["4:p15"]; // Warped Lodestones: an extra wall
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

// "Corner", "Straight", ... from a variant's door sides.
function doorShape(doors) {
  if (!doors) return "Variant";
  if (doors.length === 2) return doors === "NS" || doors === "EW" ? "Straight" : "Corner";
  return ["Variant", "1 door", "", "T", "Cross"][doors.length];
}

// Doorway buttons sit on the template's walls inside the rotating board, so
// they turn with the room and always name the same wall.
const DOORWAYS = [
  { side: "N", arrow: "↓" },
  { side: "E", arrow: "←" },
  { side: "S", arrow: "↑" },
  { side: "W", arrow: "→" },
];

const css = (rgba) => {
  const r = (rgba >>> 24) & 255, g = (rgba >>> 16) & 255, b = (rgba >>> 8) & 255;
  return `rgb(${r} ${g} ${b})`;
};

// State kept in this browser between visits; falls back when storage is empty or off.
function useStored(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off */ }
  }, [key, value]);
  return [value, setValue];
}

const toHex = (rgba) => `#${((rgba >>> 8) & 0xffffff).toString(16).padStart(6, "0")}`;
const fromHex = (hex) => ((parseInt(hex.slice(1), 16) << 8) | 0xff) >>> 0;

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
        {count > 0 && <span className="pill">{count} {count === 1 ? "mark" : "marks"}</span>}
      </span>
    </button>
  );
}

function Board({ theme, group, variant, rotation, markers, overlay, onTile, onTileErase, doorSide, setDoorSide }) {
  const { x: ox, z: oz } = roomOrigin(group.col, variant.row);
  const cells = [];
  for (let sy = 0; sy < ROOM; sy++) {
    for (let tx = 0; tx < ROOM; tx++) {
      const tz = ROOM - 1 - sy;
      const raw = markers[tileKey(ox + tx, oz + tz)];
      const parts = raw && splitTag(raw.l);
      // With a door picked, marks for other doors fade: the tile is taken.
      const other = raw && doorSide && parts.tag && !parts.tag.includes(doorSide);
      const m = raw && { c: raw.c, l: other ? "" : doorSide ? parts.text : raw.l };
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
          aria-label={`Tile ${tx}, ${tz}${other ? ", marked for another door" : m ? `, marked${m.l ? ` "${m.l}"` : ""}` : ""}`}
          title={other ? "Marked for another door" : undefined}
          onClick={() => onTile(tx, tz)}
          onContextMenu={(e) => { e.preventDefault(); onTileErase(tx, tz); }}
          style={m ? { "--mk": css(m.c) } : undefined}
          data-marked={m ? "" : undefined}
          data-other={other ? "" : undefined}
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
        {DOORWAYS.filter((d) => !variant.doors || variant.doors.includes(d.side)).map((d) => (
          <button key={d.side} type="button" className={`doorway doorway-${d.side}`}
            aria-pressed={doorSide === d.side} data-dimmed={doorSide && doorSide !== d.side ? "" : undefined}
            aria-label="Came in through this door"
            title={doorSide === d.side ? "Click again for any door" : "I came in through this door"}
            onClick={() => setDoorSide(doorSide === d.side ? null : d.side)}>{d.arrow}</button>
        ))}
      </div>
    </div>
  );
}

const ICONS = {
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12l5 5L19 7",
  paste: "M9 4h6v3H9zM7 6H5v14h14V6h-2",
  close: "M6 6l12 12M18 6L6 18",
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>
  );
}

function ExportPanel({ markers, total, onImport, onClose }) {
  const [name, setName] = useState("DG markers");
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  const tiles = useMemo(() => Object.entries(markers).map(([k, m]) => {
    const [x, z] = k.split(":").map(Number);
    return { x, z, level: 0, outlineColour: m.c, fillColour: derivedFill(m.c), label: m.l || "" };
  }), [markers]);

  const key = useMemo(() => {
    try { return tiles.length ? encode(name || "DG markers", tiles) : ""; } catch { return ""; }
  }, [tiles, name]);

  const copy = () => navigator.clipboard.writeText(key).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  });

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const paste = () => navigator.clipboard.readText().then(setImportText, () => {});

  const load = () => {
    try {
      const added = onImport(decode(importText.trim()).tiles);
      setMessage({ ok: true, text: `Loaded ${added} ${added === 1 ? "mark" : "marks"}.` });
      setImportText("");
    } catch {
      setMessage({ ok: false, text: "That isn't a Tile Markers key." });
    }
  };

  return (
    <div className="backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head">
          <h2 id="dialog-title">Export / Import</h2>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="dialog-body">
          <section className="stack">
            <h3>Export</h3>
            <label className="field">
              <span>Preset name</span>
              <input id="preset-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="input-group">
              <input id="export-key" readOnly value={key} placeholder="Mark some tiles first" onFocus={(e) => e.target.select()} />
              <button type="button" disabled={!key} onClick={copy}
                aria-label={copied ? "Copied" : "Copy key"} title={copied ? "Copied" : "Copy key"}>
                <Icon name={copied ? "check" : "copy"} />
              </button>
            </div>
            <p className="note">All {total} {total === 1 ? "mark" : "marks"}. In game: Tile Markers → Presets → Import, and paste.</p>
          </section>
          <section className="stack">
            <h3>Import</h3>
            <div className="input-group">
              <input id="import-key" placeholder="Paste a TM2… key" value={importText}
                onChange={(e) => { setImportText(e.target.value); setMessage(null); }} />
              <button type="button" onClick={paste} aria-label="Paste" title="Paste"><Icon name="paste" /></button>
              <button type="button" className="group-action" onClick={load} disabled={!importText.trim()}>Load</button>
            </div>
            {message && <p className={message.ok ? "note ok" : "note err"}>{message.text}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

// Every theme's door variants of this room as a grid (themes down, variants
// across). Copies that share marks with the open room are lit; the rest keep
// their own marks. Copies elsewhere in the template are listed underneath.
function CopyGrid({ data, byPos, group, current, copies, onPick }) {
  const shared = new Set(copies.map((r) => `${r.col}:${r.row}`));
  const rows = data.themes.map((theme, t) => {
    const own = theme.sections.flatMap((s) => s.groups).find((g) => g.id === group.id);
    return { theme, t, variants: own ? own.variants : [] };
  });
  const columns = Math.max(...rows.map((r) => r.variants.length));
  const elsewhere = copies.filter((r) => r.groupId !== group.id);
  const cell = (theme, room, label) => {
    const key = `${room.col}:${room.row}`;
    const isCurrent = key === current;
    return (
      <button key={key} type="button" className="copy-thumb" onClick={() => onPick(room)}
        aria-current={isCurrent ? "true" : undefined} data-shared={shared.has(key) ? "" : undefined}
        title={`${label}${isCurrent ? " (open)" : shared.has(key) ? "" : " (own marks)"}`}>
        <Sprite theme={theme} sprite={room.sprite} className="copy-img" />
      </button>
    );
  };
  return (
    <div className="copy-grid" style={{ "--cols": columns }}>
      <span />
      {Array.from({ length: columns }, (_, v) => (
        // A column is named only when every theme has the same doors there.
        <span key={v} className="copy-col">
          {new Set(rows.map((r) => r.variants[v] && r.variants[v].doors)).size === 1 && group.variants[v]
            ? doorShape(group.variants[v].doors) : ""}
        </span>
      ))}
      {rows.map(({ theme, t, variants }) => (
        <div key={t} className={`copy-row theme-${theme.id}`}>
          <span className="copy-theme">{theme.name}</span>
          {Array.from({ length: columns }, (_, v) => {
            const room = variants[v] && byPos.get(`${group.col}:${variants[v].row}`);
            return room ? cell(theme, room, `${theme.name} ${group.name}, ${doorShape(variants[v].doors)}`) : <span key={v} />;
          })}
        </div>
      ))}
      {elsewhere.length > 0 && (
        <div className="copy-elsewhere">
          <span className="copy-theme">Also</span>
          <div className="copy-thumbs">
            {elsewhere.map((r) => cell(data.themes[r.t], r, `${data.themes[r.t].name} ${r.groupName}`))}
          </div>
        </div>
      )}
    </div>
  );
}

function Editor({ data, families, byPos, separate, setSeparate, themeIndex, group, initialVariant, markers, setMarkers, onJump, onClose }) {
  const theme = data.themes[themeIndex];
  const [variantIndex, setVariantIndex] = useState(() => {
    if (initialVariant != null) return initialVariant;
    const i = group.variants.findIndex((v) => markersInRoom(markers, group.col, v.row).length > 0);
    return i < 0 ? 0 : i;
  });
  // Quarter turns of the view, kept unbounded so the board always animates the
  // short way round; rotation is the same turn as 0-3.
  const [turns, setTurns] = useState(0);
  const rotation = ((turns % 4) + 4) % 4;
  const [tool, setTool] = useState("mark");
  const [colour, setColour] = useState(SWATCHES[0].rgba);
  const [recent, setRecent] = useStored("dg-room-recent-colours", []);
  const [label, setLabel] = useState("");
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
  useEffect(() => {
    if (doorSide && variant.doors && !variant.doors.includes(doorSide)) setDoorSide(null);
  }, [variant, doorSide]);

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
    () => copiesOf(families, separate, themeIndex, group.id, variant),
    [families, separate, themeIndex, group.id, variant]);
  const isSeparate = separate.includes(separateKey(themeIndex, group.id));
  const familySize = families.get(variant.family).length;

  // Applies a click to these tiles ({ tx, tz, c, text }) in every copy; see markAfter.
  const apply = useCallback((tiles, mode) => {
    setMarkers((prev) => {
      const next = { ...prev };
      for (const room of rooms) {
        const { x, z } = roomOrigin(room.col, room.row);
        // This room's door, turned to fit the copy.
        const side = doorSide && turnSides(doorSide, room.delta);
        for (const t of tiles) {
          const [tx, tz] = turnTile(t.tx, t.tz, room.delta);
          const k = tileKey(x + tx, z + tz);
          const marker = markAfter(next[k], t, side, mode);
          if (marker) next[k] = marker;
          else delete next[k];
        }
      }
      return next;
    });
  }, [rooms, setMarkers, doorSide]);

  const onTile = (tx, tz) => {
    if (tool === "mark") {
      // Clicking a tile that already has this exact marker removes it.
      const { x, z } = roomOrigin(group.col, variant.row);
      const placed = markAfter(markers[tileKey(x + tx, z + tz)], { c: colour, text: label.trim() }, doorSide, "toggle");
      apply([{ tx, tz, c: colour, text: label.trim() }], "toggle");
      if (placed && placed.c === colour && !SWATCHES.some((s) => s.rgba === colour)) {
        setRecent((prev) => [colour, ...prev.filter((c) => c !== colour)].slice(0, MAX_RECENT));
      }
      return;
    }
    if (tool === "dive" && start && overlay.reach.has(`${tx},${tz}`)) {
      setDiveEnd({ tx, tz });
      return;
    }
    setStart({ tx, tz });
    setDiveEnd(null);
  };

  const onTileErase = (tx, tz) => { if (tool === "mark") apply([{ tx, tz }], "erase"); };

  const saveAbility = () => {
    if (!start || !result || !result.end) return;
    const name = ABILITIES[tool].name;
    apply([
      { ...start, c: colour, text: `${name} from` },
      { ...result.end, c: colour, text: `${name} to` },
    ], "set");
  };

  // Clearing asks for a second click; with a door picked it only clears that door's marks.
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => setConfirmClear(false), [doorSide, variantIndex]);
  useEffect(() => {
    if (!confirmClear) return undefined;
    const timer = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmClear]);
  const clearable = markersInRoom(markers, group.col, variant.row)
    .filter((m) => !doorSide || splitTag(m.l).tag.includes(doorSide)).length;
  const clearRoom = () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    const tiles = [];
    for (let tz = 0; tz < ROOM; tz++) for (let tx = 0; tx < ROOM; tx++) tiles.push({ tx, tz });
    apply(tiles, "erase");
    setConfirmClear(false);
  };

  const separateName = `${theme.name} ${group.name}`;
  const makeSeparate = () => setSeparate((prev) => [...prev, separateKey(themeIndex, group.id)]);
  // Rejoins the other copies, taking their marks in place of this copy's own.
  const linkAgain = () => {
    const key = separateKey(themeIndex, group.id);
    const source = families.get(variant.family).find((r) => !separate.includes(separateKey(r.t, r.groupId)));
    setMarkers((prev) => {
      const next = { ...prev };
      for (const room of rooms) {
        const { x, z } = roomOrigin(room.col, room.row);
        for (const m of markersInRoom(prev, room.col, room.row)) delete next[tileKey(x + m.tx, z + m.tz)];
        if (!source) continue;
        const delta = (room.turn - source.turn + 4) % 4;
        for (const m of markersInRoom(prev, source.col, source.row)) {
          const [tx, tz] = turnTile(m.tx, m.tz, delta);
          const { tag, text } = splitTag(m.l);
          next[tileKey(x + tx, z + tz)] = toMarker(m.c, joinTag(turnSides(tag, delta), text));
        }
      }
      return next;
    });
    setSeparate((prev) => prev.filter((k) => k !== key));
  };

  return (
    <div className="editor">
      <header className="editor-head">
        <button type="button" className="back" onClick={onClose}>
          <span aria-hidden="true">‹</span> {theme.name} rooms
        </button>
        <h2 className="editor-title">{group.name}{isSeparate && <span className="tag">Separate</span>}</h2>
      </header>

      <div className="editor-body">
        <div className="board-col">
          <Board theme={theme} group={group} variant={variant} rotation={turns}
            markers={markers} overlay={overlay} onTile={onTile} onTileErase={onTileErase} doorSide={doorSide} setDoorSide={setDoorSide} />
          <div className="rotate-bar">
            <button type="button" onClick={() => setTurns((t) => t - 1)} aria-label="Turn left" title="Turn left">⟲</button>
            <button type="button" onClick={() => setTurns((t) => t + 1)} aria-label="Turn right" title="Turn right">⟳</button>
          </div>
        </div>

        <aside className="tools">
          <div className="panel stack">
            <h3 title="Marks go to every copy of this room.">
              {rooms.length > 1 ? `Shared with ${rooms.length - 1} ${rooms.length === 2 ? "copy" : "copies"}` : "No copies"}
            </h3>
            {(rooms.length > 1 || group.variants.length > 1) && (
              <CopyGrid data={data} byPos={byPos} group={group} current={`${group.col}:${variant.row}`} copies={rooms}
                onPick={(r) => (r.t === themeIndex && r.groupId === group.id ? setVariantIndex(r.v) : onJump(r))} />
            )}
            {familySize > 1 && (isSeparate ? (
              <button type="button" onClick={linkAgain}
                title="Rejoin the other copies. This copy takes their marks in place of its own.">Link again</button>
            ) : (
              <button type="button" onClick={makeSeparate}
                title="Only if the game shows this copy is different, like an extra wall.">Make {separateName} separate</button>
            ))}
            {clearable > 0 && (
              <button type="button" className={confirmClear ? "danger-solid" : "ghost danger"} onClick={clearRoom}>
                {confirmClear
                  ? `Click again to remove ${clearable} ${clearable === 1 ? "mark" : "marks"}`
                  : doorSide ? "Clear this door's marks" : "Clear this room"}
              </button>
            )}
          </div>
          <div className="panel">
            <div className="seg tools-seg">
              <button type="button" aria-pressed={tool === "mark"} onClick={() => setTool("mark")}
                title="Click a tile to mark it. Click again or right-click to remove.">Mark</button>
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
                  <label className="swatch swatch-wheel" title="Pick any colour"
                    aria-pressed={!SWATCHES.some((s) => s.rgba === colour)}
                    style={SWATCHES.some((s) => s.rgba === colour) ? undefined : { "--sw": css(colour) }}>
                    <input type="color" aria-label="Pick any colour" value={toHex(colour)}
                      onChange={(e) => setColour(fromHex(e.target.value))} />
                  </label>
                </div>
                {recent.length > 0 && (
                  <div className="recent">
                    <span className="recent-title">Recent</span>
                    {recent.map((c) => (
                      <button key={c} type="button" className="swatch small" aria-label={`Recent colour ${toHex(c)}`}
                        aria-pressed={colour === c} style={{ "--sw": css(c) }} onClick={() => setColour(c)} />
                    ))}
                  </div>
                )}
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
                <label className="check" title="Uses blocked tiles from the map. Thin walls drawn as lines aren't known.">
                  <input id="stop-blocked" type="checkbox" checked={stopAtBlocked} onChange={(e) => setStopAtBlocked(e.target.checked)} />
                  <span>Stop at blocked tiles</span>
                </label>
                <p className="note">
                  {!start ? "Click the tile you start on." :
                    tool === "dive" ? (diveEnd ? "Dive target set." : "Click a highlighted tile to dive to.") :
                    `${ABILITIES[tool].hint}: lands ${result && result.end ? `${result.path.length} tiles away` : "nowhere, it's blocked"}.`}
                </p>
                <button type="button" className="primary" disabled={!result || !result.end} onClick={saveAbility}>
                  Save as markers
                </button>
              </div>
            )}
          </div>

        </aside>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [themeIndex, setThemeIndex] = useStored("dg-room-theme", 0);
  const [open, setOpen] = useState(null); // { sectionId, groupId, variant? }
  const [markers, setMarkers] = useStored("dg-room-markers-v1", {});
  const [separate, setSeparate] = useStored("dg-room-separate", KNOWN_SEPARATE);
  const [collapsed, setCollapsed] = useStored("dg-room-collapsed", []);
  const toggleSection = (id) =>
    setCollapsed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const families = useMemo(() => data && indexRooms(data), [data]);
  const byPos = useMemo(() => families && roomsByPos(families), [families]);
  const [showExport, setShowExport] = useState(false);
  const [query, setQuery] = useState("");
  const scrollRef = useRef(0);

  useEffect(() => {
    if (data && !data.themes[themeIndex]) setThemeIndex(0);
  }, [data, themeIndex]);
  const closeExport = useCallback(() => setShowExport(false), []);
  useEffect(() => {
    fetch("rooms.json").then((r) => r.json()).then(setData, () => setError("The room list didn't load. Refresh the page to try again."));
  }, []);

  const total = byPos ? countMarks(Object.keys(markers), byPos, separate) : 0;

  // Returns how many tiles were loaded; DG templates are all on level 0.
  const importTiles = (tiles) => {
    const usable = tiles.filter((t) => t.level === 0);
    setMarkers((prev) => {
      const next = { ...prev };
      for (const t of usable) {
        next[tileKey(t.x, t.z)] = toMarker(t.outlineColour, t.label);
      }
      return next;
    });
    return usable.length;
  };

  if (error) return <main className="shell"><p className="note err">{error}</p></main>;
  if (!data) return <main className="shell"><p className="note">Loading rooms…</p></main>;

  if (!data.themes[themeIndex]) return null;
  const theme = data.themes[themeIndex];
  const openGroup = open && findGroup(theme, open.sectionId, open.groupId);
  const q = query.trim().toLowerCase();

  return (
    <div className={`app theme-${theme.id}`}>
      <nav className="themes" aria-label="Themes">
        <h1 className="brand">DG Room Markers</h1>
        {data.themes.map((t, i) => (
          <button key={t.id} type="button" className="theme-tab" aria-pressed={i === themeIndex}
            onClick={() => setThemeIndex(i)}>
            {t.name}
          </button>
        ))}
      </nav>

      <main className="shell">
        {openGroup ? (
          <Editor key={`${themeIndex}-${open.groupId}`} data={data} families={families} byPos={byPos}
            separate={separate} setSeparate={setSeparate} themeIndex={themeIndex}
            group={openGroup} initialVariant={open.variant} markers={markers} setMarkers={setMarkers}
            onJump={(r) => { setThemeIndex(r.t); setOpen({ sectionId: r.sectionId, groupId: r.groupId, variant: r.v }); }}
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
                  <h2>
                    {/* Searching shows every match, collapsed or not. */}
                    <button type="button" className="section-toggle" aria-expanded={!!q || !collapsed.includes(section.id)}
                      onClick={() => toggleSection(section.id)}>
                      <span className="chevron" aria-hidden="true">▾</span>
                      {section.name} <span className="muted">{groups.length}</span>
                    </button>
                  </h2>
                  {(q || !collapsed.includes(section.id)) && (
                    <div className="cards">
                      {groups.map((g) => (
                        <RoomCard key={g.id} theme={theme} group={g} count={countGroupMarks(markers, g, byPos, separate)}
                          onOpen={() => { scrollRef.current = window.scrollY; setOpen({ sectionId: section.id, groupId: g.id }); window.scrollTo(0, 0); }} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>

      <footer className="bottom-bar">
        <span className="mark-total">{total} {total === 1 ? "mark" : "marks"}</span>
        <button type="button" className="primary" onClick={() => setShowExport(true)}>Export / Import</button>
      </footer>

      {showExport && (
        <ExportPanel markers={markers} total={total} onImport={importTiles} onClose={closeExport} />
      )}
    </div>
  );
}
