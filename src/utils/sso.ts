import { setToken } from '@/api/request';
import { isReleaseEnv } from './env';

/**
 * 统一登录（SSO）。
 *
 * 流程（release 且配置了 VITE_SSO_LOGIN_URL 时启用）：
 *   未登录 → 跳统一登录平台（带 returnUrl）→ 平台登录后回调后端
 *   → 后端验证并签发 token → 302 回前端，token 放在 URL fragment：
 *       https://<前端>/<原路径>#sso_token=<token>
 *   → 启动时 consumeSsoTokenFromUrl() 把它写入 localStorage 并清掉 fragment，
 *     之后完全复用现有 checking → /login/userInfo → authenticated 状态机（store/auth.tsx）。
 *
 * 为什么用 fragment 而不是 query：fragment 不随 HTTP 请求发送、不进 nginx / 后端
 * access log；拾取后立即 replaceState 清除，地址栏与浏览历史里也不残留。
 *
 * 三条边界（都收敛在 isSsoEnabled / consume 的判定里）：
 * - debug 环境不启用，dev 保持账号密码登录；本机想演练正式流程用 VITE_APP_ENV=release。
 * - 桌面壳（mygo:// 协议）不启用：平台无法 302 回应用内，桌面端走账号密码。
 * - 未配置登录地址不启用，等价于现状的账号密码登录。
 *
 * 注意本模块**不要**加进 utils/index.ts 的桶出口：它依赖 api 层，
 * 而 api/modules/login 又反过来依赖 utils 桶（toHexString），会形成循环导入。
 */

/** 平台登录地址。支持 {returnUrl} 占位符；没有占位符时自动追加 ?returnUrl= */
const SSO_LOGIN_URL = (import.meta.env.VITE_SSO_LOGIN_URL ?? '').trim();
/** 平台登出地址（可选）。配了它，退出时顺带清平台会话 */
const SSO_LOGOUT_URL = (import.meta.env.VITE_SSO_LOGOUT_URL ?? '').trim();

/** 后端回跳时携带 token 的 fragment 参数名（与后端的契约，改动要两侧同步） */
const TOKEN_PARAM = 'sso_token';
/** 手动登出标记：有它时不自动跳平台，停在登录页等用户主动点击 */
const MANUAL_LOGOUT_KEY = 'boda_sso_manual_logout';
/** 上次自动跳转的时间戳，用于拦截「token 反复失效」造成的重定向死循环 */
const REDIRECT_AT_KEY = 'boda_sso_redirect_at';
const REDIRECT_GUARD_MS = 10_000;

/**
 * 是否桌面壳。用页面协议判断而不是 isAppShell：后者回答的是「Go 注入过配置」，
 * 用户清空设置后就不注入了（见 runtime-config.ts 的说明）；mygo:// 则始终可靠。
 */
const isDesktopShell = typeof window !== 'undefined' && window.location.protocol === 'mygo:';

/** 是否走统一登录。模块加载时确定，调用点不用放进 effect 依赖 */
export const isSsoEnabled: boolean = isReleaseEnv && !isDesktopShell && SSO_LOGIN_URL !== '';

/**
 * 拾取回跳 URL 里的 token，写入 localStorage 并把 fragment 从地址里清掉。
 * 必须在 React 挂载前调用（main.tsx），AuthProvider 的初始态才能读到它。
 *
 * 只依赖 release 环境而不要求配置了登录地址：用户从平台门户主动进入本系统时，
 * 跳转由平台发起，本系统即使没配登录地址也应当认这份回跳凭证。
 */
export function consumeSsoTokenFromUrl(): boolean {
  if (!isReleaseEnv || isDesktopShell) return false;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const token = (params.get(TOKEN_PARAM) ?? '').trim();
  if (!token) return false;

  setToken(token);
  // 拿到了新凭证，此前的「手动登出」意图作废
  clearSsoManualLogout();

  // 只摘掉 sso_token，保留 fragment 里的其它参数（可能有锚点用途）
  params.delete(TOKEN_PARAM);
  const rest = params.toString();
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', pathname + search + (rest ? `#${rest}` : ''));
  return true;
}

/** 拼平台地址：占位符替换，或追加 returnUrl 查询参数。returnUrl 一律整串编码 */
function withReturnUrl(template: string, returnPath: string): string {
  const path = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
  const encoded = encodeURIComponent(`${window.location.origin}${path}`);
  if (template.includes('{returnUrl}')) return template.replaceAll('{returnUrl}', encoded);
  const sep = template.includes('?') ? '&' : '?';
  return `${template}${sep}returnUrl=${encoded}`;
}

/** 自动跳转是否正被死循环守卫拦着（渲染期据此决定要不要回落到登录页） */
export function isSsoRedirectGuardBlocked(): boolean {
  const last = Number(sessionStorage.getItem(REDIRECT_AT_KEY) ?? 0);
  return last > 0 && Date.now() - last < REDIRECT_GUARD_MS;
}

/**
 * 跳统一登录平台。返回 false 表示没跳（未启用，或被死循环守卫拦下），
 * 调用方应回落到本地登录页。
 *
 * 守卫：10 秒内只允许一次自动跳转。后端持续签发无效 token 时，
 * 「跳平台 → 秒回 → 校验失败 → 又跳」会无限循环；拦下后停在登录页，
 * 由用户主动重试（force 跳过守卫）。登录成功时调 clearSsoRedirectGuard 复位。
 */
export function redirectToSsoLogin(returnPath: string, force = false): boolean {
  if (!isSsoEnabled) return false;
  if (!force && isSsoRedirectGuardBlocked()) return false;
  sessionStorage.setItem(REDIRECT_AT_KEY, String(Date.now()));
  window.location.assign(withReturnUrl(SSO_LOGIN_URL, returnPath));
  return true;
}

/** 登录成功后复位跳转守卫，下一次合法跳转不受上一次的时间戳影响 */
export function clearSsoRedirectGuard(): void {
  sessionStorage.removeItem(REDIRECT_AT_KEY);
}

/**
 * 手动登出标记。平台会话可能还在，登出后若自动跳平台会被静默放行、瞬间回登，
 * 「退出」形同虚设；所以登出后停在登录页，等用户主动点「统一身份认证登录」。
 * 用 sessionStorage：关标签页即重置，不影响下次打开时的正常自动登录。
 */
export function markSsoManualLogout(): void {
  sessionStorage.setItem(MANUAL_LOGOUT_KEY, '1');
}

export function isSsoManualLogout(): boolean {
  return sessionStorage.getItem(MANUAL_LOGOUT_KEY) === '1';
}

export function clearSsoManualLogout(): void {
  sessionStorage.removeItem(MANUAL_LOGOUT_KEY);
}

/** 平台登出地址；未配置返回 null（登出只清本地，停在登录页） */
export function getSsoLogoutUrl(returnPath = '/'): string | null {
  if (!isSsoEnabled || SSO_LOGOUT_URL === '') return null;
  return withReturnUrl(SSO_LOGOUT_URL, returnPath);
}
