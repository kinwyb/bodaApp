/**
 * 当前服务组织（`Service-Org` 响应头）的运行时持有者。
 *
 * 为什么需要它：菜单节点带 `UseOrgs`（哪些组织可见），过滤前必须知道「我现在连的是
 * 哪个组织」。这个信息的权威来源是**服务器**，不是登录用户 —— 后端在 nginx 上给每个
 * 响应加 `Service-Org: <OrgID>`（每台组织的部署写自己的值），前端从响应头读。
 * 用它而不是 `userInfo.OrgID`：后者是「用户所属组织」，跨组织登录时会和服务器组织不一致。
 *
 * 两个来源，殊途同归：
 * - web：同源部署，组织恒定。第一个接口响应就把 orgId 定下来，之后不再变。
 * - app：设置窗口切换组织时，Go 把代理上游换到另一台服务器，并 dispatch 一个
 *   `boda-org-changed` 事件（见 notifyOrgSwitched）。orgId 随之更新，epoch +1 通知
 *   界面「组织变了，菜单要重拉、页面要刷新」。
 *
 * 本文件只做运行时状态，不含 React（hook 在 @/store/service-org）。刻意不 import
 * api / store，请求层（api/request）才能安全地 import 它而不形成循环依赖。
 */

/** 组织切换事件名：Go 侧 Eval `window.dispatchEvent(new CustomEvent(...))` 发出 */
export const ORG_CHANGED_EVENT = 'boda-org-changed';

interface ServiceOrgSnapshot {
  /** 当前服务器组织 ID；空串表示未知（header 没配 / 还没收到响应），此时不做组织过滤 */
  orgId: string;
  /** 组织切换计数：只在「显式切换」时 +1，用来触发菜单重拉与页面刷新 */
  epoch: number;
}

let snapshot: ServiceOrgSnapshot = {orgId: '', epoch: 0};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** 订阅组织变化（useSyncExternalStore 用） */
export function subscribeServiceOrg(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 当前快照（引用稳定，未变化时复用同一对象，避免 useSyncExternalStore 死循环） */
export function getServiceOrgSnapshot(): ServiceOrgSnapshot {
  return snapshot;
}

/** 当前组织 ID 的便捷读取（非 React 场景） */
export function getServiceOrg(): string {
  return snapshot.orgId;
}

/**
 * 从响应头捕获组织。请求层在每个响应上调用；值没变就不通知，避免无谓重渲染。
 * 只更新 orgId，不动 epoch —— 组织是「哪台服务器」的属性，正常请求不该触发刷新。
 */
export function captureServiceOrg(headers: Headers): void {
  const orgId = headers.get('service-org')?.trim() ?? '';
  if (!orgId || orgId === snapshot.orgId) return;
  snapshot = {...snapshot, orgId};
  emit();
}

/**
 * 显式切换组织（app 设置窗口触发）。更新 orgId 并把 epoch +1，
 * 让 PermissionProvider 重拉菜单、MainLayout 刷新页签。
 */
export function notifyOrgSwitched(orgId: string): void {
  const next = orgId.trim();
  snapshot = {orgId: next, epoch: snapshot.epoch + 1};
  emit();
}

// Go 侧切换组织后 dispatch 这个事件；detail.orgId 是新组织。模块加载即注册，
// 保证任何一次切换都不会因为「监听还没挂上」而丢失。非浏览器环境（SSR/测试）跳过。
if (typeof window !== 'undefined') {
  window.addEventListener(ORG_CHANGED_EVENT, (event) => {
    const orgId = (event as CustomEvent<{orgId?: string}>).detail?.orgId ?? '';
    notifyOrgSwitched(orgId);
  });
}
