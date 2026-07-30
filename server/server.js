'use strict';

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MEDIA_DIR = path.join(__dirname, 'media');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeFromName(name) {
  const ext = path.extname(name).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/**
 * 启动 HTTP + SSE 服务器。
 * @returns {Promise<{port:number, close:() => Promise<void>}>}
 */
function startServer({ port = 3000, host = '0.0.0.0', store, maxFileSize = 500 * 1024 * 1024, log = () => {} }) {
  return new Promise((resolve, reject) => {
    const sseClients = new Set();

    // 转发 store 事件到所有 SSE 客户端
    const onEvent = (evt) => {
      const line = `data: ${JSON.stringify(evt)}\n\n`;
      for (const client of sseClients) {
        try { client.write(line); } catch (_) { /* ignore */ }
      }
    };
    store.on('event', onEvent);

    const server = http.createServer(async (req, res) => {
      try {
        await route(req, res, { store, sseClients, maxFileSize, log });
      } catch (err) {
        log(`[error] ${req.method} ${req.url}: ${err.stack || err}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'internal error' }));
        }
      }
    });

    let attempts = 0;
    const tryListen = (p) => {
      const onError = (err) => {
        if (err && err.code === 'EADDRINUSE' && attempts < 20) {
          attempts++;
          server.removeListener('error', onError);
          tryListen(p + 1);
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.removeListener('error', onError);
        server.on('error', (e) => log(`[server error] ${e.message}`));
        log(`listening on ${host}:${p}`);
        resolve({
          port: p,
          server,
          close: () => new Promise((r) => {
            store.removeListener('event', onEvent);
            for (const c of sseClients) { try { c.end(); } catch (_) {} }
            sseClients.clear();
            server.close(() => r());
          }),
        });
      });
    };
    tryListen(port);
  });
}

async function route(req, res, ctx) {
  // 允许扩展与其它设备跨源访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-NearbyShare-Name, X-NearbyShare-Id');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;
  const method = req.method;

  // 静态页面（供其它设备的浏览器访问）
  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    return serveStatic(res, path.join(MEDIA_DIR, 'client.html'));
  }
  if (method === 'GET' && /^\/(client\.js|style\.css|favicon\.svg)$/.test(p)) {
    return serveStatic(res, path.join(MEDIA_DIR, p.slice(1)));
  }

  // 健康检查（扩展会用来判断服务是否在线，同时下发局域网 URL 供 popup 显示）
  if (method === 'GET' && p === '/api/ping') {
    const port = req.socket.localPort;
    return sendJson(res, 200, {
      ok: true,
      version: 1,
      name: 'nearby-share',
      port,
      lanUrls: getLanUrls(port),
    });
  }

  // 拉取整个状态
  if (method === 'GET' && p === '/api/state') {
    return sendJson(res, 200, ctx.store.getSnapshot());
  }

  // SSE 实时推送
  if (method === 'GET' && p === '/api/events') {
    return handleSSE(req, res, ctx);
  }

  // 注册/心跳
  if (method === 'POST' && p === '/api/register') {
    const body = await readJson(req).catch(() => ({}));
    const dev = ctx.store.registerDevice({
      id: body.id || crypto.randomBytes(6).toString('hex'),
      name: body.name || 'Device',
      userAgent: req.headers['user-agent'] || '',
      ip: clientIp(req),
    });
    return sendJson(res, 200, dev);
  }

  // 发送文本消息
  if (method === 'POST' && p === '/api/message') {
    const body = await readJson(req);
    if (!body || typeof body.text !== 'string' || !body.text.trim()) {
      return sendJson(res, 400, { error: 'text required' });
    }
    const msg = ctx.store.addMessage({
      sender: body.sender,
      senderId: body.senderId,
      text: body.text,
    });
    return sendJson(res, 200, msg);
  }

  // 上传文件（原始字节流，元数据在 query）
  if (method === 'POST' && p === '/api/upload') {
    return handleUpload(req, res, ctx, parsed.query);
  }

  // 下载 / 预览
  if (method === 'GET' && p.startsWith('/api/files/')) {
    return handleDownload(req, res, ctx, p, parsed.query);
  }

  // 删除文件
  if (method === 'DELETE' && p.startsWith('/api/files/')) {
    const id = p.split('/').pop();
    const ok = ctx.store.removeFile(id);
    return sendJson(res, ok ? 200 : 404, { ok });
  }

  // 删除文字消息
  if (method === 'DELETE' && p.startsWith('/api/messages/')) {
    const id = p.split('/').pop();
    const ok = ctx.store.removeMessage(id);
    return sendJson(res, ok ? 200 : 404, { ok });
  }

  // 清空
  if (method === 'POST' && p === '/api/clear') {
    ctx.store.clearAll();
    return sendJson(res, 200, { ok: true });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeFromName(filePath),
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > 1_000_000) throw new Error('body too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function handleSSE(req, res, ctx) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  // 首帧下发全部状态
  res.write(`event: snapshot\ndata: ${JSON.stringify(ctx.store.getSnapshot())}\n\n`);
  ctx.sseClients.add(res);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25_000);

  const cleanup = () => {
    clearInterval(ping);
    ctx.sseClients.delete(res);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

function handleUpload(req, res, ctx, query) {
  const name = decodeURIComponent(query.name || 'file');
  const sender = decodeURIComponent(query.sender || 'Anonymous');
  const senderId = decodeURIComponent(query.senderId || '');

  const declared = Number(req.headers['content-length'] || 0);
  if (declared && declared > ctx.maxFileSize) {
    return sendJson(res, 413, { error: 'file too large' });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const safeExt = path.extname(name).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
  const savePath = path.join(ctx.store.uploadDir, `${id}${safeExt}`);
  const ws = fs.createWriteStream(savePath);

  let received = 0;
  let aborted = false;

  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > ctx.maxFileSize) {
      aborted = true;
      req.destroy();
      ws.destroy();
      fs.unlink(savePath, () => {});
      if (!res.headersSent) sendJson(res, 413, { error: 'file too large' });
    }
  });

  req.pipe(ws);

  ws.on('finish', () => {
    if (aborted) return;
    const rec = ctx.store.addFile({
      id,
      name,
      sender,
      senderId,
      size: received,
      mime: mimeFromName(name),
      path: savePath,
    });
    sendJson(res, 200, rec);
  });

  ws.on('error', (err) => {
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
  });
}

function handleDownload(req, res, ctx, pathname, query) {
  const id = pathname.split('/').pop();
  const file = ctx.store.getFile(id);
  if (!file) {
    res.writeHead(404); res.end('Not found'); return;
  }
  fs.stat(file.path, (err, stat) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const disposition = query.download === '1' ? 'attachment' : 'inline';
    const range = req.headers.range;
    // 支持 Range 便于视频/大文件预览
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (start < stat.size && end < stat.size) {
          res.writeHead(206, {
            'Content-Type': file.mime,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          });
          fs.createReadStream(file.path, { start, end }).pipe(res);
          return;
        }
      }
    }
    res.writeHead(200, {
      'Content-Type': file.mime,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file.path).pipe(res);
  });
}

/**
 * 收集机器上适合被同一局域网内其它设备访问的 URL。
 *
 * 过滤规则：
 *   - IPv4 且非 loopback
 *   - 剔除 link-local (169.254.x.x)：Windows 拿不到 DHCP 时的应急地址，永远不通
 *   - 剔除虚拟适配器（VMware / VirtualBox / WSL / Hyper-V / Docker / 蓝牙 / 环回等）
 *
 * 如果过滤后为空（例如用户全靠虚拟网络），回退返回未过滤的完整列表，
 * 避免因过度过滤而让用户什么都看不到。
 */
function getLanUrls(port) {
  const os = require('os');
  const nets = os.networkInterfaces();

  // 接口名黑名单（大小写不敏感的子串匹配）。命中即视为虚拟/无用。
  const VIRTUAL_IFACE = /(v ?ethernet|vmware|virtual|vmnet|vbox|virtualbox|tap-|tun\d|docker|hyper.?v|wsl|npcap|loopback|bluetooth|pseudo|teredo|isatap|tailscale|zerotier|utun|awdl|llw|anpi|ipsec)/i;

  const kept = [];
  const dropped = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue;
      const entry = { iface: name, url: `http://${net.address}:${port}`, ip: net.address };
      if (VIRTUAL_IFACE.test(name)) dropped.push(entry);
      else kept.push(entry);
    }
  }
  // 保底：全被过滤时就返回原始的（除了 link-local）
  return kept.length > 0 ? kept : dropped;
}

module.exports = { startServer, getLanUrls, mimeFromName };
