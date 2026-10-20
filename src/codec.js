// Port of Tile Markers' src/preset_codec.lua (TM2 preset keys).
// Strings inside the codec are "byte strings" (one char per byte); labels and
// names are converted to and from UTF-8 at the edges.

const TOKEN_PREFIX = "TM2";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUES = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));
const MAX_TILES = 100000;
const MAX_NAME_BYTES = 128;
const MAX_LABEL_BYTES = 128;
const DICTIONARY_FLAG = 0x10;
const MORTON_COORDINATES_FLAG = 0x20;
const PREFIX_DICTIONARY_FLAG = 0x40;

// Tile Markers colours are 0xRRGGBBAA.
export const DEFAULT_OUTLINE = 0xFFFFFFFF;
export const DEFAULT_THICKNESS = 2.0;

export function derivedFill(outline) {
  const darken = (c) => Math.floor((c * 4 + 2) / 5);
  const r = darken((outline >>> 24) & 0xff);
  const g = darken((outline >>> 16) & 0xff);
  const b = darken((outline >>> 8) & 0xff);
  const a = Math.floor(((outline & 0xff) * 0x8c + 0x7f) / 0xff);
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

const toBytes = (text) => String.fromCharCode(...new TextEncoder().encode(text));
const fromBytes = (bytes) =>
  new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));

function base64Encode(src) {
  let out = "";
  for (let i = 0; i < src.length; i += 3) {
    const a = src.charCodeAt(i), b = src.charCodeAt(i + 1), c = src.charCodeAt(i + 2);
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < src.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < src.length) out += ALPHABET[n & 63];
  }
  return out;
}

function base64Decode(src) {
  if (src === "" || src.length % 4 === 1) throw new Error("This isn't a valid preset key.");
  let out = "";
  for (let i = 0; i < src.length; i += 4) {
    const available = Math.min(4, src.length - i);
    let n = 0;
    for (let k = 0; k < available; k++) {
      const v = VALUES[src[i + k]];
      if (v === undefined) throw new Error("The key contains characters a preset key can't have.");
      n |= v << (18 - k * 6);
    }
    out += String.fromCharCode((n >> 16) & 0xff);
    if (available >= 3) out += String.fromCharCode((n >> 8) & 0xff);
    if (available === 4) out += String.fromCharCode(n & 0xff);
  }
  return out;
}

function writeVaruint(parts, value) {
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    parts.push(String.fromCharCode(byte));
  } while (value !== 0);
}

function varuintLength(value) {
  let length = 1;
  while (value >= 128) { value = Math.floor(value / 128); length++; }
  return length;
}

const zigzagEncode = (v) => (v >= 0 ? v * 2 : -v * 2 - 1);
const zigzagDecode = (v) => (v % 2 === 0 ? v / 2 : -((v + 1) / 2));

