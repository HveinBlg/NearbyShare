// 自终止测试：起 bundled server，测所有静态路径，然后退出
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const bundlePath = path.join(__dirname, 'dist', 'nearby-share-bundled.js');
const PORT = 4488;

const child = spawn(process.execPath, [bundlePath, '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_OPTIONS: '' },
});
let stderr = '';
child.stderr.on('data', d => stderr += d);
child.stdout.on('data', () => {});

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        ctype: res.headers['content-type'],
        body: Buffer.concat(chunks),
      }));
    }).on('error', reject);
  });
}

setTimeout(async () => {
  try {
    for (const p of ['/', '/index.html', '/client.js', '/style.css', '/favicon.svg', '/api/ping']) {
      const r = await get(p);
      const preview = r.body.slice(0, 40).toString('utf8').replace(/\n/g, ' ');
      console.log(`GET ${p.padEnd(20)} → HTTP ${r.status}  ${r.body.length}B  ${r.ctype}  "${preview}..."`);
    }
  } catch (e) {
    console.error('test err:', e.message);
    if (stderr) console.error('server stderr:', stderr);
  }
  child.kill();
  setTimeout(() => process.exit(0), 200);
}, 600);
