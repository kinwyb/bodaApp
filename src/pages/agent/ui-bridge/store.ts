/**
 * 界面桥的宿主注册表：**两级**。
 *
 * - **工作台级**（挂在 MainLayout 上，全局唯一）：知道当前激活的是哪个页面、能打开哪些页面、
 *   怎么打开。用户停在主页、没进任何业务页面时，靠它回答「你在工作台，这些页面可以打开」——
 *   这是「用户在主页直接发问」能走通的前提。
 * - **页面级**（业务页面各自注册，按 view 索引）：只贡献自己那一段
 *   guide / actions / filters / data / form。
 *
 * 存 getter 而不是快照对象：React 每次渲染都会产生新的闭包，存 getter 能让桥始终读到最新
 * 的 state，而不必为了更新描述而反复注册。
 *
 * 版本号按 view 分域：跨页面共用一个计数器，导航之后校验必然混乱 ——
 * 打开另一个页面跟当前页面的版本本来就没有关系。
 */

import type { UIBridgeHost, UIDialogHost, UIWorkbenchHost } from './types';

/** 页面级宿主：view -> getter */
const pageHosts = new Map<string, () => UIBridgeHost | null>();

/** 工作台级宿主：全局唯一 */
let workbenchGetter: (() => UIWorkbenchHost | null) | null = null;

/** 弹窗层宿主：view -> getter，只在弹窗打开期间存在 */
const dialogHosts = new Map<string, () => UIDialogHost | null>();

/** 页面版本（乐观锁），按 view 维护 */
const revByView = new Map<string, number>();

/**
 * 「模型手里那份快照」的锚点，按 view 维护。
 *
 * 桥每发一次完整快照就记下它的结构指纹，每发一次补丁就记下变化段指纹；
 * 下一条命令执行完拿新快照一比，就知道该发 full / patch / result —— 页面不用声明。
 *
 * 存的是浏览器侧的记忆（不占 token），所以页面卸载也不必清：
 * 同一个 view 重新挂载时结构一样，继续发补丁是对的；结构不一样会自动升级成 full。
 * 唯一的失配风险是服务端把上下文折叠过、模型手里其实没那份快照了，
 * 那条路由 `patch.basedOn` 与 `snapshot.fp` 让模型自己发现并重新 observe。
 */
const anchorByView = new Map<string, { structure: string; dynamic: string }>();

/** 注册页面级宿主，返回注销函数 */
export function registerPageHost(view: string, getter: () => UIBridgeHost | null): () => void {
  pageHosts.set(view, getter);
  return () => {
    // 只有还是自己注册的那个才清空，避免后注册者被先卸载的页面误注销
    if (pageHosts.get(view) === getter) pageHosts.delete(view);
  };
}

/** 取某个 view 的页面宿主；该页面没打开或没接入时返回 null */
export function getPageHost(view: string): UIBridgeHost | null {
  const getter = pageHosts.get(view);
  return getter ? getter() : null;
}

/** 注册工作台级宿主，返回注销函数 */
export function registerWorkbenchHost(getter: () => UIWorkbenchHost | null): () => void {
  workbenchGetter = getter;
  return () => {
    if (workbenchGetter === getter) workbenchGetter = null;
  };
}

/** 取工作台级宿主 */
export function getWorkbenchHost(): UIWorkbenchHost | null {
  return workbenchGetter ? workbenchGetter() : null;
}

/** 注册弹窗层宿主（弹窗打开时注册，关闭时注销），返回注销函数 */
export function registerDialogHost(view: string, getter: () => UIDialogHost | null): () => void {
  dialogHosts.set(view, getter);
  return () => {
    if (dialogHosts.get(view) === getter) dialogHosts.delete(view);
  };
}

/** 取某个 view 上正在打开的弹窗；没有则返回 null */
export function getDialogHost(view: string): UIDialogHost | null {
  const getter = dialogHosts.get(view);
  return getter ? getter() : null;
}

/** 某个页面的当前版本 */
export function currentRev(view: string): number {
  return revByView.get(view) ?? 1;
}

/** 模型手里那份快照的锚点；从没发过完整快照时返回 null（第一次操作必须给 full） */
export function anchorOf(view: string): { structure: string; dynamic: string } | null {
  return anchorByView.get(view) ?? null;
}

/** 记下「刚发给模型的这一份」：下一次 diff 就以它为基准 */
export function setAnchor(view: string, anchor: { structure: string; dynamic: string }): void {
  anchorByView.set(view, anchor);
}

/** 推进某个页面的版本 */
export function bumpRev(view: string): number {
  const next = currentRev(view) + 1;
  revByView.set(view, next);
  return next;
}
