/**
 * 打包扩展产物。纯 Node 实现，不依赖任何第三方库：
 *  - zip：商店上传 / 手动分发用
 *  - crx：本地安装用，按 CRX3 规范用 RSA 私钥签名
 *
 * 用法：
 *   node scripts/pack.mjs              # 同时生成 zip 与 crx
 *   node scripts/pack.mjs --zip        # 只生成 zip
 *   node scripts/pack.mjs --crx        # 只生成 crx
 *
 * 私钥默认放在 .keys/crx.pem，首次运行自动生成（2048 位 RSA）。
 * 请妥善保管该文件：一旦丢失，用新私钥打出的包扩展 ID 会变化。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'release');
const KEY_DIR = path.join(ROOT, '.keys');
const KEY_FILE = path.join(KEY_DIR, 'crx.pem');

const args = process.argv.slice(2);
const wantZip = args.length === 0 || args.includes('--zip');
const wantCrx = args.length === 0 || args.includes('--crx');

/* ---------- 基础工具 ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value, 0);
  return b;
}

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0, 0);
  return b;
}

/** 递归列出目录下所有文件，返回相对 dist 的 POSIX 路径 */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/* ---------- ZIP ---------- */

/** MS-DOS 时间戳，固定为 1980-01-01 00:00，保证同样内容产出同样字节 */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    // 压缩没有变小就存原始数据
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const flags = 0x0800; // 文件名使用 UTF-8

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      payload,
    ]);

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(flags),
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0o100644 << 16),
      u32(offset),
      nameBuf,
    ]);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ---------- CRX3 ---------- */

function varint(value) {
  const bytes = [];
  let v = value;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

/** protobuf： length-delimited 字段 */
function pbBytes(field, bytes) {
  return Buffer.concat([varint((field << 3) | 2), varint(bytes.length), bytes]);
}

function loadOrCreateKey() {
  if (fs.existsSync(KEY_FILE)) {
    return crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
  }
  console.log('未找到私钥，正在生成 .keys/crx.pem ...');
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, privateKey);
  console.log(`私钥已生成：${path.relative(ROOT, KEY_FILE)}（请自行备份，勿提交）`);
  return crypto.createPrivateKey(privateKey);
}

function buildCrx(zipBuf, privateKey) {
  // SPKI DER 形式的公钥，扩展 ID 由它的 SHA-256 前 16 字节决定
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

  const crxId = crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);

  // SignedData { bytes crx_id = 1; }
  const signedHeaderData = pbBytes(1, crxId);

  const prefix = Buffer.from('CRX3 SignedData\x00', 'binary');
  const signInput = Buffer.concat([prefix, u32(signedHeaderData.length), signedHeaderData, zipBuf]);

  const signature = crypto.sign('sha256', signInput, privateKey);

  // CrxFileHeader { sha256_with_rsa = 2; ecdsa = 3; signed_header_data = 10000; }
  const proof = Buffer.concat([pbBytes(1, publicKeyDer), pbBytes(2, signature)]);
  const header = Buffer.concat([pbBytes(2, proof), pbBytes(10000, signedHeaderData)]);

  return {
    crx: Buffer.concat([Buffer.from('Cr24', 'binary'), u32(3), u32(header.length), header, zipBuf]),
    crxId: crxId.toString('hex'),
  };
}

/* ---------- 主流程 ---------- */

/** 从 manifest 取出真实显示名：支持 __MSG_key__ 形式的本地化占位 */
function extensionName(manifest) {
  const raw = typeof manifest.name === 'string' ? manifest.name : 'extension';
  const match = /^__MSG_(.+)__$/.exec(raw);
  if (!match) return raw;

  const key = match[1];
  const locale = manifest.default_locale ?? 'en';
  try {
    const file = path.join(SRC, '_locales', locale, 'messages.json');
    const messages = JSON.parse(fs.readFileSync(file, 'utf8'));
    return messages[key]?.message ?? key;
  } catch {
    return key;
  }
}

function slugify(text) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'extension';
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('未找到 dist/，请先执行 npm run build');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const version = manifest.version ?? '0.0.0';
  // 文件名跟随 manifest 里的扩展名，改名后无需再动这个脚本
  const stem = `${slugify(extensionName(manifest))}-v${version}`;

  const files = walk(SRC).sort();
  if (files.length === 0) {
    console.error('dist/ 为空，请先执行 npm run build');
    process.exit(1);
  }

  const entries = files.map((name) => ({ name, data: fs.readFileSync(path.join(SRC, name)) }));
  const zipBuf = buildZip(entries);

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`已打包 ${entries.length} 个文件`);

  if (wantZip) {
    const zipPath = path.join(OUT, `${stem}.zip`);
    fs.writeFileSync(zipPath, zipBuf);
    console.log(`zip  -> ${path.relative(ROOT, zipPath)}  (${(zipBuf.length / 1024).toFixed(1)} KB)`);
  }

  if (wantCrx) {
    const privateKey = loadOrCreateKey();
    const { crx, crxId } = buildCrx(zipBuf, privateKey);
    const crxPath = path.join(OUT, `${stem}.crx`);
    fs.writeFileSync(crxPath, crx);
    console.log(`crx  -> ${path.relative(ROOT, crxPath)}  (${(crx.length / 1024).toFixed(1)} KB)`);
    console.log(`扩展 ID：${crxId}`);
  }
}

main();
