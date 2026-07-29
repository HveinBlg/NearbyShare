#!/usr/bin/env node
'use strict';

/**
 * NearbyShare 本地伴生服务器入口。
 * 用法：node bin.js [--port 3000] [--dir <上传目录>] [--max-mb 500]
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { startServer, getLanUrls } = require('./server');
const { createStore } = require('./store');

function parseArgs(argv) {
  const opts = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') opts.port = Number(argv[++i]);
    else if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--max-mb') opts.maxMb = Number(argv[++i]);
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function usage() {
  console.log(`\nNearbyShare 本地服务器\n\n用法：\n  node bin.js [--port 3000] [--dir <上传目录>] [--max-mb 500]\n\n选项：\n  -p, --port <n>     监听端口，默认 3000（被占用时自动 +1）\n  --dir <path>       上传文件保存目录，默认 ~/.nearby-share/uploads\n  --max-mb <n>       单文件最大 MB，默认 500\n  --name <name>      本机在设备列表中显示的名称\n  -h, --help         帮助\n`);
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) { usage(); process.exit(0); }

  const port = opts.port || 3000;
  const uploadDir = opts.dir || path.join(os.homedir(), '.nearby-share', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  const store = createStore({ uploadDir, historyLimit: 500 });

  // 把自身也注册进设备列表，用来显示"这台电脑"
  store.registerDevice({
    id: 'host',
    name: opts.name || `${os.hostname()}（主机）`,
    userAgent: 'nearby-share-host',
    ip: '127.0.0.1',
  });

  const handle = await startServer({
    port,
    store,
    maxFileSize: (opts.maxMb || 500) * 1024 * 1024,
    log: (m) => console.log(`[nearby-share] ${m}`),
  });

  const urls = getLanUrls(handle.port);
  banner(urls, handle.port);

  // 平滑退出
  const shutdown = async (sig) => {
    console.log(`\n收到 ${sig}，正在关闭...`);
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function banner(urls, port) {
  const bar = '═'.repeat(52);
  console.log(`\n╔${bar}╗`);
  console.log(`║  NearbyShare 已启动 ${' '.repeat(32)}║`);
  console.log(`╠${bar}╣`);
  console.log(`║  其它设备浏览器打开以下任一地址：${' '.repeat(15)}║`);
  if (urls.length === 0) {
    console.log(`║    (未检测到局域网 IPv4，请检查网络) ${' '.repeat(12)}║`);
  } else {
    for (const { iface, url } of urls) {
      const line = `║    ${url}   [${iface}]`;
      console.log(line + ' '.repeat(Math.max(0, 55 - visibleLen(line))) + '║');
    }
  }
  const local = `║    http://localhost:${port}   [本机]`;
  console.log(local + ' '.repeat(Math.max(0, 55 - visibleLen(local))) + '║');
  console.log(`╚${bar}╝`);
  console.log(`\n按 Ctrl+C 退出。\n`);
}

function visibleLen(s) {
  // 简单近似：中文按 2 宽，其余按 1
  let n = 0;
  for (const ch of s) n += /[\u4e00-\u9fff]|[\uff00-\uffef]/.test(ch) ? 2 : 1;
  return n;
}

main().catch((err) => {
  console.error('启动失败：', err.message);
  process.exit(1);
});
