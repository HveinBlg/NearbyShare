<#
NearbyShare 系统托盘脚本（Windows）

功能：
  - 隐藏启动 nearby-share-win32-x64.exe（服务器）
  - 在系统托盘显示一个图标
  - 右键菜单：打开面板 / 复制局域网 URL / 开机自启 / 退出
  - 双击托盘图标打开 Web 面板
  - 退出时自动杀掉服务器进程

不要直接双击运行此 .ps1（会弹 PowerShell 窗口）。
请使用同目录下的 nearby-share-tray.vbs 静默启动。

要求：Windows 10/11，PowerShell 5+ 或 7+（系统自带）。
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ScriptDir  = Split-Path -Parent $PSCommandPath
$ServerExe  = Join-Path $ScriptDir 'nearby-share-win32-x64.exe'
$ServerBase = 'http://localhost:3000'

# -------- 找到服务器可执行文件 --------
if (-not (Test-Path $ServerExe)) {
    [System.Windows.Forms.MessageBox]::Show(
        "找不到 nearby-share-win32-x64.exe`n`n请把它跟本脚本放在同一个文件夹里。`n查找路径：$ServerExe",
        'NearbyShare',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}

# -------- 启动服务器（隐藏窗口）--------
function Start-Server {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName         = $ServerExe
    $psi.WorkingDirectory = $ScriptDir
    $psi.WindowStyle      = 'Hidden'
    $psi.CreateNoWindow   = $true
    $psi.UseShellExecute  = $false
    return [System.Diagnostics.Process]::Start($psi)
}
$Server = Start-Server

# -------- 从 /api/ping 拿真实局域网 URL --------
function Get-LanUrl {
    try {
        $r = Invoke-RestMethod -Uri "$ServerBase/api/ping" -TimeoutSec 2
        if ($r.lanUrls -and $r.lanUrls.Count -gt 0) {
            return $r.lanUrls[0].url
        }
    } catch {}
    return $null
}

# -------- 托盘图标 --------
# 用服务器 exe 自带图标（暂时是 Node.js 默认图标；后续可换成定制 .ico）
$Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ServerExe)

$Notify = New-Object System.Windows.Forms.NotifyIcon
$Notify.Icon    = $Icon
$Notify.Text    = 'NearbyShare'
$Notify.Visible = $true

# -------- 右键菜单 --------
$Menu = New-Object System.Windows.Forms.ContextMenuStrip

# 打开 Web 面板
$OpenItem = $Menu.Items.Add('打开面板')
$OpenItem.add_Click({ Start-Process $ServerBase | Out-Null })

# 复制局域网地址
$CopyItem = $Menu.Items.Add('复制局域网地址')
$CopyItem.add_Click({
    $url = Get-LanUrl
    if ($url) {
        [System.Windows.Forms.Clipboard]::SetText($url)
        $Notify.ShowBalloonTip(2500, 'NearbyShare', "已复制：`n$url", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
        $Notify.ShowBalloonTip(2500, 'NearbyShare', '未找到可用的局域网地址（未检测到 Wi-Fi）',
            [System.Windows.Forms.ToolTipIcon]::Warning)
    }
})

$Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 开机自启（在启动文件夹里创建/删除 .lnk 指向本 .vbs）
$StartupFolder = [Environment]::GetFolderPath('Startup')
$StartupLink   = Join-Path $StartupFolder 'NearbyShare Tray.lnk'
$VbsPath       = Join-Path $ScriptDir 'nearby-share-tray.vbs'

$AutoStartItem = New-Object System.Windows.Forms.ToolStripMenuItem '开机自启'
$AutoStartItem.CheckOnClick = $true
$AutoStartItem.Checked      = Test-Path $StartupLink
$AutoStartItem.add_CheckedChanged({
    try {
        if ($AutoStartItem.Checked) {
            if (-not (Test-Path $VbsPath)) {
                $Notify.ShowBalloonTip(2500, 'NearbyShare',
                    '找不到 nearby-share-tray.vbs，无法设置开机自启',
                    [System.Windows.Forms.ToolTipIcon]::Error)
                $AutoStartItem.Checked = $false
                return
            }
            $wsh = New-Object -ComObject WScript.Shell
            $sc  = $wsh.CreateShortcut($StartupLink)
            $sc.TargetPath       = $VbsPath
            $sc.WorkingDirectory = $ScriptDir
            $sc.Description      = 'NearbyShare 系统托盘'
            $sc.Save()
            $Notify.ShowBalloonTip(2000, 'NearbyShare', '已启用开机自启',
                [System.Windows.Forms.ToolTipIcon]::Info)
        } else {
            if (Test-Path $StartupLink) { Remove-Item $StartupLink -Force }
            $Notify.ShowBalloonTip(2000, 'NearbyShare', '已取消开机自启',
                [System.Windows.Forms.ToolTipIcon]::Info)
        }
    } catch {
        $Notify.ShowBalloonTip(2500, 'NearbyShare', "设置失败：$($_.Exception.Message)",
            [System.Windows.Forms.ToolTipIcon]::Error)
    }
})
$Menu.Items.Add($AutoStartItem) | Out-Null

$Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 退出：先杀服务器，再退托盘
$QuitItem = $Menu.Items.Add('退出')
$QuitItem.add_Click({
    try {
        if ($Server -and -not $Server.HasExited) { $Server.Kill() }
    } catch {}
    $Notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$Notify.ContextMenuStrip = $Menu

# 双击托盘图标 = 打开 Web 面板
$Notify.add_MouseDoubleClick({ Start-Process $ServerBase | Out-Null })

# -------- 启动完成通知 --------
Start-Sleep -Milliseconds 800
$initUrl = Get-LanUrl
if ($initUrl) {
    $Notify.ShowBalloonTip(3500, 'NearbyShare 已启动',
        "其它设备访问：`n$initUrl`n`n右键托盘图标查看更多操作。",
        [System.Windows.Forms.ToolTipIcon]::Info)
} else {
    $Notify.ShowBalloonTip(3500, 'NearbyShare 已启动',
        '服务器正在运行。右键托盘图标查看操作。',
        [System.Windows.Forms.ToolTipIcon]::Info)
}

# -------- 应用退出时清理服务器 --------
[System.Windows.Forms.Application]::add_ApplicationExit({
    try {
        if ($Server -and -not $Server.HasExited) { $Server.Kill() }
    } catch {}
    $Notify.Visible = $false
})

# 进入 Windows Forms 消息循环
[System.Windows.Forms.Application]::Run()
