# NearbyShare

局域网内多设备互传文字、图片、文件的轻量工具。

- **浏览器扩展** 装在电脑的 Chrome / Edge / 其它 Chromium 浏览器
- **本地伴生服务器**（一个可执行文件或 Node 脚本）在电脑上开一个 HTTP 端口
- **其它设备**（手机 / 平板 / 另一台电脑）用浏览器打开 `http://<电脑IP>:3000` 即可互传，无需安装任何东西

零依赖、零云端、内网直连。

---

## 为什么是"扩展 + 伴生程序"两部分

浏览器扩展（MV3）没有权限监听 TCP 端口 —— 这是浏览器的硬性沙箱限制。因此"其它设备用 IP 访问"必须由本地伴生程序提供 HTTP 服务。

两部分职责：

| 组件 | 装在哪 | 作用 |
|---|---|---|
| 浏览器扩展 | 电脑上的 Chrome/Edge | 弹窗 UI、右键菜单（选中文字/图片/链接 → 发送）、快捷键 |
| 本地伴生服务器 | 电脑（一个可执行文件） | 监听端口、存储消息与文件、给其它设备提供 Web UI |
| 其它设备 | 手机/平板/别的电脑 | 浏览器打开 `http://电脑IP:端口` 即可 |

---

## 安装

### 第一步：装浏览器扩展

**方式 A — 从源码侧载（推荐开发者）**

1. 打开 Chrome / Edge，访问 `chrome://extensions`
2. 打开右上角"开发者模式"
3. 点"加载已解压的扩展程序" → 选 `extension/` 目录

**方式 B — 从 zip 安装**

1. 下载 `nearby-share-extension.zip`（Releases 页面）
2. 解压
3. 按方式 A 加载解压目录

### 第二步：装本地伴生服务器（三选一）

**方式 1（傻瓜式）：下载可执行文件双击运行**

到 GitHub Releases 页面下载对应系统的可执行文件：

| 平台 | 文件 | 使用 |
|---|---|---|
| Windows | `nearby-share-win32-x64.exe` | 双击运行 |
| macOS (M1/M2/M3/M4) | `nearby-share-darwin-arm64` | `chmod +x` 后双击。首次运行如被 Gatekeeper 拦截，在"系统设置 → 隐私与安全性"点"仍要打开" |
| Linux | `nearby-share-linux-x64` | `chmod +x nearby-share-linux-x64 && ./nearby-share-linux-x64` |

不需要安装 Node.js。

> **老 Intel Mac 用户**：GitHub 已于 2025 年 12 月下线免费的 macOS Intel runner，CI 无法产出 `darwin-x64` 二进制。请下载源码后跑 `node server/bin.js`（需要装 Node.js）。

**方式 2：用 npm 全局安装（有 Node.js 环境）**

```bash
npm install -g nearby-share
nearby-share
```

**方式 3：直接跑源码**

```bash
git clone <本仓库>
cd nearby-share
node server/bin.js
```

服务器启动后会打印类似：

```
╔════════════════════════════════════════════════════╗
║  NearbyShare 已启动                                   ║
╠════════════════════════════════════════════════════╣
║  其它设备浏览器打开以下任一地址：                   ║
║    http://192.168.1.42:3000   [Wi-Fi]              ║
║    http://localhost:3000      [本机]                ║
╚════════════════════════════════════════════════════╝
```

---

## 使用

1. **在电脑上启动伴生程序**（前一步已完成）
2. **在浏览器点扩展图标** → 看到"已连接到本地服务"即可
3. **在其它设备的浏览器** 输入电脑显示的 `http://192.168.x.x:3000` → 打开 Web UI
4. 现在双向互传：
   - 在电脑扩展弹窗里输入文字/拖文件 → 手机秒收
   - 在手机 Web UI 里拖图片/粘贴/输入 → 电脑秒收
   - 电脑右键选中文字 → "发送选中文字到局域网" → 手机秒收

### 扩展功能

- 弹窗：文字输入 + 文件选择 + 最近记录
- 右键菜单：
  - 选中文字 → 发送选中文字到局域网
  - 链接 → 发送链接
  - 图片 → 发送图片（会下载后上传）
  - 页面空白 → 发送当前页面链接
- 快捷键：`Alt+Shift+L` 打开弹窗

### Web UI 功能

- 实时文字聊天
- 拖放上传 / 点击上传 / 粘贴上传（Ctrl+V 粘贴截图直接发）
- 图片、视频内联预览
- 大文件分块下载（Range 请求）
- 明暗色主题跟随系统
- iOS 安全区适配

### 国际化 / i18n

扩展 UI 内置英文（默认回退）+ 简体中文。字符串来自 `extension/_locales/<lang>/messages.json`，通过 `chrome.i18n.getMessage()` / `data-i18n` 属性注入到界面。

新增语言步骤：

1. 复制 `extension/_locales/en/` 到 `extension/_locales/<你的语言代码>/`（例如 `ja` / `de` / `fr` / `ko`）
2. 编辑 `messages.json` 里各 `message` 字段
3. 重新加载扩展，用户在浏览器语言设置成对应语言即会自动生效

