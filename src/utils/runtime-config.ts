/**
 * 运行时服务器地址（只在桌面端有值）。
 *
 * 为什么需要这一层：地址有两个来源，而且它们的适用场景不同。
 *
 * - **浏览器里访问服务器上的前端**（正式 web 部署）：前端发相对路径 `/v1/boda`，
 *   由服务器的反向代理转发到后端。地址写在 `vite.config.ts` / `.env` 里，
 *   属于构建期的事，页面运行时不关心。
 * - **桌面端（app）**：前端被内嵌进可执行文件、以 `mygo://localhost/` 提供，
 *   页面没有同源的服务器反代，接口、Agent ws、语音识别都必须拿到**绝对地址**。
 *
 * 桌面端由 Go 侧在页面脚本之前注入 `window.__BODA_SETTINGS__`（用户在
 * 「设置服务器地址…」窗口里填的值），这里把它与构建期默认值合并：
 *
 *   注入有值 → 用注入值（app 里改过地址）
 *   注入没值 → 用 `import.meta.env.*`（默认值，web 部署时通常就是相对路径）
 *
 * 注入必须发生在页面脚本之前，`PageOptions.PreloadScript` 保证这一点，
 * 所以下面这些都是模块级常量，不需要异步等待，也不必在调用点做「先取配置」。
 */

/** Go 侧注入的结构，字段名与 `app/settings.go` 的 json tag 一致 */
export type AppRuntimeSettings = {
  apiBaseUrl?: string;
  agentWsUrl?: string;
  asrUrl?: string;
};

declare global {
  interface Window {
    __BODA_SETTINGS__?: AppRuntimeSettings;
  }
}

/** 统一成「去空白、去尾斜杠」——拼地址时一律自己补 `/` */
function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function readInjected(): AppRuntimeSettings {
  // 正常 SPA 一定有 window；留着守卫是为了模块被非浏览器环境加载时不炸
  if (typeof window === 'undefined') return {};
  const raw = window.__BODA_SETTINGS__;
  if (!raw || typeof raw !== 'object') return {};

  const settings: AppRuntimeSettings = {};
  // 空值不写进结果：`''` 与「没配」是同一件事，前端要能统一回落到默认值
  const apiBaseUrl = normalize(raw.apiBaseUrl);
  const agentWsUrl = normalize(raw.agentWsUrl);
  const asrUrl = normalize(raw.asrUrl);
  if (apiBaseUrl) settings.apiBaseUrl = apiBaseUrl;
  if (agentWsUrl) settings.agentWsUrl = agentWsUrl;
  if (asrUrl) settings.asrUrl = asrUrl;
  return settings;
}

/** 本次运行实际生效的注入值（未配的键不存在） */
export const appRuntimeSettings: AppRuntimeSettings = readInjected();

/**
 * 是否运行在桌面壳里。
 *
 * 注意它回答的是「Go 注入过配置」，不是「有没有桌面能力」：用户把三项全清空后
 * app 里也不会注入。真需要区分运行环境时用 `mygo-runtime` 的 `isMyGo()`。
 */
export const isAppShell: boolean = Object.keys(appRuntimeSettings).length > 0;

/** 接口前缀：app 里配了就用它，否则取构建期值，再兜底相对路径 */
export const API_BASE_URL: string =
  appRuntimeSettings.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/v1/boda';

/** Agent ws 地址：空串表示走本地演示传输（与构建期判定一致） */
export const AGENT_WS_URL: string =
  appRuntimeSettings.agentWsUrl ?? import.meta.env.VITE_AGENT_WS_URL ?? '';

/**
 * ws 地址是否来自 app 内的配置。
 *
 * 附件端点的路径判定要用它：dev 下默认走 dev server 的同源代理 `/ws/files`，
 * 但用户在设置窗口里指到另一台机器时，dev server 的代理目标不会跟着变，
 * 必须直接拼绝对地址。
 */
export const isAgentWsFromApp: boolean = Boolean(appRuntimeSettings.agentWsUrl);

/** 语音识别根地址（前端自己补 `/asr`）；空串表示按原策略走同源 `/asr` 代理 */
export const ASR_BASE_URL: string =
  appRuntimeSettings.asrUrl ?? import.meta.env.VITE_ASR_URL ?? '';
