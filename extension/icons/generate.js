#!/usr/bin/env node
/**
 * 生成扩展图标 PNG（无需第三方依赖）。
 * 设计：圆角蓝底 + 白色向上箭头 + 两个白色小圆点（象征多设备）。
 * 用法：node generate.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = __dirname;
const SIZES = [16, 32, 48, 128];

const BG = [0x25, 0x63, 0xeb]; // #2563eb 主色
const FG = [0xff, 0xff, 0xff];

function generate(size) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22);
  const cx = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = insideRoundRect(x + 0.5, y + 0.5, 0, 0, size, size, radius);
      const idx = (y * size + x) * 4;
      if (inside <= 0) {
        // 透明
        buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 0;
        continue;
      }
      // 蓝底
      let r = BG[0], g = BG[1], b = BG[2];
      let a = Math.min(255, Math.round(inside * 255));

      // 绘制箭头：从 (cx, size*0.72) 到 (cx, size*0.28)，头部两翼
      const arrowStroke = Math.max(1, size * 0.11);
      const arrowTopY = size * 0.28;
      const arrowBotY = size * 0.72;

      // 主竖线
      const vertDist = Math.max(0, distToSegment(x + 0.5, y + 0.5, cx, arrowTopY, cx, arrowBotY));
      // 左翼：从头顶到左下
      const leftDist = distToSegment(x + 0.5, y + 0.5, cx, arrowTopY, cx - size * 0.18, arrowTopY + size * 0.18);
      // 右翼
      const rightDist = distToSegment(x + 0.5, y + 0.5, cx, arrowTopY, cx + size * 0.18, arrowTopY + size * 0.18);

      const strokeMin = Math.min(vertDist, leftDist, rightDist);
      if (strokeMin < arrowStroke / 2) {
        r = FG[0]; g = FG[1]; b = FG[2];
      }

      // 底部两个小圆点（象征设备）
      const dotR = size * 0.055;
      const dot1 = dist(x + 0.5, y + 0.5, size * 0.28, size * 0.82);
      const dot2 = dist(x + 0.5, y + 0.5, size * 0.72, size * 0.82);
      if (dot1 < dotR || dot2 < dotR) {
        r = FG[0]; g = FG[1]; b = FG[2];
      }

      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = a;
    }
  }
  return encodePNG(size, size, buf);
}

// 圆角矩形 SDF：返回覆盖度 (0..1)
function insideRoundRect(px, py, rx, ry, rw, rh, radius) {
  const dx = Math.max(rx + radius - px, px - (rx + rw - radius), 0);
  const dy = Math.max(ry + radius - py, py - (ry + rh - radius), 0);
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, Math.min(1, radius - d + 0.5));
}
function dist(x1, y1, x2, y2) {
  const dx = x1 - x2, dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}
function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 ? (apx * abx + apy * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + abx * t, qy = ay + aby * t;
  return dist(px, py, qx, qy);
}

// ---- 最小 PNG 编码器 ----
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // 每行前加 filter byte 0
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw);

  const chunks = [
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat([sig, ...chunks]);
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
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
  return c ^ 0xffffffff;
}

for (const s of SIZES) {
  const out = path.join(OUT, `icon-${s}.png`);
  fs.writeFileSync(out, generate(s));
  console.log(`wrote ${out} (${s}x${s})`);
}