function writeUInt32(parts, value) {
  value = value >>> 0;
  parts.push(String.fromCharCode((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff));
}

function mortonEncode(x, z) {
  let value = 0;
  for (let bit = 0; bit <= 13; bit++) {
    value |= (((z >> bit) & 1) << (bit * 2)) | (((x >> bit) & 1) << (bit * 2 + 1));
  }
  return value >>> 0;
}

function mortonDecode(value) {
  let x = 0, z = 0;
  for (let bit = 0; bit <= 13; bit++) {
    z |= ((value >>> (bit * 2)) & 1) << bit;
    x |= ((value >>> (bit * 2 + 1)) & 1) << bit;
  }
  return [x, z];
}

function sortTiles(tiles, morton) {
  tiles.sort((l, r) => {
    if (l.level !== r.level) return l.level - r.level;
    if (morton) {
      const lm = mortonEncode(l.x, l.z), rm = mortonEncode(r.x, r.z);
      if (lm !== rm) return lm - rm;
    } else if (l.x !== r.x) return l.x - r.x;
    return l.z - r.z;
  });
}

function writeCoordinateDelta(parts, dx, dz) {
  if (dx === 0 && dz >= 1 && dz <= 128) parts.push(String.fromCharCode(dz - 1));
  else if (dx === 1 && dz >= -32 && dz <= 31) parts.push(String.fromCharCode(0x80 + dz + 32));
  else {
    parts.push(String.fromCharCode(0xc0));
    writeVaruint(parts, dx);
    writeVaruint(parts, zigzagEncode(dz));
  }
}

function encodeCoordinates(tiles, levelCounts, morton) {
  const parts = [];
  let index = 0;
  for (let level = 0; level <= 3; level++) {
    const count = levelCounts[level];
    if (count === 0) continue;
    writeVaruint(parts, count);
    const first = tiles[index++];
    if (morton) {
      let previous = mortonEncode(first.x, first.z);
      writeVaruint(parts, previous);
      for (let k = 1; k < count; k++) {
        const t = tiles[index++];
        const m = mortonEncode(t.x, t.z);
        writeVaruint(parts, m - previous);
        previous = m;
      }
    } else {
      writeVaruint(parts, zigzagEncode(first.x));
      writeVaruint(parts, zigzagEncode(first.z));
      let px = first.x, pz = first.z;
      for (let k = 1; k < count; k++) {
        const t = tiles[index++];
        writeCoordinateDelta(parts, t.x - px, t.z - pz);
        px = t.x; pz = t.z;
      }
    }
  }
  return parts.join("");
}

function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length);
  let n = 0;
  while (n < limit && a.charCodeAt(n) === b.charCodeAt(n)) n++;
  return n;
}

