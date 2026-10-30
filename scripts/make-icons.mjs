/**
 * 生成扩展图标。纯 Node 实现：手工绘制像素 + 手写 PNG 编码，
 * 不依赖任何图形库，避免引入二进制资源或额外依赖。
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER = 512;
const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));

/** 蓝白配色：#3b82f6 -> #1d4ed8，中间留白的饼干形状 */
const BG_FROM = [59, 130, 246];
const BG_TO = [29, 78, 216];
const RADIUS = 112;
const COOKIE_RADIUS = 150;

const HOLES = [
  { x: 205, y: 200, r: 27 },
  { x: 312, y: 218, r: 20 },
  { x: 300, y: 306, r: 26 },
  { x: 210, y: 314, r: 18 },
];

const lerp = (a, b, t) => a + (b - a) * t;

function renderBase(detailed) {
  const buffer = new Float32Array(RENDER * RENDER * 4);
  const center = RENDER / 2;
  const limit = center - RADIUS;

  for (let y = 0; y < RENDER; y += 1) {
    for (let x = 0; x < RENDER; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const index = (y * RENDER + x) * 4;

      // 圆角矩形之外保持透明
      const dx = Math.max(Math.abs(px - center) - limit, 0);
      const dy = Math.max(Math.abs(py - center) - limit, 0);
      if (dx * dx + dy * dy > RADIUS * RADIUS) {
        buffer[index + 3] = 0;
        continue;
      }

      const t = (px + py) / (2 * RENDER);
      buffer[index] = lerp(BG_FROM[0], BG_TO[0], t);
      buffer[index + 1] = lerp(BG_FROM[1], BG_TO[1], t);
      buffer[index + 2] = lerp(BG_FROM[2], BG_TO[2], t);
      buffer[index + 3] = 255;

      const dist = (px - center) ** 2 + (py - center) ** 2;
      if (dist > COOKIE_RADIUS * COOKIE_RADIUS) continue;

      let isHole = false;
      if (detailed) {
        for (const hole of HOLES) {
          if ((px - hole.x) ** 2 + (py - hole.y) ** 2 <= hole.r * hole.r) {
            isHole = true;
            break;
          }
        }
      }
      if (!isHole) {
        buffer[index] = 255;
        buffer[index + 1] = 255;
        buffer[index + 2] = 255;
      }
    }
  }
  return buffer;
}

function downscale(source, size) {
  const scale = RENDER / size;
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(RENDER, Math.ceil((x + 1) * scale));
      const y0 = Math.floor(y * scale);
      const y1 = Math.min(RENDER, Math.ceil((y + 1) * scale));

      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;

      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const si = (sy * RENDER + sx) * 4;
          const a = source[si + 3] / 255;
          red += source[si] * a;
          green += source[si + 1] * a;
          blue += source[si + 2] * a;
          alpha += source[si + 3];
          count += 1;
        }
      }

      const target = (y * size + x) * 4;
      const alphaAvg = alpha / count;
      out[target + 3] = Math.round(alphaAvg);
      if (alpha > 0) {
        out[target] = Math.round(red / (alpha / 255));
        out[target + 1] = Math.round(green / (alpha / 255));
        out[target + 2] = Math.round(blue / (alpha / 255));
      }
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const detailedBase = renderBase(true);
const simpleBase = renderBase(false);

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const size of [16, 24, 32, 48, 128]) {
  const base = size < 24 ? simpleBase : detailedBase;
  const png = encodePng(size, downscale(base, size));
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`icon${size}.png  ${png.length} bytes`);
}
