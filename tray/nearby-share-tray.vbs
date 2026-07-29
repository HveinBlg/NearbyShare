' NearbyShare 托盘启动器（Windows）
' 双击本文件 -> 后台隐藏启动 PowerShell 托盘脚本 -> 出现系统托盘图标
'
' 前提：本文件与 nearby-share-tray.ps1 和 nearby-share-win32-x64.exe
'       必须放在同一个文件夹里。

Option Explicit

Dim fso, shell, scriptDir, psScript, cmd

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript  = scriptDir & "\nearby-share-tray.ps1"

If Not fso.FileExists(psScript) Then
    MsgBox "找不到 nearby-share-tray.ps1，请确认它与本 .vbs 在同一个文件夹。" & _
           vbCrLf & vbCrLf & "查找路径：" & psScript, _
           vbCritical, "NearbyShare"
    WScript.Quit 1
End If

' 用 PowerShell 静默运行托盘脚本
' -NoProfile          跳过用户 profile，加快启动
' -ExecutionPolicy Bypass  暂时绕过脚本策略（不改系统设置）
' -WindowStyle Hidden 隐藏 PowerShell 主窗口
' 0 = SW_HIDE         WScript.Shell.Run 的窗口显示参数
' False               不等待子进程退出（异步）
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & _
      psScript & """"

shell.Run cmd, 0, False
