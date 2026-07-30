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
 * 在 Windows 上双击启动 exe 时把控制台窗口隐藏到系统托盘（右下角通知区域）。
 *
 * 方案：用 PowerShell 的 WinForms 创建一个 NotifyIcon（系统托盘图标），
 * 同时用 ShowWindow(hwnd, SW_HIDE) 完全隐藏控制台窗口（不在任务栏中显示）。
 * 托盘图标右键菜单提供"显示窗口"和"退出"选项。
 *
 * 仅在双击启动场景（GetConsoleProcessList <= 2）才执行，
 * 从终端启动时不隐藏窗口。
 */
function tryMinimizeToTray() {
  if (process.platform !== 'win32') return;

  const logDir = path.join(os.homedir(), '.nearby-share');
  const logPath = path.join(logDir, 'minimize.log');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
  const nodeLog = (msg) => {
    try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] [node] ${msg}\n`); } catch (_) {}
  };

  const psLogPathQuoted = logPath.replace(/'/g, "''");
  const nodePid = process.pid;

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
    Write-Log "count=$count hwnd=$hwnd"
    if ($count -le 0 -or $count -gt 2 -or $hwnd -eq [System.IntPtr]::Zero) {
        Write-Log "SKIPPED (running from terminal or hwnd is 0)"
        exit
    }

    # 隐藏控制台窗口（SW_HIDE = 0），完全不在任务栏显示
    [N.W]::ShowWindow($hwnd, 0) | Out-Null
    Write-Log "ShowWindow(hwnd, SW_HIDE) done -> hidden from taskbar"

    # 创建系统托盘图标
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $nodePid = ${nodePid}
    $contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
    $showItem = $contextMenu.Items.Add("显示窗口")
    $exitItem = $contextMenu.Items.Add("退出 NearbyShare")

    $notifyIcon = New-Object System.Windows.Forms.NotifyIcon
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
    $notifyIcon.Text = "NearbyShare 运行中"
    $notifyIcon.ContextMenuStrip = $contextMenu
    $notifyIcon.Visible = $true

    # 双击托盘图标 -> 显示窗口
    $notifyIcon.Add_DoubleClick({
        [N.W]::ShowWindow($hwnd, 5) | Out-Null  # SW_SHOW
        Write-Log "Tray double-click -> ShowWindow"
    })

    # 菜单：显示窗口
    $showItem.Add_Click({
        [N.W]::ShowWindow($hwnd, 5) | Out-Null  # SW_SHOW
        Write-Log "Menu show -> ShowWindow"
    })

    # 菜单：退出
    $exitItem.Add_Click({
        Write-Log "Menu exit -> killing node pid $nodePid"
        $notifyIcon.Visible = $false
        try { Stop-Process -Id $nodePid -Force } catch {}
        [System.Windows.Forms.Application]::Exit()
    })

    Write-Log "Tray icon created, entering message loop"

    # 监控 node 进程，退出时清理托盘图标
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 2000
    $timer.Add_Tick({
        try {
            $p = Get-Process -Id $nodePid -ErrorAction Stop
        } catch {
            Write-Log "Node process gone, cleaning up tray"
            $notifyIcon.Visible = $false
            [System.Windows.Forms.Application]::Exit()
        }
    })
    $timer.Start()

    [System.Windows.Forms.Application]::Run()
} catch {
    Write-Log ("EXCEPTION: " + $_.ToString())
}
`.trim();

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  nodeLog(`spawning tray powershell (pid=${process.pid})`);
  try {
    const child = require('child_process').spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-EncodedCommand', encoded,
    ], { stdio: 'ignore', detached: true, windowsHide: true });
    child.unref();
    child.on('error', (err) => nodeLog(`spawn error: ${err && err.message}`));
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

  // 双击 exe 启动时自动隐藏到系统托盘。从命令行 / --visible 时不动。
  if (!opts.visible) {
    // 稍等一下让 banner 有机会绘制完再隐藏
    setTimeout(tryMinimizeToTray, 300);
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
  console.log('\n  NearbyShare 已启动\n');
  console.log('  其它设备浏览器打开以下任一地址：');
  if (urls.length === 0) {
    console.log('    (未检测到局域网 IPv4，请检查网络)');
  } else {
    for (const { iface, url } of urls) {
      console.log(`    ${url}    [${iface}]`);
    }
  }
  console.log(`    http://localhost:${port}    [本机]`);
  console.log('\n  按 Ctrl+C 退出。\n');
}

main().catch((err) => {
  console.error('启动失败：', err.message);
  process.exit(1);
});
