# NearbyShare 项目总结

> 局域网多设备互传工具 · 浏览器扩展 + 本地伴生服务器 · 零依赖
> GitHub: https://github.com/HveinBlg/NearbyShare

---

## 一、项目概述

NearbyShare 是一个**局域网内多设备实时互传文字、图片、文件**的工具，类似 AirDrop / LocalSend，但采用「浏览器扩展 + 本地伴生服务器」架构，最大特点是**接收端零安装**——手机/平板用浏览器打开地址即可收发。

### 核心卖点
- **手机零安装** —— 浏览器打开即用
- **零依赖** —— 服务器仅用 Node.js 内置模块
- **零云端** —— 数据完全在局域网内，不经过互联网
- **零压缩** —— 图片保持原画质
- **实时同步** —— 基于 SSE 即时推送
- **跨平台** —— Windows / macOS / Linux / iOS / Android

---

## 二、技术架构

```
┌──────────────────┐     HTTP (localhost)     ┌──────────────────────┐
│  Chrome/Edge 扩展 │ ◄──────────────────────► │  本地 Node.js 服务器   │
│  (popup + 右键菜单) │                          │  (HTTP + SSE)          │
└──────────────────┘                          └──────────┬───────────┘
                                                         │  HTTP (LAN IP:3000)
                                                         ▼
                                              ┌──────────────────────┐
                                              │  其他设备（手机/平板等）  │
                                              │  浏览器打开 Web UI 即可 │
                                              └──────────────────────┘
```

| 组件 | 路径 | 说明 |
|------|------|------|
| 本地服务器 | `server/` | HTTP + SSE 服务，管理消息/文件/设备，提供 Web UI |
| 浏览器扩展 | `extension/` | Chrome/Edge MV3 扩展，弹窗 UI、右键菜单、快捷键 |
| 构建脚本 | `scripts/` | 打包单文件 → SEA 可执行程序 → macOS DMG → 扩展 zip |
| Web UI | `server/media/` | 给其他设备用的网页界面 |

### 技术栈
- **运行时**：Node.js 18+（零外部依赖）
- **实时通信**：Server-Sent Events (SSE)
- **扩展**：Chrome Extension Manifest V3
- **打包**：Node.js 20 SEA（单可执行程序）
- **CI/CD**：GitHub Actions，多平台自动构建发布

---

## 三、本次完成的工作

### 1. 修复 macOS DMG 构建失败（CI）
- **问题**：`hdiutil create` 在 GitHub Actions macOS runner 上因 "Resource busy"（Spotlight/fsevents 索引 .app）静默失败，退出码 1。
- **修复**：
  - 为 `hdiutil create` 添加 `sync` + 重试逻辑（最多 4 次，递增等待 5/10/15/20 秒）
  - 为 `iconutil` 添加 `sips` fallback（部分 macOS 对代码生成的 PNG 校验更严格）
  - workflow 中 codesign 与 DMG 构建之间加 `sleep 3` 让文件系统稳定

### 2. 控制台输出优化
- 移除 banner 中的双线边框（`╔╗╠╣╚╝║`），改为简洁纯文本输出

### 3. Windows 系统托盘最小化
- **问题**：原方案只能最小化到任务栏，且 `detached + windowsHide` 导致 PowerShell 拿不到父进程控制台句柄
- **修复**：改用 `SW_HIDE` 完全隐藏窗口 + `NotifyIcon` 系统托盘图标；通过检测 node 父进程是否为 `explorer.exe` 判断双击启动；托盘图标双击恢复窗口、右键菜单可退出

### 4. Web UI 输入框竖线修复
- **问题**：输入文字后 textarea 右侧出现滚动条竖线
- **修复**：`scrollbar-width: none` + `::-webkit-scrollbar { display: none }` 始终隐藏滚动条（保留滚动功能）

### 5. Git 历史清理
- 将全部提交的 author 和 committer 统一改为 `HveinBlg <62872424+HveinBlg@users.noreply.github.com>`
- 移除 `kiro-agent` 贡献者，清理所有已合并的旧功能分支

### 6. 应用商店上架准备
- **修复 `host_permissions`**：Chrome 商店不支持 CIDR 格式（`192.168.0.0/16`），改为通配符格式（`http://192.168.*.*/*`）
- **添加隐私政策** `PRIVACY.md`（商店审核必需）
- 准备了各权限的申请理由、商店中英文描述、审核员测试说明
- 生成了商店所需的宣传图（1280×800 / 640×400 / 1400×560 / 440×280）
  - 英文版 PNG 用 cairo 直接生成
  - 中文版做成 Canvas 网页生成器 `store-assets/generate-cn.html`（浏览器一键下载精确尺寸 PNG）

### 7. 引流博客
- 撰写了一篇面向掘金/CSDN/知乎等平台的引流文章 `blog-post.md`

---

## 四、遇到的问题与解决方案（踩坑记录）

