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
    else if (a === '--no-minimize' || a === '--visible') opts.visible = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function usage() {
  console.log(`\nNearbyShare 本地服务器\n\n用法：\n  node bin.js [--port 3000] [--dir <上传目录>] [--max-mb 500]\n\n选项：\n  -p, --port <n>     监听端口，默认 3000（被占用时自动 +1）\n  --dir <path>       上传文件保存目录，默认 ~/.nearby-share/uploads\n  --max-mb <n>       单文件最大 MB，默认 500\n  --name <name>      本机在设备列表中显示的名称\n  --visible          Windows：不自动最小化控制台（默认双击启动会最小化）\n  -h, --help         帮助\n`);
}

/**
 * 在 Windows 上双击启动 exe 时把控制台窗口最小化到任务栏。
 *
 * 上一版的实现有 bug：spawn PowerShell 时用了 `detached: true` + `windowsHide: true`，
 * 导致子 PowerShell 拿到的是自己那个（不存在的/隐藏的）控制台，而不是父进程
 * （我们）的控制台，所以 GetConsoleWindow() 返回 0，ShowWindow 没有效果。
 *
 * 修法：让 PowerShell 用 `AttachConsole(parentPid)` 显式挂接到我们的控制台。
 *   - 传入父进程 PID（我们自己的 pid）作为参数
 *   - PowerShell 先 FreeConsole() 释放自己隐含的控制台
 *   - 再 AttachConsole(parentPid) 挂到父控制台
 *   - GetConsoleProcessList 现在返回该控制台上所有已挂接进程数：
 *       双击场景  = [父 node, 我们这个 powershell] = 2
 *       从终端    = [用户 shell, 父 node, 我们这个 powershell] >= 3
 *     所以判断改成 `-le 2`
 *   - ShowWindow(GetConsoleWindow(), 7) — SW_SHOWMINNOACTIVE，最小化不抢焦点
 *   - FreeConsole 收尾
 *
 * 命令通过 -EncodedCommand 传递（UTF-16LE + Base64），避免多行字符串在
 * shell 参数里被截断或转义出错。
 *
 * 全过程静默：spawn 失败、PowerShell 缺失、Attach 失败都不影响服务器。
 */
function tryMinimizeConsoleOnWindows() {
  if (process.platform !== 'win32') return;
  const parentPid = process.pid;
  const psScript = `
$sig = @'
[DllImport("kernel32", SetLastError=true)] public static extern bool FreeConsole();
[DllImport("kernel32", SetLastError=true)] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("kernel32")] public static extern uint GetConsoleProcessList(uint[] p, uint c);
[DllImport("user32")] public static extern bool ShowWindow(System.IntPtr h, int c);
'@
Add-Type -MemberDefinition $sig -Name W -Namespace N -ErrorAction SilentlyContinue
[void][N.W]::FreeConsole()
if ([N.W]::AttachConsole(${parentPid})) {
    $buf = New-Object uint32[] 8
    $count = [N.W]::GetConsoleProcessList($buf, 8)
    # 2 = [node parent, this powershell] -> 双击 -> 最小化
    # >= 3 = 还挂着用户的 shell -> 从终端 -> 保持原样
    if ($count -le 2) {
        [void][N.W]::ShowWindow([N.W]::GetConsoleWindow(), 7)
    }
    [void][N.W]::FreeConsole()
}
`.trim();
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  try {
    const child = require('child_process').spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded,
    ], { stdio: 'ignore', windowsHide: true, detached: true });
    child.unref();
    child.on('error', () => { /* 忽略 —— PowerShell 缺失时不要影响启动 */ });
  } catch (_) { /* ignore */ }
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

  // 双击 exe 启动时自动最小化控制台窗口。从命令行 / --visible 时不动。
  if (!opts.visible) {
    // 稍等一下让 banner 有机会绘制完再最小化，避免出现"窗口刚闪一下"的观感
    setTimeout(tryMinimizeConsoleOnWindows, 300);
  }

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