Web UI（其它设备浏览器访问）目前只有中文界面，将来可比照上面思路做多语言。

---

## 命令行参数

```
node server/bin.js [选项]

选项：
  -p, --port <n>     监听端口（默认 3000，被占用自动 +1）
  --dir <path>       上传文件保存目录（默认 ~/.nearby-share/uploads）
  --max-mb <n>       单文件最大 MB（默认 500）
  --name <name>      本机在设备列表中显示的名称
  -h, --help         帮助
```

---

## 目录结构

```
nearby-share/
├── extension/                     # 浏览器扩展 (MV3)
│   ├── manifest.json
│   ├── background.js              # service worker
│   ├── popup.html/.css/.js        # 工具栏弹窗
│   ├── options.html/.js           # 设置页
│   └── icons/                     # 4 个尺寸的 PNG
│       └── generate.js            # 无依赖生成图标（可自定义颜色）
├── server/                        # 本地伴生服务器（零依赖）
│   ├── bin.js                     # CLI 入口
│   ├── server.js                  # HTTP + SSE 主逻辑
│   ├── store.js                   # 内存 store
│   └── media/                     # 其它设备访问的 Web UI
│       ├── client.html/.js/.css
│       └── favicon.svg
├── scripts/
│   ├── bundle.js                  # 打包 server 为单文件
│   ├── build-sea.js               # 打包 SEA 可执行文件
│   └── package-extension.js       # 打包扩展为 zip
├── .github/workflows/release.yml  # tag 触发 CI 自动出各平台 Release
├── selftest.js                    # API 自测（20 项断言）
├── selftest-bundle.js             # bundle 版本冒烟测试
└── package.json
```

---

## API 一览（供第三方集成）

服务器路由都在 `/api/*`：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 健康检查（扩展探测用） |
| GET | `/api/state` | 拉取全量状态 `{messages, files, devices}` |
| GET | `/api/events` | SSE 事件流（`snapshot` / `message` / `file-added` / `file-removed` / `devices` / `cleared`） |
| POST | `/api/register` | `{id, name}` 注册/心跳 |
| POST | `/api/message` | `{text, sender, senderId}` 发文字 |
| POST | `/api/upload?name=&sender=&senderId=` | 请求体 = 文件原始字节 |
| GET | `/api/files/<id>` | 内联查看（图片/视频可用作 `<img src>`） |
| GET | `/api/files/<id>?download=1` | 强制下载 |
| DELETE | `/api/files/<id>` | 删除 |
| POST | `/api/clear` | 清空全部 |

所有响应都开了 `Access-Control-Allow-Origin: *`，方便扩展和别的工具调用。

---

## 开发

```bash
# 拉源码
git clone <此仓库>
cd nearby-share

# 跑服务器（默认 :3000）
node server/bin.js

# 跑自测
node selftest.js

# 重新生成图标（可以先改 extension/icons/generate.js 里的颜色）
node extension/icons/generate.js

# 打包 bundle（单文件，用于发布）
node scripts/bundle.js

# 打包扩展 zip
node scripts/package-extension.js

# 打包当前平台的 SEA 可执行文件（需要网络访问 npm 拿 postject）
node scripts/build-sea.js
```

打 tag 触发 CI 自动出 Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

`.github/workflows/release.yml` 会在 Ubuntu / macOS(arm64) / macOS(x64) / Windows 四台机器上并行构建，产物自动附到 GitHub Release。

---

## 安全说明

- 服务默认监听 `0.0.0.0`，**同一局域网内所有设备都能访问**，不设密码。请只在信任的网络（家里/办公室）使用。
- 文件默认存到 `~/.nearby-share/uploads`，进程退出后不清理，请自行管理。
- 消息记录仅存在服务器内存中，进程重启即丢失。
- 没有 TLS。要 HTTPS 请自行加反向代理（Nginx / Caddy）。

---

## 常见问题

**Q: 手机连不上电脑 IP？**
A: 三种可能：(1) 电脑防火墙拦截了端口，Windows 弹允许框时点"允许"；(2) 电脑和手机不在同一 Wi-Fi；(3) 无线路由启用了"AP 隔离"。

**Q: 扩展提示"服务未启动"？**
A: 检查伴生程序是否在跑；检查扩展设置里的服务地址是否与实际一致（默认 `http://localhost:3000`）。

**Q: 想改端口？**
A: 启动时加 `--port 8080`，然后到扩展设置里同步改成 `http://localhost:8080`。

**Q: iPhone 通过 IP 打开地址会不会因为 HTTP 被拦？**
A: Safari / Chrome 手机版访问 `http://局域网IP` 是允许的。Safari 有时候会强制升级 https，遇到时手动打完整地址。

**Q: 支持 Firefox 吗？**
A: manifest V3 在 Firefox 已 GA，只是 API 略有差异。当前 manifest 主要针对 Chromium 家族测试。Firefox 兼容性看后续。

---

## License

MIT
