# file-viewer 独立预览服务

工作台「文件浏览」面板的预览引擎，来自
[flyfish-dev/file-viewer](https://github.com/flyfish-dev/file-viewer) 官方
「零依赖 iframe 集成」静态构建。主应用不引任何 `@file-viewer` npm 依赖，
只通过 iframe + `postMessage(Blob)` 与它通信。

## 安装

```bash
npm run file-viewer:setup
```

脚本从 GitHub Releases 下载 `file-viewer-v2-<版本>-official-demo-iframe.tar.gz`
（约 149MB）并解压到 `services/file-viewer/site/`（已 gitignore）。

内网 / 手动下载场景：把 tar.gz 放到任意位置后指定本地路径即可，不必联网：

```bash
FILE_VIEWER_TARBALL_URL=/path/to/file-viewer-v2-3.3.4-official-demo-iframe.tar.gz \
  npm run file-viewer:setup
```

也可以直接把 tar.gz 放到 `services/file-viewer/` 下（与官方同名），脚本会复用。

## 本地开发

```bash
npm run file-viewer:serve   # http://127.0.0.1:8090
npm run dev                 # vite 把 /file-viewer 代理到 8090
```

代理目标可用 `VITE_FILE_VIEWER_TARGET` 覆盖；前端 iframe 的 base 可用
`VITE_FILE_VIEWER_URL` 覆盖（默认 `/file-viewer`，生产部署在网关子路径或
独立域名时配置）。

## 生产部署

把 `site/` 目录交给任意静态服务器即可，无需 Node。nginx 示例（挂在网关的
`/file-viewer/` 子路径，与前端同源）：

```nginx
location /file-viewer/ {
    alias /opt/bodaway/file-viewer/site/;
    index index.html;
    types { application/wasm wasm; text/javascript mjs; }
}
```

独立域名部署也可以（iframe 跨源没问题）：面板取文件 Blob 走的是工作台自己的
同源代理，`postMessage` 按 `VITE_FILE_VIEWER_URL` 解析 targetOrigin，`from`
参数声明父页面 origin 供站点校验。注意必须 HTTP(S) 访问，`file://` 直开不行。

## 与工作台的文件通道

- 面板（`src/layouts/WorkbenchFilePanel.tsx`）带 token 从后端拉文件 Blob：
  附件走 `/ws/files/<id>`，工作区文件走 `/ws/agents/{agent}/file?path=`（只读）。
- iframe 入口：`{base}/boda-bridge.html?from=<父页面origin>&name=<文件名>`。
  桥接页（`extra/boda-bridge.html`，setup 脚本会自动拷进 site/）与 `iframe.html`
  同源，轮询内层 DOM 判定 App 挂载完成后回 `boda-viewer-ready`，面板收到信号才
  `postMessage(Blob, targetOrigin)` 投一次，桥接页转发给内层 demo 渲染。
  **不能直连 iframe.html 并在 load 时投 Blob**：demo 的消息监听器在 App 异步
  挂载后才注册，load 时投递会丢失（壳正常、内容空白）。
- 不走 `?url=` 直载：后端 ws 服务不处理 CORS，viewer 服务跨源拉文件会被浏览器拦。

## 升级 / 补部署

官方包升级后重跑 `npm run file-viewer:setup -- --force`，脚本会把 `extra/` 下的
自有文件（桥接页）重新覆盖进 site/。已部署的服务器需要同步上传：

```bash
scp services/file-viewer/extra/boda-bridge.html <user>@<host>:/usr/share/nginx/fileViewer/
```
