'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const crypto = require('crypto');

/**
 * 内存中的消息 / 文件 / 设备清单。零依赖，进程重启后清空（uploads/ 目录保留）。
 */
function createStore({ uploadDir, historyLimit = 200 }) {
  const messages = [];
  const files = [];
  const devices = new Map(); // id -> device record

  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  function broadcast(type, payload) {
    emitter.emit('event', { type, payload });
  }

  // 定期清理长时间未上报心跳的设备
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, d] of devices) {
      if (now - d.lastSeen > 60_000) {
        devices.delete(id);
        changed = true;
      }
    }
    if (changed) broadcast('devices', Array.from(devices.values()));
  }, 15_000).unref();

  return Object.assign(emitter, {
    uploadDir,

    getSnapshot() {
      return {
        messages: messages.slice(),
        files: files.slice().map(publicFile),
        devices: Array.from(devices.values()),
      };
    },

    addMessage({ sender, senderId, text }) {
      const rec = {
        id: crypto.randomBytes(6).toString('hex'),
        kind: 'text',
        sender: String(sender || 'Anonymous').slice(0, 40),
        senderId: String(senderId || ''),
        text: String(text || '').slice(0, 5000),
        timestamp: Date.now(),
      };
      messages.push(rec);
      while (messages.length > historyLimit) messages.shift();
      broadcast('message', rec);
      return rec;
    },

    addFile({ id, name, sender, senderId, size, mime, path: fpath }) {
      const rec = {
        id,
        kind: 'file',
        name: String(name || 'file').slice(0, 200),
        sender: String(sender || 'Anonymous').slice(0, 40),
        senderId: String(senderId || ''),
        size,
        mime,
        path: fpath,
        timestamp: Date.now(),
      };
      files.push(rec);
      broadcast('file-added', publicFile(rec));
      return publicFile(rec);
    },

    getFile(id) {
      return files.find((f) => f.id === id);
    },

    removeFile(id) {
      const idx = files.findIndex((f) => f.id === id);
      if (idx < 0) return false;
      const [f] = files.splice(idx, 1);
      fs.unlink(f.path, () => {});
      broadcast('file-removed', { id: f.id });
      return true;
    },

    removeMessage(id) {
      const idx = messages.findIndex((m) => m.id === id);
      if (idx < 0) return false;
      const [m] = messages.splice(idx, 1);
      broadcast('message-removed', { id: m.id });
      return true;
    },

    clearAll() {
      messages.length = 0;
      for (const f of files) fs.unlink(f.path, () => {});
      files.length = 0;
      broadcast('cleared', {});
    },

    registerDevice({ id, name, userAgent, ip }) {
      const existing = devices.get(id);
      const rec = {
        id,
        name: String(name || 'Device').slice(0, 30),
        userAgent: String(userAgent || '').slice(0, 200),
        ip,
        connectedAt: existing ? existing.connectedAt : Date.now(),
        lastSeen: Date.now(),
      };
      devices.set(id, rec);
      broadcast('devices', Array.from(devices.values()));
      return rec;
    },
  });
}

// 只对外暴露必要字段，避免泄露磁盘路径
function publicFile(f) {
  return {
    id: f.id,
    kind: 'file',
    name: f.name,
    sender: f.sender,
    senderId: f.senderId,
    size: f.size,
    mime: f.mime,
    timestamp: f.timestamp,
  };
}

module.exports = { createStore };
