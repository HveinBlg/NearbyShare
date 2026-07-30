#!/usr/bin/env node
/**
 * 把 SEA 构建产物 dist/nearby-share-darwin-<arch> 打包成：
 *   1) NearbyShare.app  — Mac 原生 .app bundle（双击打开 Terminal 跑服务）
 *   2) nearby-share-darwin-<arch>.dmg — 磁盘映像，带 /Applications 拖拽符号链接
 *
 * 依赖：仅使用 macOS 系统自带工具（iconutil / hdiutil / codesign）+ Node 标准库。
 * 必须在 macOS 上运行。
 *
 * 注意：所有 helper 函数与 const（尤其是 CRC_TABLE）必须先声明再被主逻辑调用。
 * 若把 CRC_TABLE 放在文件底部，会在主逻辑首次调用 generateIconPNG 时命中 TDZ
 * (temporal dead zone) 并抛 ReferenceError。参见早期 CI 失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const os = require('os');

/* ==================== helpers 必须先声明 ==================== */

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

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function insideRoundRect(px, py, rx, ry, rw, rh, radius) {
  const dx = Math.max(rx + radius - px, px - (rx + rw - radius), 0);
  const dy = Math.max(ry + radius - py, py - (ry + rh - radius), 0);
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, Math.min(1, radius - d + 0.5));
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 ? (apx * abx + apy * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function generateIconPNG(size) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22);
  const cx = size / 2;
  const BG = [0x25, 0x63, 0xeb];
  const FG = [0xff, 0xff, 0xff];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = insideRoundRect(x + 0.5, y + 0.5, 0, 0, size, size, radius);
      const idx = (y * size + x) * 4;
      if (inside <= 0) { buf[idx + 3] = 0; continue; }
      let r = BG[0], g = BG[1], b = BG[2];
      const a = Math.min(255, Math.round(inside * 255));

      const arrowStroke = Math.max(1, size * 0.11);
      const arrowTopY = size * 0.28, arrowBotY = size * 0.72;
      const vertDist = distToSegment(x + 0.5, y + 0.5, cx, arrowTopY, cx, arrowBotY);
      const leftDist = distToSegment(x + 0.5, y + 0.5, cx, arrowTopY, cx - size * 0.18, arrowTopY + size * 0.18);
      const rightDist = distToSegment(x + 0.5, y + 0.5, cx, arrowTopY, cx + size * 0.18, arrowTopY + size * 0.18);
      const strokeMin = Math.min(vertDist, leftDist, rightDist);
      if (strokeMin < arrowStroke / 2) { r = FG[0]; g = FG[1]; b = FG[2]; }

      const dotR = size * 0.055;
      const d1 = Math.hypot(x + 0.5 - size * 0.28, y + 0.5 - size * 0.82);
      const d2 = Math.hypot(x + 0.5 - size * 0.72, y + 0.5 - size * 0.82);
      if (d1 < dotR || d2 < dotR) { r = FG[0]; g = FG[1]; b = FG[2]; }

      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = a;
    }
  }
  return encodePNG(size, size, buf);
}

/* ==================== 主逻辑（放在文件末尾，helpers 已就绪）==================== */

