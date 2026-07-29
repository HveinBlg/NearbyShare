'use strict';
/**
 * 自测：启动服务 → 调用所有 API → 断言 → 关闭。
 * 用法：node selftest.js
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { createStore } = require('./server/store');
const { startServer, getLanUrls } = require('./server/server');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nearby-share-'));
const store = createStore({ uploadDir });
store.registerDevice({ id: 'host', name: 'HostMachine', ip: '127.0.0.1' });

let PORT;
let handle;

function req(method, pathname, { body, headers, buffer } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buffer ? buf : buf.toString('utf8') });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('OK  ', msg);
}

(async () => {
  handle = await startServer({ port: 3999, host: '127.0.0.1', store, log: () => {} });
  PORT = handle.port;
  console.log('server up on', PORT);

  const ping = await req('GET', '/api/ping');
  assert(ping.status === 200 && JSON.parse(ping.body).ok, 'ping');

  const s0 = JSON.parse((await req('GET', '/api/state')).body);
  assert(s0.messages.length === 0 && s0.files.length === 0, '初始状态空');
  assert(s0.devices.length === 1, '初始只有 host');

  const reg = await req('POST', '/api/register', { body: JSON.stringify({ id: 'phone-1', name: 'iPhone' }) });
  assert(reg.status === 200 && JSON.parse(reg.body).id === 'phone-1', '注册 phone-1');

  const m = await req('POST', '/api/message', { body: JSON.stringify({ text: '你好局域网', sender: '手机', senderId: 'phone-1' }) });
  assert(m.status === 200 && JSON.parse(m.body).text === '你好局域网', '发中文消息');

  const bad = await req('POST', '/api/message', { body: JSON.stringify({ text: '' }) });
  assert(bad.status === 400, '空文本 400');

  const fileContent = Buffer.from('hello file content 12345');
  const up = await req('POST', '/api/upload?name=hello.txt&sender=%E6%89%8B%E6%9C%BA&senderId=phone-1', {
    body: fileContent,
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': fileContent.length },
  });
  const upRec = JSON.parse(up.body);
  assert(up.status === 200 && upRec.name === 'hello.txt' && upRec.size === fileContent.length, `上传 id=${upRec.id}`);

  const dl = await req('GET', '/api/files/' + upRec.id, { buffer: true });
  assert(dl.status === 200 && Buffer.compare(dl.body, fileContent) === 0, '下载内容一致');
  assert(/inline/.test(dl.headers['content-disposition']), '默认 inline');

  const dl2 = await req('GET', '/api/files/' + upRec.id + '?download=1', { buffer: true });
  assert(/attachment/.test(dl2.headers['content-disposition']), '?download=1 触发 attachment');

  const rg = await req('GET', '/api/files/' + upRec.id, { headers: { Range: 'bytes=0-4' }, buffer: true });
  assert(rg.status === 206 && rg.body.length === 5 && rg.body.toString() === 'hello', 'Range 206');

  const s1 = JSON.parse((await req('GET', '/api/state')).body);
  assert(s1.messages.length === 1 && s1.files.length === 1, 'state 1 msg + 1 file');
  assert(s1.devices.length === 2, '两个设备');

  const home = await req('GET', '/');
  assert(home.status === 200 && home.body.includes('NearbyShare'), '首页 HTML');
  const css = await req('GET', '/style.css');
  assert(css.status === 200 && css.body.includes('composer'), 'style.css');
  const js = await req('GET', '/client.js');
  assert(js.status === 200 && js.body.includes('EventSource'), 'client.js');
  const fav = await req('GET', '/favicon.svg');
  assert(fav.status === 200 && fav.body.startsWith('<svg'), 'favicon.svg');

  const del = await req('DELETE', '/api/files/' + upRec.id);
  assert(del.status === 200 && JSON.parse(del.body).ok, '删除文件');
  const s2 = JSON.parse((await req('GET', '/api/state')).body);
  assert(s2.files.length === 0, '文件已移除');

  await req('POST', '/api/clear', { body: '{}' });
  const s3 = JSON.parse((await req('GET', '/api/state')).body);
  assert(s3.messages.length === 0, '清空后为空');

  const urls = getLanUrls(PORT);
  console.log('  LAN URLs:', urls);
  assert(Array.isArray(urls), 'getLanUrls');

  console.log('\n全部通过');
  await handle.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
  process.exit(0);
})().catch((err) => {
  console.error('测试失败：', err);
  process.exit(1);
});