// tiles: [{ x, z, level, outlineColour, fillColour, fill, outlineCornersOnly, outlineThickness, label }]
export function encode(name, tiles) {
  const nameBytes = toBytes(name);
  if (nameBytes.length > MAX_NAME_BYTES) throw new Error("The preset name is too long.");
  if (tiles.length > MAX_TILES) throw new Error("Too many tiles for one preset.");

  let ordered = tiles.map((t) => {
    const outlineColour = (t.outlineColour ?? DEFAULT_OUTLINE) >>> 0;
    const label = toBytes(t.label || "");
    if (label.length > MAX_LABEL_BYTES) throw new Error("A tile label is too long.");
    return {
      x: Math.floor(t.x), z: Math.floor(t.z), level: Math.floor(t.level || 0),
      outlineColour,
      fillColour: (t.fillColour ?? derivedFill(outlineColour)) >>> 0,
      fill: t.fill, outlineCornersOnly: t.outlineCornersOnly,
      outlineThickness: Math.max(0, Math.min(10, t.outlineThickness ?? DEFAULT_THICKNESS)),
      label,
    };
  });

  const canMorton = ordered.every((t) => t.x >= 0 && t.x <= 0x3fff && t.z >= 0 && t.z <= 0x3fff);
  const levelCounts = [0, 0, 0, 0];
  let levelMask = 0;
  for (const t of ordered) { levelCounts[t.level]++; levelMask |= 1 << t.level; }

  sortTiles(ordered, false);
  let coordinates = encodeCoordinates(ordered, levelCounts, false);
  let useMorton = false;
  if (canMorton && ordered.length > 0) {
    const mortonOrdered = ordered.slice();
    sortTiles(mortonOrdered, true);
    const mortonCoordinates = encodeCoordinates(mortonOrdered, levelCounts, true);
    if (mortonCoordinates.length < coordinates.length) {
      ordered = mortonOrdered; coordinates = mortonCoordinates; useMorton = true;
    }
  }

  const labels = [], insertionIndexes = new Map(), insertionDictionary = [];
  let rawLabelBytes = 0;
  for (const t of ordered) {
    if (t.label === "") continue;
    labels.push(t.label);
    rawLabelBytes += varuintLength(t.label.length) + t.label.length;
    if (!insertionIndexes.has(t.label)) {
      insertionIndexes.set(t.label, insertionDictionary.length);
      insertionDictionary.push(t.label);
    }
  }
  let dictionaryBytes = varuintLength(insertionDictionary.length);
  for (const l of insertionDictionary) dictionaryBytes += varuintLength(l.length) + l.length;
  for (const l of labels) dictionaryBytes += varuintLength(insertionIndexes.get(l));

  const prefixDictionary = insertionDictionary.slice().sort();
  const prefixIndexes = new Map();
  let prefixDictionaryBytes = varuintLength(prefixDictionary.length);
  let previous = "";
  prefixDictionary.forEach((l, i) => {
    prefixIndexes.set(l, i);
    const p = commonPrefixLength(previous, l), s = l.length - p;
    prefixDictionaryBytes += varuintLength(p) + varuintLength(s) + s;
    previous = l;
  });
  for (const l of labels) prefixDictionaryBytes += varuintLength(prefixIndexes.get(l));

  const useDictionary = labels.length > 0 && Math.min(dictionaryBytes, prefixDictionaryBytes) < rawLabelBytes;
  const usePrefix = useDictionary && prefixDictionaryBytes < dictionaryBytes;
  const dictionary = usePrefix ? prefixDictionary : insertionDictionary;
  const labelIndexes = usePrefix ? prefixIndexes : insertionIndexes;

  const styles = [], styleIndexes = new Map();
  for (const t of ordered) {
    const thickness = Math.floor(t.outlineThickness * 10 + 0.5);
    const flags = (t.fill == null ? 0x04 : t.fill ? 1 : 0) | (t.outlineCornersOnly == null ? 0x08 : t.outlineCornersOnly ? 2 : 0);
    const key = `${t.outlineColour}:${t.fillColour}:${flags}:${thickness}`;
    if (!styleIndexes.has(key)) {
      styleIndexes.set(key, styles.length);
      styles.push({ outlineColour: t.outlineColour, fillColour: t.fillColour, flags, thickness });
    }
    t.styleIndex = styleIndexes.get(key);
  }

  const flags = levelMask | (useDictionary ? DICTIONARY_FLAG : 0) | (useMorton ? MORTON_COORDINATES_FLAG : 0) | (usePrefix ? PREFIX_DICTIONARY_FLAG : 0);
  const parts = [String.fromCharCode(flags)];
  writeVaruint(parts, nameBytes.length);
  parts.push(nameBytes, coordinates);
  writeVaruint(parts, styles.length);
  for (const s of styles) {
    writeUInt32(parts, s.outlineColour);
    writeUInt32(parts, s.fillColour);
    parts.push(String.fromCharCode(s.flags, s.thickness));
  }
  for (const t of ordered) writeVaruint(parts, (t.styleIndex << 1) | (t.label !== "" ? 1 : 0));
  if (useDictionary) {
    writeVaruint(parts, dictionary.length);
    let prev = "";
    for (const l of dictionary) {
      if (usePrefix) {
        const p = commonPrefixLength(prev, l), suffix = l.slice(p);
        writeVaruint(parts, p); writeVaruint(parts, suffix.length); parts.push(suffix);
        prev = l;
      } else {
        writeVaruint(parts, l.length); parts.push(l);
      }
    }
    for (const l of labels) writeVaruint(parts, labelIndexes.get(l));
  } else {
    for (const l of labels) { writeVaruint(parts, l.length); parts.push(l); }
  }
  return TOKEN_PREFIX + base64Encode(parts.join(""));
}

