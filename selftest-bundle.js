'use strict';
/**
 * 针对 dist/nearby-share-bundled.js 单文件版本做冒烟测试。
 * 启动 bundle → 调 API → 关闭。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const BUNDLE = path.join(__dirname, 'dist', 'nearby-share-bundled.js');
const PORT = 4001;

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}
function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.write(body); r.end();
  });
}

const child = spawn(process.execPath, [BUNDLE, '--port', String(PORT), '--dir', '/tmp'], {
  env: { ...process.env, NODE_OPTIONS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });

async function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    console.error('server output:', out);
    child.kill();
    process.exit(1);
  }
  console.log('OK  ', msg);
}

setTimeout(async () => {
  try {
    const ping = await get('/api/ping');
    await assert(ping.status === 200 && JSON.parse(ping.body).ok, 'bundled ping');

    const home = await get('/');
    await assert(home.status === 200 && home.body.includes('NearbyShare') && home.body.includes('<link rel="stylesheet" href="/style.css">'), 'bundled 首页含 HTML');

    const css = await get('/style.css');
    await assert(css.status === 200 && css.body.includes('composer'), 'bundled style.css 从内联加载');

    const js = await get('/client.js');
    await assert(js.status === 200 && js.body.includes('EventSource'), 'bundled client.js 从内联加载');

    const m = await post('/api/message', JSON.stringify({ text: 'via bundle', sender: 't', senderId: 'x' }));
    await assert(m.status === 200, 'bundled 发消息');

    console.log('bundle 冒烟测试通过');
    child.kill();
    setTimeout(() => process.exit(0), 200);
  } catch (err) {
    console.error(err); console.error(out); child.kill(); process.exit(1);
  }
}, 700);
