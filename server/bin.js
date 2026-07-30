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
 * 前几版的坑：
 *   - PR #11: spawn PowerShell 时用 `detached:true + windowsHide:true`，
 *     导致 PowerShell 拿到的是自己那个（没有的）控制台，ShowWindow 无效
 *   - PR #15: 加了 AttachConsole 补救，但 spawn 选项没改；某些 Windows
 *     配置下 CREATE_NO_WINDOW 会阻止 AttachConsole，依旧失败
 *
 * 本版方案：让 PowerShell **继承**父进程（我们）的可见控制台。
 *   - spawn 时不传 windowsHide 也不传 detached
 *   - stdio 'ignore' 屏蔽 PS 的 stdin/stdout/stderr，不影响父控制台显示
 *   - PS 内 GetConsoleWindow() 直接返回父控制台 HWND（因为继承）
 *   - GetConsoleProcessList 返回：[父 node, 本 powershell] = 2（双击场景）
 *     或 [用户 shell, 父 node, 本 powershell] >= 3（从终端启动）
 *   - `-le 2` 时才 ShowWindow，避免把用户终端也压下去
 *
 * 加了文件日志到 `~/.nearby-share/minimize.log`，方便用户在最小化不生效
 * 时贴给我看。日志记录：spawn 是否失败、count、hwnd、ShowWindow 返回值、
 * 异常信息。写不了日志文件不影响正常运行。
 */
function tryMinimizeConsoleOnWindows() {
  if (process.platform !== 'win32') return;

  const logDir = path.join(os.homedir(), '.nearby-share');
  const logPath = path.join(logDir, 'minimize.log');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
  const nodeLog = (msg) => {
    try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] [node] ${msg}\n`); } catch (_) {}
  };

  // 让 PowerShell 也能写到同一份日志。转义 Windows 反斜杠给 PS 单引号字符串。
  const psLogPathQuoted = logPath.replace(/'/g, "''");

  const psScript = `
$LogPath = '${psLogPathQuoted}'
function Write-Log($msg) {
    try { Add-Content -Path $LogPath -Value ("[" + (Get-Date).ToString("o") + "] [ps]  " + $msg) } catch {}
}
try {
    $sig = @'
[DllImport("kernel32")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("kernel32")] public static extern uint GetConsoleProcessList(uint[] p, uint c);
[DllImport("user32")] public static extern bool ShowWindow(System.IntPtr h, int c);
'@
    Add-Type -MemberDefinition $sig -Name W -Namespace N -ErrorAction Stop
    $buf = New-Object uint32[] 16
    $count = [N.W]::GetConsoleProcessList($buf, 16)
    $hwnd = [N.W]::GetConsoleWindow()
    Write-Log "count=$count hwnd=$hwnd threshold=<=2"
    if ($count -gt 0 -and $count -le 2 -and $hwnd -ne [System.IntPtr]::Zero) {
        $ret = [N.W]::ShowWindow($hwnd, 7)
        Write-Log "ShowWindow(hwnd, SW_SHOWMINNOACTIVE) returned $ret -> MINIMIZED"
    } else {
        Write-Log "SKIPPED (running from terminal, or hwnd is 0)"
    }
} catch {
    Write-Log ("EXCEPTION: " + $_.ToString())
}
`.trim();

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  nodeLog(`spawning powershell (pid=${process.pid})`);
  try {
    // 关键：不传 windowsHide、不传 detached，让 PS 继承本进程的控制台
    const child = require('child_process').spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
    ], { stdio: 'ignore' });
    child.on('error', (err) => nodeLog(`spawn error: ${err && err.message}`));
    child.on('exit', (code) => nodeLog(`powershell exited code=${code}`));
  } catch (err) {
    nodeLog(`spawn threw: ${err && err.message}`);
  }
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