### 问题 1：macOS DMG 构建在 CI 上失败，退出码 1
- **现象**：GitHub Actions macOS 构建报错，`build-mac-dmg.js:235` 的 `hdiutil create` 失败，stderr 为空，退出码 1。
- **原因**：codesign 后 macOS 的 Spotlight / fsevents 仍在索引 `.app`，导致 hdiutil 遇到 "Resource busy"。
- **解决**：`hdiutil create` 前加 `sync`，并加入最多 4 次重试（递增等待 5/10/15/20 秒）；`iconutil` 加 `sips` fallback；workflow 里 codesign 与打包之间加 `sleep 3`。

### 问题 2：控制台窗口显示难看的边框竖线
- **现象**：启动时 banner 用了 `╔╗║╚╝` 画框，实际显示错位、有多余竖线。
- **解决**：移除边框字符，改为简洁的纯文本缩进输出。

### 问题 3：Windows 双击 exe 后窗口没有隐藏到系统托盘
- **现象**：程序只最小化到任务栏，没有进系统托盘（右下角）。
- **原因**：PowerShell 用 `detached: true, windowsHide: true` 启动，分配了独立的隐藏控制台，`GetConsoleWindow()` 拿不到父进程（Node）的窗口句柄，`ShowWindow` 无效。
- **解决**：去掉 `detached / windowsHide` 让 PS 继承 Node 控制台；用 `SW_HIDE` 完全隐藏窗口 + `NotifyIcon` 创建托盘图标；用「node 父进程是否为 explorer.exe」判断是否双击启动（比 `GetConsoleProcessList` 计数可靠）。

### 问题 4：Web UI 输入框输入文字后右侧出现竖线
- **现象**：在 textarea 输入后右边出现一条竖线。
- **原因**：那是 textarea 的垂直滚动条；原本只在 `:not(:focus)` 时隐藏，但输入时是 focus 状态所以又出现。
- **解决**：`scrollbar-width: none`（Firefox）+ `::-webkit-scrollbar { display: none }`（Chromium）**始终**隐藏滚动条，同时保留滚动功能。

### 问题 5：贡献者列表出现 kiro-agent
- **现象**：GitHub 仓库贡献者里除了本人还有 `kiro-agent`。
- **原因**：部分提交的 author / committer 是自动化推送工具配置的 kiro-agent 身份。
- **解决**：用 `git filter-branch` 把 main 全部 35 个提交的 author 和 committer 统一改为本人；强制更新 main；删除所有残留的旧功能分支。贡献者列表因 GitHub 缓存会在数小时内自动更新。

### 问题 6：Chrome 商店拒绝 host_permissions 的 CIDR 格式
- **现象**：manifest 里用了 `192.168.0.0/16` 这类 CIDR 写法。
- **原因**：Chrome Web Store 的 match pattern 不支持 CIDR。
- **解决**：改为通配符格式 `http://192.168.*.*/*`、`http://10.*.*.*/*`、`http://172.16-31.*.*/*`（逐段列出）。

### 问题 7：沙箱环境无法生成中文宣传图
- **现象**：协作环境（Linux 沙箱）没有中文字体、也无法联网下载字体，渲染中文变方框。
- **解决**：英文版用 cairo 直接生成 PNG；中文版改做成 **Canvas 网页生成器**（`generate-cn.html`），在用户本地浏览器（自带中文字体）一键下载精确尺寸 PNG，顺便解决了 DevTools 截图尺寸/DPR 的困扰。

---

## 五、商业化方向（已讨论）

**个人免费 + 企业付费** 的 SaaS 模式：

| 功能 | 个人免费版 | 企业版（付费） |
|------|-----------|---------------|
| 局域网互传 | ✅ | ✅ |
| 远程 P2P 传输 | 1v1 | 多人 |
| 团队管理 / 权限控制 | ❌ | ✅ |
| 文件审计日志 | ❌ | ✅ |
| SSO / 私有部署 | ❌ | ✅ |

- **企业版卖点**：合规、可审计、可控、私有部署
- **定价参考**：团队版 ¥15-30/人/月，企业版 ¥50-100/人/月或年费定制

---

## 六、后续待办（下个版本）

- [ ] **二维码扫码**：服务器启动时显示二维码，手机扫码直接打开（已有 `shared/qrcode.js` 零依赖 QR 生成骨架）
- [ ] **远程 P2P 传输**：WebRTC DataChannel + 轻量信令服务器（已有 `signal-server/` 和 `shared/rtc.js` 骨架）
- [ ] **商店正式上架**：Chrome Web Store（$5 注册费）+ Microsoft Edge Add-ons（免费）
- [ ] **企业版功能**：账号系统、团队空间、管理后台、审计日志

---

## 七、发布与使用

### 开发运行
```bash
node server/bin.js          # 启动服务
node selftest.js            # 运行自测
```

### 构建
```bash
node scripts/bundle.js            # 打包单文件
node scripts/build-sea.js         # 构建可执行程序
node scripts/build-mac-dmg.js     # macOS DMG（仅 macOS）
node scripts/package-extension.js # 打包扩展 zip
```

### 发布
- 打 tag（如 `v1.0.1`）触发 GitHub Actions 自动多平台构建并创建 Release
- 用户从 Releases 页面下载对应平台的可执行文件

---

*本文档由本次协作整理，记录项目现状与后续规划。*
