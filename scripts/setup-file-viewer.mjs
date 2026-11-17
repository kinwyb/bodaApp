#!/usr/bin/env node
/**
 * 下载并解压 file-viewer 官方「零依赖 iframe」静态构建，作为独立服务部署。
 *
 * 产物落在 services/file-viewer/site/（gitignore），主应用不引任何 @file-viewer
 * 依赖 —— 工作台面板只通过 iframe + postMessage(Blob) 与它通信（见
 * src/layouts/WorkbenchFilePanel.tsx）。
 *
 *   npm run file-viewer:setup            # 下载 + 解压（已存在则跳过）
 *   npm run file-viewer:setup -- --force # 重新下载覆盖
 *   npm run file-viewer:serve            # 本地起静态服务（默认 8090）
 *
 * 生产部署：把 site/ 目录交给 nginx / 任意静态服务器即可，无需 Node。
 * 下载源可用环境变量 FILE_VIEWER_TARBALL_URL 覆盖（内网镜像 / 本地文件路径）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVICE_DIR = path.join(ROOT, 'services', 'file-viewer');
const SITE_DIR = path.join(SERVICE_DIR, 'site');

const VERSION = '3.3.4';
const TARBALL_NAME = `file-viewer-v2-${VERSION}-official-demo-iframe.tar.gz`;
const DEFAULT_URL = `https://github.com/flyfish-dev/file-viewer/releases/download/v${VERSION}/${TARBALL_NAME}`;

function run(cmd, args) {
  const result = spawnSync(cmd, args, {stdio: 'inherit'});
  if (result.status !== 0) {
    console.error(`[file-viewer] 命令失败：${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const force = process.argv.includes('--force');
  const marker = path.join(SITE_DIR, 'iframe.html');
  if (fs.existsSync(marker) && !force) {
    console.log(`[file-viewer] 已就绪：${SITE_DIR}（--force 可重新下载）`);
    return;
  }

  fs.mkdirSync(SERVICE_DIR, {recursive: true});
  const tarball = path.join(SERVICE_DIR, TARBALL_NAME);
  const source = process.env.FILE_VIEWER_TARBALL_URL || DEFAULT_URL;

  if (fs.existsSync(source)) {
    // 内网场景：直接给本地 tar.gz 路径
    fs.copyFileSync(source, tarball);
  } else {
    if (!fs.existsSync(tarball) || force) {
      console.log(`[file-viewer] 下载 ${source}（约 149MB）…`);
      // --http1.1：部分网络下 GitHub 大文件走 HTTP2 会报 framing layer 错误
      run('curl', ['-fL', '--http1.1', '--retry', '3', '-o', tarball, source]);
    } else {
      console.log(`[file-viewer] 复用已下载的 ${tarball}`);
    }
  }

  // 先解到临时目录再原子替换，避免半截产物被当成可用站点
  const staging = path.join(SERVICE_DIR, 'site.tmp');
  fs.rmSync(staging, {recursive: true, force: true});
  fs.mkdirSync(staging, {recursive: true});
  console.log('[file-viewer] 解压…');
  run('tar', ['-xzf', tarball, '-C', staging]);

  // 兼容压缩包带顶层目录的情况：找到 iframe.html 所在层作为站点根
  let siteRoot = staging;
  if (!fs.existsSync(path.join(siteRoot, 'iframe.html'))) {
    const entries = fs.readdirSync(staging, {withFileTypes: true}).filter((e) => e.isDirectory());
    const found = entries
      .map((e) => path.join(staging, e.name))
      .find((dir) => fs.existsSync(path.join(dir, 'iframe.html')));
    if (!found) {
      console.error('[file-viewer] 压缩包里找不到 iframe.html，产物结构可能变了');
      process.exit(1);
    }
    siteRoot = found;
  }

  fs.rmSync(SITE_DIR, {recursive: true, force: true});
  fs.renameSync(siteRoot, SITE_DIR);
  fs.rmSync(staging, {recursive: true, force: true});
  // 桥接页等自有补充文件覆盖进站点（见 extra/ 目录说明）
  const extra = path.join(SERVICE_DIR, 'extra');
  if (fs.existsSync(extra)) {
    for (const entry of fs.readdirSync(extra)) {
      fs.copyFileSync(path.join(extra, entry), path.join(SITE_DIR, entry));
    }
  }
  console.log(`[file-viewer] 完成：${SITE_DIR}`);
  console.log('[file-viewer] 本地预览：npm run file-viewer:serve');
}

main();
