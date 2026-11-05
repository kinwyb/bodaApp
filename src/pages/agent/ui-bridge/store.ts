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

import type { UIEventDefinition, UIBridgeHost, UIDialogHost, UIWorkbenchHost } from './types';
import type { UIEventNotice, UISnapshotPatch } from '../protocol';
import { isDebugEnv } from '@/utils';

/** 锚点：结构指纹（决定 full / patch）、变化段指纹（决定 patch / result）、以及上次那份全量投影（做逐条 diff） */
export type SnapshotAnchor = {
  structure: string;
  dynamic: string;
  state: UISnapshotPatch;
};

/** 页面级宿主：view -> getter */
const pageHosts = new Map<string, () => UIBridgeHost | null>();

/** 工作台级宿主：全局唯一 */
let workbenchGetter: (() => UIWorkbenchHost | null) | null = null;

/** 弹窗层宿主：view -> getter，只在弹窗打开期间存在 */
const dialogHosts = new Map<string, () => UIDialogHost | null>();

/** 会话层注册的事件接收器；页面只发通知，不直接依赖 chat hook */
type UIEventSink = (notice: UIEventNotice, definition: UIEventDefinition) => void;
let eventSink: UIEventSink | null = null;
/** 会话层把“用户已手动开启且有真实消息”同步到这里，waitConfirm 登记也遵守该门槛 */
let eventCaptureEnabled = false;

/** ui_act 执行期间暂停采集事件，防止 agent 自己改页面后反向唤醒自己 */
let eventSuppressionDepth = 0;

/** agent 发起 waitConfirm 命令后留下的短期上下文 */
export type PendingUIConfirm = {
  view: string;
  actionId: string;
  requestId: string;
  expiresAt: number;
};

const CONFIRM_TTL_MS = 5 * 60 * 1000;
const pendingConfirms = new Map<string, PendingUIConfirm>();

function confirmKey(view: string, actionId: string): string {
  return `${view}\u0000${actionId}`;
}

/** 页面版本（乐观锁），按 view 维护 */
const revByView = new Map<string, number>();

/**
 * 「模型看过的每个版本」对应的结构与写目标，按 view 维护。
 *
 * 为什么按 rev 留档，而不是只记当前结构：rev 对不上时要判断的从来不是「现在这页变没变」，
 * 而是「模型手里那份（它报上来的 rev）还作不作数」。只比当前那份的话，上一条命令打开弹窗、
 * 模型拿着旧列表快照发 `form.setMany` 也会被放进来 —— 它的 `form` 段根本不存在。
 *
 * `target` 是写目标（表单 `id#recordId`）：结构一样但换了单据时，字段集合一个没变，
 * 只比结构就会把「改 A 单」的意图写到 B 单上。
 */
export type RevContext = {
  /** 与快照 `fp` / 补丁 `basedOn` 同一个值 */
  structure: string;
  /** 表单是 `id#recordId`；非表单为空串 */
  target: string;
};

/** 每个 view 只留最近若干个版本：模型不会拿很久以前的 rev 重试 */
const REV_CONTEXT_LIMIT = 32;
const contextByRev = new Map<string, Map<number, RevContext>>();

/**
 * 「模型手里那份快照」的锚点，按 view 维护。
 *
 * 桥每发一次完整快照就记下它的结构指纹，每发一次补丁就记下变化段指纹；
 * 下一条命令执行完拿新快照一比，就知道该发 full / patch / result —— 页面不用声明。
 *
 * `state` 存的是**上一次发出去的变化段全量投影**（不是那份最小补丁）：
 * 模型把它合并进手里那份之后，那一段就等于这份投影，所以下一条命令的补丁
 * 拿它逐条比，只发真正变了的那几项（填 2 个字段就只给 2 个字段，不是整张 16 项表单）。
 *
 * 存的是浏览器侧的记忆（不占 token），所以页面卸载也不必清：
 * 同一个 view 重新挂载时结构一样，继续发补丁是对的；结构不一样会自动升级成 full。
 * 唯一的失配风险是服务端把上下文折叠过、模型手里其实没那份快照了，
 * 那条路由 `patch.basedOn` 与 `snapshot.fp` 让模型自己发现并重新 observe。
 */
const anchorByView = new Map<string, SnapshotAnchor>();