export function decode(token) {
  token = (token || "").trim();
  if (!token.startsWith(TOKEN_PREFIX)) throw new Error("Preset keys start with TM2.");
  const src = base64Decode(token.slice(TOKEN_PREFIX.length));
  let pos = 0;
  const bad = (m = "This preset key is damaged or incomplete.") => { throw new Error(m); };
  const byte = () => (pos < src.length ? src.charCodeAt(pos++) : bad());
  const bytes = (n) => { if (n < 0 || pos + n > src.length) bad(); const v = src.slice(pos, pos + n); pos += n; return v; };
  const varuint = () => {
    let value = 0, mul = 1;
    for (let i = 0; i < 9; i++) {
      const b = byte();
      value += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return value;
      mul *= 128;
    }
    return bad();
  };
  const uint32 = () => ((byte() << 24) | (byte() << 16) | (byte() << 8) | byte()) >>> 0;

  const flags = byte();
  if (flags & 0x80 || (flags & PREFIX_DICTIONARY_FLAG && !(flags & DICTIONARY_FLAG))) bad();
  const levelMask = flags & 0x0f;
  const usesDictionary = !!(flags & DICTIONARY_FLAG);
  const usesMorton = !!(flags & MORTON_COORDINATES_FLAG);
  const usesPrefix = !!(flags & PREFIX_DICTIONARY_FLAG);
  const nameLength = varuint();
  if (nameLength > MAX_NAME_BYTES) bad();
  const name = fromBytes(bytes(nameLength));

  const tiles = [];
  for (let level = 0; level <= 3; level++) {
    if (!(levelMask & (1 << level))) continue;
    const count = varuint();
    if (count < 1 || tiles.length + count > MAX_TILES) bad();
    if (usesMorton) {
      let m = varuint();
      if (m > 0x0fffffff) bad();
      let [x, z] = mortonDecode(m);
      tiles.push({ x, z, level });
      for (let k = 1; k < count; k++) {
        const d = varuint();
        if (m + d > 0x0fffffff) bad();
        m += d;
        [x, z] = mortonDecode(m);
        tiles.push({ x, z, level });
      }
    } else {
      let x = zigzagDecode(varuint()), z = zigzagDecode(varuint());
      tiles.push({ x, z, level });
      for (let k = 1; k < count; k++) {
        const code = byte();
        let dx, dz;
        if (code < 0x80) { dx = 0; dz = code + 1; }
        else if (code < 0xc0) { dx = 1; dz = code - 0xa0; }
        else if (code === 0xc0) { dx = varuint(); dz = zigzagDecode(varuint()); }
        else bad();
        x += dx; z += dz;
        tiles.push({ x, z, level });
      }
    }
  }

  const styleCount = varuint();
  if (styleCount > tiles.length || (tiles.length > 0 && styleCount < 1)) bad();
  const styles = [];
  for (let i = 0; i < styleCount; i++) {
    const outlineColour = uint32(), fillColour = uint32(), sf = byte(), thickness = byte();
    if (sf & 0xf0 || (sf & 0x05) === 0x05 || (sf & 0x0a) === 0x0a || thickness > 100) bad();
    styles.push({
      outlineColour, fillColour,
      fill: sf & 0x04 ? undefined : !!(sf & 1),
      outlineCornersOnly: sf & 0x08 ? undefined : !!(sf & 2),
      outlineThickness: thickness / 10,
    });
  }
  const labelled = [];
  for (const t of tiles) {
    const meta = varuint();
    const s = styles[Math.floor(meta / 2)];
    if (!s) bad();
    Object.assign(t, s);
    if (meta & 1) labelled.push(t);
  }
  if (usesDictionary) {
    const n = varuint();
    if (n < 1 || n > labelled.length) bad();
    const dictionary = [];
    let prev = "";
    for (let i = 0; i < n; i++) {
      if (usesPrefix) {
        const p = varuint(), s = varuint();
        if (p > prev.length || p + s < 1 || p + s > MAX_LABEL_BYTES) bad();
        prev = prev.slice(0, p) + bytes(s);
        dictionary.push(prev);
      } else {
        const len = varuint();
        if (len < 1 || len > MAX_LABEL_BYTES) bad();
        dictionary.push(bytes(len));
      }
    }
    for (const t of labelled) {
      const i = varuint();
      if (i >= n) bad();
      t.label = fromBytes(dictionary[i]);
    }
  } else {
    for (const t of labelled) {
      const len = varuint();
      if (len < 1 || len > MAX_LABEL_BYTES) bad();
      t.label = fromBytes(bytes(len));
    }
  }
  if (pos < src.length) bad();
  return { name, tiles };
}
