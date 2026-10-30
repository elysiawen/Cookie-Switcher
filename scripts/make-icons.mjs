/**
 * 从仓库根目录的 logo.png 生成扩展图标。
 * 纯 Node 实现：手写 PNG 解码 / 编码 + 面积平均缩放，不依赖任何图形库。
 *
 * 处理步骤：
 *  1. 解码 logo.png（8 位 RGB / RGBA，非隔行）
 *  2. 从四角 flood fill 去掉图标外的纯白底，让工具栏上不出现白方块
 *  3. 面积平均缩放到各尺寸并重新编码
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOGO = path.join(ROOT, 'logo.png');
const OUT_DIR = path.join(ROOT, 'public', 'icons');
const SIZES = [16, 24, 32, 48, 128];

/* ---------- PNG 解码 ---------- */

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  if (bitDepth !== 8) throw new Error(`logo.png 需为 8 位色深，当前 ${bitDepth}`);
  if (interlace !== 0) throw new Error('logo.png 不支持隔行扫描');
  if (colorType !== 2 && colorType !== 6) {
    throw new Error('logo.png 需为 RGB 或 RGBA 格式');
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const lineStart = y * (stride + 1) + 1;
    const cur = Buffer.alloc(stride);

    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const value = lineStart + i < raw.length ? raw[lineStart + i] : 0;

      switch (filter) {
        case 0:
          cur[i] = value;
          break;
        case 1:
          cur[i] = (value + a) & 0xff;
          break;
        case 2:
          cur[i] = (value + b) & 0xff;
          break;
        case 3:
          cur[i] = (value + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          cur[i] = (value + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`不支持的 PNG 滤波类型 ${filter}`);
      }
    }

    cur.copy(pixels, y * stride);
    prev = cur;
  }

  if (channels === 4) return { width, height, data: pixels };

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    rgba[j] = pixels[i];
    rgba[j + 1] = pixels[i + 1];
    rgba[j + 2] = pixels[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}

/* ---------- 定位图标本体 ---------- */

/** 找出非白像素的范围，也就是圆角方块的边界 */
function findNonWhiteBounds(source) {
  const { width, height, data } = source;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error('logo.png 看起来是纯白的，没有可用的图形');
  return { minX, minY, maxX, maxY };
}

function cropRect(source, { minX, minY, maxX, maxY }) {
  const { width, data } = source;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = Buffer.alloc(w * h * 4);

  for (let y = 0; y < h; y += 1) {
    const from = ((y + minY) * width + minX) * 4;
    data.copy(out, y * w * 4, from, from + w * 4);
  }
  return { width: w, height: h, data: out };
}

/**
 * 用圆角矩形蒙版抠掉四周白底。
 * 不做 flood fill：白底与图标内的浅灰背景色差太小，按颜色判断会渗进内部，
 * 按几何形状裁切最干净。
 */
function applyRoundedMask(source, radiusRatio = 0.18, feather = 1.6) {
  const { width, height, data } = source;
  const radius = Math.min(width, height) * radiusRatio;
  const cx = width / 2;
  const cy = height / 2;
  const halfW = width / 2;
  const halfH = height / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = Math.abs(x + 0.5 - cx) - (halfW - radius);
      const dy = Math.abs(y + 0.5 - cy) - (halfH - radius);
      const outside =
        Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
      const coverage = Math.min(1, Math.max(0, 0.5 - outside / feather));

      const i = (y * width + x) * 4;
      data[i + 3] = Math.round(data[i + 3] * coverage);
    }
  }
}

/** 裁掉透明留白，让图标在工具栏里更饱满 */
function cropToContent(source) {
  const { width, height, data } = source;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return source;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w === width && h === height) return source;

  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const from = ((y + minY) * width + minX) * 4;
    data.copy(out, y * w * 4, from, from + w * 4);
  }
  return { width: w, height: h, data: out };
}

/* ---------- 缩放 ---------- */

function downscale(source, size) {
  const { width, height, data } = source;
  const out = Buffer.alloc(size * size * 4);
  const scaleX = width / size;
  const scaleY = height / size;

  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(height, Math.ceil((y + 1) * scaleY));

    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(width, Math.ceil((x + 1) * scaleX));

      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;

      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * width + sx) * 4;
          const a = data[i + 3] / 255;
          red += data[i] * a;
          green += data[i + 1] * a;
          blue += data[i + 2] * a;
          alpha += data[i + 3];
          count += 1;
        }
      }

      const target = (y * size + x) * 4;
      out[target + 3] = Math.round(alpha / count);
      if (alpha > 0) {
        const weight = alpha / 255;
        out[target] = Math.round(red / weight);
        out[target + 1] = Math.round(green / weight);
        out[target + 2] = Math.round(blue / weight);
      }
    }
  }

  return out;
}

/* ---------- PNG 编码 ---------- */

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

/* ---------- 主流程 ---------- */

if (!fs.existsSync(LOGO)) {
  console.error(`未找到 ${path.relative(ROOT, LOGO)}，请把 logo 放到项目根目录`);
  process.exit(1);
}

const raw = decodePng(fs.readFileSync(LOGO));
const trimmed = cropRect(raw, findNonWhiteBounds(raw));
applyRoundedMask(trimmed);
const source = cropToContent(trimmed);
console.log(`源图 ${raw.width}x${raw.height} → 图标 ${source.width}x${source.height}`);

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const png = encodePng(size, downscale(source, size));
  fs.writeFileSync(path.join(OUT_DIR, `icon${size}.png`), png);
  console.log(`icon${size}.png  ${png.length} bytes`);
}