/** 注册页面级宿主，返回注销函数 */
export function registerPageHost(view: string, getter: () => UIBridgeHost | null): () => void {
  pageHosts.set(view, getter);
  return () => {
    // 只有还是自己注册的那个才清空，避免后注册者被先卸载的页面误注销
    if (pageHosts.get(view) === getter) {
      pageHosts.delete(view);
      clearWaitConfirms(view);
    }
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

/** 会话层注册/注销界面事件接收器 */
export function registerUIEventSink(sink: UIEventSink): () => void {
  eventSink = sink;
  return () => {
    if (eventSink === sink) eventSink = null;
  };
}

/** 更新当前会话是否允许记录界面事件 */
export function setUIEventCaptureEnabled(enabled: boolean): void {
  eventCaptureEnabled = enabled;
  if (!enabled) clearWaitConfirms();
}

/** 当前弹窗优先、页面兜底，查找事件声明 */
export function getUIEventDefinition(view: string, event: string): UIEventDefinition | null {
  const host = getDialogHost(view) ?? getPageHost(view);
  return host?.events?.find((item) => item.id === event) ?? null;
}

function validatePayload(
  definition: UIEventDefinition,
  payload: Record<string, unknown>,
): string | null {
  for (const field of definition.payload ?? []) {
    if (!field.required) continue;
    const value = payload[field.name];
    if (value === undefined || value === null || value === '') {
      return `界面事件 ${definition.id} 缺少必填载荷 ${field.name}`;
    }
  }
  return null;
}

/**
 * 从真实业务交互中上报事件。
 *
 * 未声明、载荷不合法、ui_act 正在执行时都不会进入会话缓冲。校验失败只在开发期
 * 打日志，避免用户点击因为桥配置问题直接抛异常。
 */
export function emitUIEvent(
  view: string,
  event: string,
  payload: Record<string, unknown> = {},
): void {
  const definition = getUIEventDefinition(view, event);
  if (!definition) {
    if (isDebugEnv) {
      console.error(`[ui-bridge] ${view} 没有声明界面事件 ${event}；事件未发送`);
    }
    return;
  }
  // ui_act 的落定窗口只抑制普通页面变化；确认框终态必须允许用户立刻点击后上报。
  if (eventSuppressionDepth > 0 && definition.delivery !== 'immediate') return;
  if (definition.delivery === 'immediate' && !definition.waitConfirmFor) {
    if (isDebugEnv) {
      console.error(`[ui-bridge] 即时事件 ${event} 必须声明 waitConfirmFor；事件未发送`);
    }
    return;
  }
  const invalid = validatePayload(definition, payload);
  if (invalid) {
    if (isDebugEnv) console.error(`[ui-bridge] ${invalid}；事件未发送`);
    return;
  }
  eventSink?.({ ts: Date.now(), view, event, payload }, definition);
}

/** 业务命令通常不持有 view，用工作台当前激活页作为事件来源 */
export function emitActiveUIEvent(
  event: string,
  payload: Record<string, unknown> = {},
): void {
  const view = getWorkbenchHost()?.currentView() ?? '';
  if (!view) return;
  emitUIEvent(view, event, payload);
}

/** ui_act 的 handler 执行期间抑制页面事件 */
export async function withUIEventSuppression<T>(run: () => T | Promise<T>): Promise<T> {
  eventSuppressionDepth += 1;
  try {
    return await run();
  } finally {
    eventSuppressionDepth -= 1;
  }
}

/** 记录一次 agent 发起的 waitConfirm，供确认框终态事件认领 */
export function rememberWaitConfirm(view: string, actionId: string, requestId: string): void {
  if (!eventCaptureEnabled) return;
  pendingConfirms.set(confirmKey(view, actionId), {
    view,
    actionId,
    requestId,
    expiresAt: Date.now() + CONFIRM_TTL_MS,
  });
}

/**
 * 认领确认上下文。只有 agent 发起的命令会留下记录；用户自己点同一按钮时返回 null，
 * 终态事件因此按普通批量事件处理。
 */
export function consumeWaitConfirm(view: string, actionId: string): PendingUIConfirm | null {
  const key = confirmKey(view, actionId);
  const pending = pendingConfirms.get(key);
  if (!pending) return null;
  pendingConfirms.delete(key);
  if (pending.expiresAt <= Date.now()) return null;
  return pending;
}

/** 会话切换、清空或页面卸载时清掉短期确认上下文 */
export function clearWaitConfirms(view?: string): void {
  if (!view) {
    pendingConfirms.clear();
    return;
  }
  for (const [key, item] of pendingConfirms) {
    if (item.view === view) pendingConfirms.delete(key);
  }
}

/** 某个页面的当前版本 */
export function currentRev(view: string): number {
  return revByView.get(view) ?? 1;
}

/** 记下「这个版本发给模型的是什么」：rev 落后时靠它判断旧快照还作不作数 */
export function rememberRevContext(view: string, rev: number, context: RevContext): void {
  let byRev = contextByRev.get(view);
  if (!byRev) {
    byRev = new Map();
    contextByRev.set(view, byRev);
  }
  // 同一个 rev 可能因为页面自己变化而被重发（没有 act，rev 不动）：以最后发出去的为准
  byRev.delete(rev);
  byRev.set(rev, context);
  while (byRev.size > REV_CONTEXT_LIMIT) {
    const oldest = byRev.keys().next().value;
    if (oldest === undefined) break;
    byRev.delete(oldest);
  }
}

/** 取某个版本当时发出去的结构与写目标；没留档（重启、已裁剪）返回 null */
export function revContextOf(view: string, rev: number): RevContext | null {
  return contextByRev.get(view)?.get(rev) ?? null;
}

/** 模型手里那份快照的锚点；从没发过完整快照时返回 null（第一次操作必须给 full） */
export function anchorOf(view: string): SnapshotAnchor | null {
  return anchorByView.get(view) ?? null;
}

/** 记下「刚发给模型的这一份」：下一次 diff 就以它为基准 */
export function setAnchor(view: string, anchor: SnapshotAnchor): void {
  anchorByView.set(view, anchor);
}

/** 推进某个页面的版本 */
export function bumpRev(view: string): number {
  const next = currentRev(view) + 1;
  revByView.set(view, next);
  return next;
}
