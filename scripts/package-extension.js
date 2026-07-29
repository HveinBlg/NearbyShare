#!/usr/bin/env node
/**
 * 打包扩展目录为 dist/nearby-share-extension.zip（Chrome Web Store 上架 / 侧载）。
 * 零依赖（用 Node 内置的 zlib 手写最小 ZIP）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'dist', 'nearby-share-extension.zip');

fs.mkdirSync(path.dirname(OUT), { recursive: true });

// 递归收集文件
function walk(dir, base = '') {
  const list = [];
  for (const name of fs.readdirSync(dir)) {
    // 跳过图标生成脚本，用户不需要它
    if (name === 'generate.js') continue;
    const full = path.join(dir, name);
    const rel = path.posix.join(base, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) list.push(...walk(full, rel));
    else list.push({ full, rel });
  }
  return list;
}

// ---- CRC-32 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const files = walk(SRC);
console.log(`打包 ${files.length} 个文件：`);
files.forEach((f) => console.log('  ' + f.rel));

const localParts = [];
const central = [];
let offset = 0;

for (const f of files) {
  const data = fs.readFileSync(f.full);
  const compressed = zlib.deflateRawSync(data);
  const name = Buffer.from(f.rel);
  const crc = crc32(data);

  // Local File Header
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);   // signature
  local.writeUInt16LE(20, 4);            // version needed
  local.writeUInt16LE(0, 6);             // flags
  local.writeUInt16LE(8, 8);             // method: deflate
  local.writeUInt16LE(0, 10);            // mtime
  local.writeUInt16LE(0, 12);            // mdate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);

  localParts.push(local, compressed);

  // Central Directory
  const cd = Buffer.alloc(46 + name.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt16LE(0, 12);
  cd.writeUInt16LE(0, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(compressed.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(0, 38);       // external attrs
  cd.writeUInt32LE(offset, 42);
  name.copy(cd, 46);
  central.push(cd);

  offset += local.length + compressed.length;
}

const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const out = Buffer.concat([...localParts, centralBuf, eocd]);
fs.writeFileSync(OUT, out);
console.log(`\n生成 ${OUT} (${(out.length / 1024).toFixed(1)} KB)`);
