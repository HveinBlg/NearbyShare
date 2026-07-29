# NearbyShare 托盘版本（Windows）

一套 3 个文件的组合，替代黑窗口版：

| 文件 | 作用 |
|---|---|
| `nearby-share-win32-x64.exe` | 服务器本体（跟原来一样） |
| `nearby-share-tray.ps1` | 托盘脚本 —— WinForms 系统托盘 |
| `nearby-share-tray.vbs` | 启动器 —— 隐藏运行 PowerShell |

## 使用

1. 从 [Releases](https://github.com/HveinBlg/NearbyShare/releases) 下载全部 3 个文件到**同一个文件夹**（比如 `C:\Users\你\NearbyShare\`）
2. 双击 **`nearby-share-tray.vbs`**（不是 exe，也不是 ps1）
3. 系统托盘（右下角，可能要点向上小箭头展开）会出现 NearbyShare 图标
4. **右键图标**：
   - 打开面板 —— 浏览器打开 http://localhost:3000
   - 复制局域网地址 —— 一键复制手机能访问的 URL
   - 开机自启 —— 勾上后开机自动运行
   - 退出 —— 关闭托盘并杀掉服务器
5. **双击图标**：直接打开 Web 面板

## 与"直接双击 exe"的对比

|  | 双击 exe | 双击 vbs（托盘版） |
|---|---|---|
| 黑窗口 | 有 | 无 |
| 关闭方式 | 关窗口 or Ctrl+C | 右键 → 退出 |
| 开机自启 | 手动操作启动文件夹 | 菜单里勾一下 |
| 复制 LAN URL | 看窗口自己抄 | 一键复制到剪贴板 |
| 依赖 | 无 | Windows 自带 PowerShell（Win7+ 都有） |

## 常见问题

**Q：脚本被 Windows Defender 或杀毒软件拦？**
A：`.vbs` + `.ps1` 组合有时会被误报。可以把这 3 个文件加入白名单，或者不用托盘版直接双击 exe。

**Q：无法运行 PowerShell 脚本？**
A：本 vbs 用 `-ExecutionPolicy Bypass` 绕过策略，不需要你改系统设置。如果还是不行，说明企业环境有组策略强制禁用 PowerShell，那只能用 exe 版。

**Q：开机自启后每次开机弹一大堆通知？**
A：默认启动时会显示一条通知告诉你 LAN URL。如果嫌烦，可以编辑 `nearby-share-tray.ps1` 把 "启动完成通知" 那一段注释掉。

**Q：想要 macOS / Linux 版本？**
A：目前只做了 Windows 托盘。macOS 用户建议装 `nearby-share-darwin-arm64.dmg`（有 .app 双击打开）；Linux 用户可以用 systemd 或 `nohup` 后台跑。
