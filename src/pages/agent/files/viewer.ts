/**
 * file-viewer 独立预览服务的 iframe 接入（官方「零依赖 iframe 集成」）。
 *
 * 服务本体是 flyfish-dev/file-viewer 的官方静态构建（npm run file-viewer:setup
 * 下载解压，见 scripts/setup-file-viewer.mjs），主应用不引任何 @file-viewer 依赖。
 *
 * 传文件走 Blob 通道而不是 ?url=：后端 ws 服务不处理 CORS，viewer 服务跨源
 * 直接拉文件地址会被浏览器拦；由工作台（同源代理 + token）取好 Blob 再
 * postMessage 过去，鉴权与跨域一并解决。
 */

/** 服务 base：dev 走 vite 代理 /file-viewer；生产可配绝对地址或网关子路径 */
export function fileViewerBaseUrl(): string {
  const explicit = import.meta.env.VITE_FILE_VIEWER_URL?.trim();
  return (explicit || '/file-viewer').replace(/\/+$/, '');
}

/**
 * iframe 入口：走同目录的桥接页 boda-bridge.html（见 services/file-viewer/extra/）。
 *
 * 不直连 iframe.html：它的消息监听器在 App 异步挂载后才注册，load 事件投 Blob
 * 会丢；桥接页与它同源、能轮询 DOM 判定挂载完成，回 ready 后父页面再投，零竞态。
 * from 声明父页面 origin，桥接页与内层 demo 逐级做来源校验。
 */
export function fileViewerFrameUrl(name: string): string {
  const params = new URLSearchParams({ from: window.location.origin, name });
  // 代码/文本长行自动换行：面板宽度有限，单行大 JSON 不换行会整行溢出视口。
  // options 是 demo 支持的查询参数（qs 解析后并入 viewerOptions）。
  params.set('options', JSON.stringify({ text: { wrapLongLines: true } }));
  return `${fileViewerBaseUrl()}/boda-bridge.html?${params.toString()}`;
}

/** postMessage 的 targetOrigin：相对 base 按当前页面解析 */
export function fileViewerOrigin(): string {
  return new URL(fileViewerBaseUrl(), window.location.href).origin;
}