function main() {
  if (os.platform() !== 'darwin') {
    console.error('This script must be run on macOS. Skipping.');
    return;
  }

  const ROOT = path.resolve(__dirname, '..');
  const DIST = path.join(ROOT, 'dist');
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const BINARY = path.join(DIST, `nearby-share-darwin-${arch}`);

  if (!fs.existsSync(BINARY)) {
    console.error(`Binary not found: ${BINARY}`);
    console.error('Run "node scripts/build-sea.js" first.');
    process.exit(1);
  }

  const VERSION = '1.0.0';
  const APP_NAME = 'NearbyShare';
  const APP_DIR = path.join(DIST, `${APP_NAME}.app`);
  const CONTENTS = path.join(APP_DIR, 'Contents');
  const MACOS_DIR = path.join(CONTENTS, 'MacOS');
  const RESOURCES = path.join(CONTENTS, 'Resources');

  // 清理旧产物
  for (const p of [APP_DIR, path.join(DIST, 'AppIcon.iconset'), path.join(DIST, 'dmg-stage')]) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  fs.mkdirSync(MACOS_DIR, { recursive: true });
  fs.mkdirSync(RESOURCES, { recursive: true });

  /* 1) 把裸二进制放进 Contents/MacOS/nearby-share --------------------------- */
  const BIN_IN_APP = path.join(MACOS_DIR, 'nearby-share');
  fs.copyFileSync(BINARY, BIN_IN_APP);
  fs.chmodSync(BIN_IN_APP, 0o755);

  /* 2) 写一个 shell 启动器，双击 .app 时被调用，打开 Terminal 跑服务 --------- */
  const LAUNCHER = path.join(MACOS_DIR, APP_NAME);
  fs.writeFileSync(LAUNCHER, `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
osascript <<APPLESCRIPT
tell application "Terminal"
    activate
    do script "'$DIR/nearby-share'"
end tell
APPLESCRIPT
`);
  fs.chmodSync(LAUNCHER, 0o755);

  /* 3) 生成 .icns 图标（从 SVG 一样的程序绘制，多尺寸）-------------------- */
  console.log('Generating iconset...');
  const ICONSET = path.join(DIST, 'AppIcon.iconset');
  fs.mkdirSync(ICONSET, { recursive: true });

  const ICON_ENTRIES = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ];
  for (const { size, name } of ICON_ENTRIES) {
    fs.writeFileSync(path.join(ICONSET, name), generateIconPNG(size));
  }
  const ICNS = path.join(RESOURCES, 'AppIcon.icns');
  try {
    execSync(`iconutil -c icns -o "${ICNS}" "${ICONSET}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('iconutil failed. Falling back to sips + iconutil workaround...');
    // 有些 CI 环境下 iconutil 对纯代码生成的 PNG 校验更严格，
    // 用 sips 重新处理一遍以确保 PNG 格式完全合规
    for (const { name } of ICON_ENTRIES) {
      const f = path.join(ICONSET, name);
      try {
        execSync(`sips -s format png "${f}" --out "${f}"`, { stdio: 'pipe' });
      } catch (_) { /* sips may not help, continue */ }
    }
    execSync(`iconutil -c icns -o "${ICNS}" "${ICONSET}"`, { stdio: 'inherit' });
  }

  /* 4) 写 Info.plist -------------------------------------------------------- */
  const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>com.hveinblg.nearbyshare</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(CONTENTS, 'Info.plist'), PLIST);
  console.log(`Wrote ${APP_DIR}`);

  /* 5) ad-hoc codesign（同时签 launcher 和内部 nearby-share）----------------- */
  try {
    execSync(`codesign --sign - --force --deep "${APP_DIR}"`, { stdio: 'inherit' });
  } catch (err) {
    console.warn('codesign warning (non-fatal):', err.message);
  }

  /* 6) 组装 DMG stage 目录：.app + /Applications 符号链接 ------------------- */
  const STAGE = path.join(DIST, 'dmg-stage');
  fs.mkdirSync(STAGE, { recursive: true });
  execSync(`cp -R "${APP_DIR}" "${STAGE}/"`);
  execSync(`ln -s /Applications "${STAGE}/Applications"`);

  const DMG = path.join(DIST, `nearby-share-darwin-${arch}.dmg`);
  if (fs.existsSync(DMG)) fs.unlinkSync(DMG);
  console.log('Building DMG...');

  // hdiutil 在 CI 中经常因 "Resource busy" 失败（macOS Spotlight / fsevents 等
  // 仍在索引 .app），加入 sync + sleep + 重试来解决。
  // 参见 https://github.com/actions/runner-images/issues/7522
  execSync('sync', { stdio: 'ignore' });

  const hdiutilCmd = `hdiutil create -volname "${APP_NAME}" -srcfolder "${STAGE}" -ov -format UDZO "${DMG}"`;
  const MAX_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      execSync(hdiutilCmd, { stdio: 'inherit' });
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`hdiutil failed after ${MAX_RETRIES} attempts`);
        throw err;
      }
      const delaySec = attempt * 5;
      console.warn(`hdiutil attempt ${attempt} failed, retrying in ${delaySec}s...`);
      execSync(`sleep ${delaySec}`);
    }
  }

  /* 7) 清理临时目录 -------------------------------------------------------- */
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.rmSync(ICONSET, { recursive: true, force: true });

  const size = fs.statSync(DMG).size;
  console.log(`\n${DMG} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main();
