// DG Tile Markers keys: "DGM1" followed by unpadded base64url bytes.
//
//   varint  style count, then per style:
//     u32     colour 0xRRGGBBAA, big-endian
//     u8      door bits (N=1, E=2, S=4, W=8; 0 = any door)
//     varint  label byte length, then the UTF-8 label
//   varint  marker count, then per marker, sorted by z then x:
//     varint  z step from the previous marker (the first is from 0)
//     varint  x (absolute when z stepped, else the step from the previous x)
//     varint  style index
//
// Coordinates are Dungeoneering template tiles on level 0.

const PREFIX = "DGM1";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const DOOR_BITS = { N: 1, E: 2, S: 4, W: 8 };

const doorBits = (sides) => [...sides].reduce((bits, side) => bits | DOOR_BITS[side], 0);
const doorSides = (bits) => "NESW".split("").filter((side) => bits & DOOR_BITS[side]).join("");

function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    const chars = Math.ceil(((Math.min(3, bytes.length - i)) * 8) / 6);
    for (let c = 0; c < chars; c++) out += ALPHABET[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

function fromBase64(text) {
  const bytes = [];
  let buffer = 0, bits = 0;
  for (const ch of text) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error("bad character");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return bytes;
}

function writeVarint(out, value) {
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 128;
    out.push(byte);
  } while (value > 0);
}

// markers: [{ x, z, colour, doors: "NW", label }]
export function encodeKey(markers) {
  const styles = new Map();
  const styleOf = (m) => {
    const id = `${m.colour}|${doorBits(m.doors || "")}|${m.label || ""}`;
    if (!styles.has(id)) styles.set(id, { index: styles.size, ...m });
    return styles.get(id).index;
  };
  const sorted = [...markers].sort((a, b) => a.z - b.z || a.x - b.x);
  const indexes = sorted.map(styleOf);

  const out = [];
  writeVarint(out, styles.size);
  for (const s of styles.values()) {
    out.push((s.colour >>> 24) & 255, (s.colour >>> 16) & 255, (s.colour >>> 8) & 255, s.colour & 255);
    out.push(doorBits(s.doors || ""));
    const label = new TextEncoder().encode(s.label || "");
    writeVarint(out, label.length);
    out.push(...label);
  }
  writeVarint(out, sorted.length);
  let x = 0, z = 0;
  sorted.forEach((m, i) => {
    writeVarint(out, m.z - z);
    writeVarint(out, m.z === z && i > 0 ? m.x - x : m.x);
    writeVarint(out, indexes[i]);
    x = m.x;
    z = m.z;
  });
  return PREFIX + toBase64(out);
}

export function decodeKey(key) {
  const text = key.trim();
  if (!text.startsWith(PREFIX)) throw new Error("not a DG Tile Markers key");
  const bytes = fromBase64(text.slice(PREFIX.length));
  let at = 0;
  const byte = () => {
    if (at >= bytes.length) throw new Error("key is cut short");
    return bytes[at++];
  };
  const varint = () => {
    let value = 0, scale = 1, b;
    do {
      b = byte();
      value += (b & 127) * scale;
      scale *= 128;
    } while (b & 128);
    return value;
  };

  const styles = [];
  for (let n = varint(); n > 0; n--) {
    const colour = ((byte() << 24) | (byte() << 16) | (byte() << 8) | byte()) >>> 0;
    const doors = doorSides(byte());
    const length = varint();
    const label = new TextDecoder().decode(new Uint8Array(Array.from({ length }, byte)));
    styles.push({ colour, doors, label });
  }
  const markers = [];
  let x = 0, z = 0;
  for (let n = varint(); n > 0; n--) {
    const dz = varint();
    const dx = varint();
    x = dz > 0 || markers.length === 0 ? dx : x + dx;
    z += dz;
    const style = styles[varint()];
    if (!style) throw new Error("bad style");
    markers.push({ x, z, ...style });
  }
  return markers;
}
