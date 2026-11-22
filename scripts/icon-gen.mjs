// Zero-dependency PNG / ICO / ICNS icon generator for AGY Quota Rings.
// Renders a crisp Material 3 rounded squircle badge with dual quota rings (5h Blue + Weekly Green).
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function blendPixel(buf, idx, r, g, b, a) {
  if (a <= 0) return;
  const srcA = clamp(a, 0, 1);
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  buf[idx] = Math.round((r * srcA + buf[idx] * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round((g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
  buf[idx + 2] = Math.round((b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function drawRing(rgba, size, cx, cy, radius, stroke, fraction, color, trackColor) {
  const halfStroke = stroke / 2;
  const aa = 1.15;
  const startAngle = -Math.PI / 2;
  const sweep = Math.PI * 2 * clamp(fraction, 0, 1);
  const endAngle = startAngle + sweep;
  const capStartX = cx + Math.cos(startAngle) * radius;
  const capStartY = cy + Math.sin(startAngle) * radius;
  const capEndX = cx + Math.cos(endAngle) * radius;
  const capEndY = cy + Math.sin(endAngle) * radius;

  const minX = Math.max(0, Math.floor(cx - radius - halfStroke - 3));
  const maxX = Math.min(size - 1, Math.ceil(cx + radius + halfStroke + 3));
  const minY = Math.max(0, Math.floor(cy - radius - halfStroke - 3));
  const maxY = Math.min(size - 1, Math.ceil(cy + radius + halfStroke + 3));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      const ringDist = Math.abs(dist - radius) - halfStroke;
      const trackAlpha = 1 - smoothstep(-aa * 0.5, aa * 0.5, ringDist);
      if (trackAlpha <= 0.001) continue;

      const idx = (y * size + x) * 4;
      blendPixel(rgba, idx, trackColor[0], trackColor[1], trackColor[2], trackColor[3] * trackAlpha);

      let ang = Math.atan2(dy, dx) - startAngle;
      while (ang < 0) ang += Math.PI * 2;
      while (ang >= Math.PI * 2) ang -= Math.PI * 2;

      let arcAlpha = 0;
      if (ang <= sweep) {
        arcAlpha = trackAlpha;
      } else {
        const dCap1 = Math.hypot(x + 0.5 - capStartX, y + 0.5 - capStartY) - halfStroke;
        const dCap2 = Math.hypot(x + 0.5 - capEndX, y + 0.5 - capEndY) - halfStroke;
        const dCap = Math.min(dCap1, dCap2);
        arcAlpha = 1 - smoothstep(-aa * 0.5, aa * 0.5, dCap);
      }
      if (arcAlpha > 0.001) {
        blendPixel(rgba, idx, color[0], color[1], color[2], arcAlpha);
      }
    }
  }
}

export function renderIconPng(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const pad = size * 0.085;
  const halfW = size / 2 - pad;
  const cornerR = size * 0.22;
  const aa = 1.25;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - size / 2;
      const py = y + 0.5 - size / 2;
      const d = sdRoundedBox(px, py, halfW, halfW, cornerR);
      const alpha = 1 - smoothstep(-aa * 0.5, aa * 0.5, d);
      if (alpha <= 0.001) continue;

      // Subtle vertical obsidian gradient (#1c202a -> #13161d)
      const t = clamp((y + 0.5) / size, 0, 1);
      const bgR = Math.round(30 - t * 11);
      const bgG = Math.round(35 - t * 13);
      const bgB = Math.round(47 - t * 18);
      const idx = (y * size + x) * 4;
      blendPixel(rgba, idx, bgR, bgG, bgB, alpha);

      // Subtle 1px inner border highlight
      const borderDist = Math.abs(d + size * 0.012) - size * 0.009;
      const borderAlpha = (1 - smoothstep(-aa * 0.5, aa * 0.5, borderDist)) * alpha * 0.16;
      if (borderAlpha > 0.001) {
        blendPixel(rgba, idx, 232, 234, 237, borderAlpha);
      }
    }
  }

  // Top larger 5h ring (Google Blue #8ab4f8, ~80%)
  drawRing(
    rgba,
    size,
    size * 0.5,
    size * 0.37,
    size * 0.185,
    Math.max(1.8, size * 0.056),
    0.82,
    [138, 180, 248],
    [232, 234, 237, 0.14]
  );

  // Bottom smaller weekly ring (Google Green #81c995, ~88%)
  drawRing(
    rgba,
    size,
    size * 0.5,
    size * 0.695,
    size * 0.125,
    Math.max(1.5, size * 0.046),
    0.88,
    [129, 201, 149],
    [232, 234, 237, 0.14]
  );

  return encodePngRgba(size, size, rgba);
}

export function buildIco(sizes = [16, 24, 32, 48, 64, 128, 256]) {
  const images = sizes.map((s) => ({ size: s, png: renderIconPng(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(images.length * 16);
  let offset = 6 + entries.length;
  images.forEach((img, i) => {
    const pos = i * 16;
    entries[pos] = img.size >= 256 ? 0 : img.size;
    entries[pos + 1] = img.size >= 256 ? 0 : img.size;
    entries[pos + 2] = 0;
    entries[pos + 3] = 0;
    entries.writeUInt16LE(1, pos + 4);
    entries.writeUInt16LE(32, pos + 6);
    entries.writeUInt32LE(img.png.length, pos + 8);
    entries.writeUInt32LE(offset, pos + 12);
    offset += img.png.length;
  });

  return Buffer.concat([header, entries, ...images.map((img) => img.png)]);
}

export function buildIcns() {
  const entries = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
  ];
  const chunks = [];
  for (const [type, size] of entries) {
    const png = renderIconPng(size);
    const hdr = Buffer.alloc(8);
    hdr.write(type, 0, 4, 'ascii');
    hdr.writeUInt32BE(8 + png.length, 4);
    chunks.push(hdr, png);
  }
  const body = Buffer.concat(chunks);
  const top = Buffer.alloc(8);
  top.write('icns', 0, 4, 'ascii');
  top.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([top, body]);
}
