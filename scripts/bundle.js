#!/usr/bin/env node
/**
 * 将 server/ 打包为单个 dist/nearby-share-bundled.js 文件（内联 media 静态资源）。
 * 供 SEA 打包 / 分发使用。零依赖。
 *
 * 重要：所有源文件的换行符必须归一化为 LF 才能做下面的多行字符串替换。
 * 否则在 Windows GitHub Actions runner 上（默认 core.autocrlf=true）源文件
 * 会带 CRLF，字符串替换会静默失败，导致内联静态资源逻辑没被注入，
 * 最终产出的 exe 上 /、/client.js 等所有静态路径返 404。参见 issue 复盘。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'nearby-share-bundled.js');

fs.mkdirSync(OUT_DIR, { recursive: true });

// 归一化行尾。所有读入源文件都过这里。
function readSource(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

// 内联静态资源
const mediaDir = path.join(ROOT, 'server', 'media');
const mediaMap = {};
for (const name of fs.readdirSync(mediaDir)) {
  const buf = fs.readFileSync(path.join(mediaDir, name));
  mediaMap[name] = buf.toString('base64');
  console.log(`  inline ${name} (${buf.length} bytes)`);
}

// 读取 server 源码（换行已归一化为 LF）
const store = readSource(path.join(ROOT, 'server', 'store.js'));
const server = readSource(path.join(ROOT, 'server', 'server.js'));
const bin = readSource(path.join(ROOT, 'server', 'bin.js'));

// 简单地把三个 CommonJS 模块串起来
function mod(code) {
  // 移除 shebang / strict / module.exports 引导
  return code
    .replace(/^#!.*$/m, '')
    .replace(/^'use strict';?/m, '');
}

// 断言式替换：若 needle 没找到，抛错让 CI 立即失败，避免静默产出坏 bundle。
function requireReplace(code, needle, replacement, label) {
  if (!code.includes(needle)) {
    throw new Error(
      `[bundle] Failed to locate expected pattern "${label}" in server.js. ` +
      `The generated bundle would be broken (static file serving would 404). ` +
      `Check that server.js still contains the string:\n${needle}`
    );
  }
  return code.split(needle).join(replacement);
}

const MEDIA_DIR_NEEDLE = "const MEDIA_DIR = path.join(__dirname, 'media');";
const MEDIA_DIR_REPLACEMENT = "const MEDIA_DIR = '__inline__';";

const SERVE_STATIC_NEEDLE =
  "function serveStatic(res, filePath) {\n" +
  "  fs.readFile(filePath, (err, data) => {";
const SERVE_STATIC_REPLACEMENT =
  "function serveStatic(res, filePath) {\n" +
  "  const key = path.basename(filePath);\n" +
  "  const inline = __MEDIA__ && __MEDIA__[key];\n" +
  "  if (inline) {\n" +
  "    const buf = Buffer.from(inline, 'base64');\n" +
  "    res.writeHead(200, { 'Content-Type': mimeFromName(filePath), 'Cache-Control': 'no-cache' });\n" +
  "    return res.end(buf);\n" +
  "  }\n" +
  "  fs.readFile(filePath, (err, data) => {";

let serverModCode = mod(server);
serverModCode = requireReplace(serverModCode, MEDIA_DIR_NEEDLE, MEDIA_DIR_REPLACEMENT, 'MEDIA_DIR');
serverModCode = requireReplace(serverModCode, SERVE_STATIC_NEEDLE, SERVE_STATIC_REPLACEMENT, 'serveStatic');

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
${serverModCode}
});

// -------- bin.js（改写 require 路径） --------
${mod(bin)
  .replace("require('./server')", "__require('./server')")
  .replace("require('./store')", "__require('./store')")}
`;

fs.writeFileSync(OUT_FILE, bundled);
fs.chmodSync(OUT_FILE, 0o755);
console.log(`\n生成 ${OUT_FILE} (${(bundled.length / 1024).toFixed(1)} KB)`);
