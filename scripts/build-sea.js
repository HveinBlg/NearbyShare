#!/usr/bin/env node
/**
 * 使用 Node.js 内置的 SEA (Single Executable Applications) 把 bundle 打包成
 * 单个可执行文件，供普通用户下载后双击运行（无需装 Node.js）。
 *
 * 要求：Node.js 20+ 用于运行本脚本；产物运行不再依赖 Node。
 * 依赖：postject（npm 上有），首次执行时用 npx 拉取。
 *
 * 用法：
 *   node scripts/build-sea.js                    # 为当前平台构建
 *
 * 输出：
 *   dist/nearby-share-<platform>-<arch>[.exe]
 *
 * 官方文档：https://nodejs.org/api/single-executable-applications.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUNDLE = path.join(DIST, 'nearby-share-bundled.js');

if (!fs.existsSync(BUNDLE)) {
  console.log('先运行 bundle...');
  execSync('node scripts/bundle.js', { cwd: ROOT, stdio: 'inherit' });
}

const platform = os.platform(); // 'win32' | 'darwin' | 'linux'
const arch = os.arch();          // 'x64' | 'arm64' | ...
const exeName = `nearby-share-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
const OUT = path.join(DIST, exeName);

// 1) 写 SEA 配置
const seaConfig = {
  main: BUNDLE,
  output: path.join(DIST, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
};
const seaConfigPath = path.join(DIST, 'sea-config.json');
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

// 2) 生成 blob
console.log('生成 SEA blob...');
execSync(`node --experimental-sea-config "${seaConfigPath}"`, { cwd: ROOT, stdio: 'inherit' });

// 3) 复制 node 可执行文件
console.log('复制 node 可执行文件...');
fs.copyFileSync(process.execPath, OUT);
if (platform !== 'win32') fs.chmodSync(OUT, 0o755);

// 4) 使用 postject 注入 blob
console.log('注入 blob (通过 postject)...');
const postjectArgs = [
  'postject', OUT, 'NODE_SEA_BLOB', seaConfig.output,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
try {
  execSync(`npx --yes ${postjectArgs.join(' ')}`, { cwd: ROOT, stdio: 'inherit' });
} catch (err) {
  console.error(`\n[!] postject 执行失败：${err.message}`);
  console.error('    这通常是因为 npm 无法访问 registry。请在有网络的机器上运行本脚本，');
  console.error('    或者使用 GitHub Actions 自动构建（见 .github/workflows/release.yml）。');
  process.exit(1);
}

// 5) 清理临时文件
fs.unlinkSync(seaConfig.output);

const sz = fs.statSync(OUT).size;
console.log(`\n构建完成：${OUT} (${(sz / 1024 / 1024).toFixed(1)} MB)`);
console.log('用户可以直接双击运行该文件（无需安装 Node.js）。');
