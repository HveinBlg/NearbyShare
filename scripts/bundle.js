#!/usr/bin/env node
/**
 * 将 server/ 打包为单个 dist/nearby-share-bundled.js 文件（内联 media 静态资源）。
 * 供 SEA 打包 / 分发使用。零依赖。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'nearby-share-bundled.js');

fs.mkdirSync(OUT_DIR, { recursive: true });

// 内联静态资源
const mediaDir = path.join(ROOT, 'server', 'media');
const mediaMap = {};
for (const name of fs.readdirSync(mediaDir)) {
  const buf = fs.readFileSync(path.join(mediaDir, name));
  mediaMap[name] = buf.toString('base64');
  console.log(`  inline ${name} (${buf.length} bytes)`);
}

// 读取 server 源码
const store = fs.readFileSync(path.join(ROOT, 'server', 'store.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const bin = fs.readFileSync(path.join(ROOT, 'server', 'bin.js'), 'utf8');

// 简单地把三个 CommonJS 模块串起来
function mod(code) {
  // 移除 shebang / strict / module.exports 引导
  return code
    .replace(/^#!.*$/m, '')
    .replace(/^'use strict';?/m, '');
}

const bundled = `#!/usr/bin/env node
'use strict';
/* ==============================================
 * NearbyShare bundled runtime
 * 由 scripts/bundle.js 生成，请勿手工修改。
 * ============================================== */

// 内联的静态资源（base64）
const __MEDIA__ = ${JSON.stringify(mediaMap)};

// -------- 模块伪注册表 --------
const __modules = {};
function __define(id, factory) {
  const module = { exports: {} };
  factory(module, module.exports, __require);
  __modules[id] = module.exports;
}
function __require(id) {
  if (id.startsWith('./') || id.startsWith('../') || id === './server' || id === './store') {
    const key = id.replace(/^\\.\\//, '').replace(/\\.js$/, '');
    if (__modules[key]) return __modules[key];
  }
  return require(id);
}

// -------- store.js --------
__define('store', function (module, exports, require) {
${mod(store)}
});

// -------- server.js（改写为从内联资源读取 media） --------
__define('server', function (module, exports, require) {
${mod(server).replace(
  "const MEDIA_DIR = path.join(__dirname, 'media');",
  "const MEDIA_DIR = '__inline__';",
).replace(
  "function serveStatic(res, filePath) {\n  fs.readFile(filePath, (err, data) => {",
  "function serveStatic(res, filePath) {\n  const key = path.basename(filePath);\n  const inline = __MEDIA__ && __MEDIA__[key];\n  if (inline) {\n    const buf = Buffer.from(inline, 'base64');\n    res.writeHead(200, { 'Content-Type': mimeFromName(filePath), 'Cache-Control': 'no-cache' });\n    return res.end(buf);\n  }\n  fs.readFile(filePath, (err, data) => {",
)}
});

// -------- bin.js（改写 require 路径） --------
${mod(bin)
  .replace("require('./server')", "__require('./server')")
  .replace("require('./store')", "__require('./store')")}
`;

fs.writeFileSync(OUT_FILE, bundled);
fs.chmodSync(OUT_FILE, 0o755);
console.log(`\n生成 ${OUT_FILE} (${(bundled.length / 1024).toFixed(1)} KB)`);
