/**
 * 当前页面的界面桥宿主。
 *
 * 同一时刻只有一个「当前页面」：工作台是多标签页，但 agent 操作的是用户正在看的那个，
 * 所以后注册者覆盖先注册者，页面卸载时再注销。
 *
 * 存 getter 而不是快照对象：React 每次渲染都会产生新的闭包，存 getter 能让桥
 * 始终读到最新的 state，而不必为了更新描述而反复注册。
 */

import type { UIBridgeHost } from './types';

let hostGetter: (() => UIBridgeHost | null) | null = null;

/**
 * 页面版本号（乐观锁）。
 *
 * 当前实现：每完成一次操作推进一格，用于拦住「拿着旧快照继续操作」这种错误。
 * 它**不等于**页面真实状态的版本——用户自己改筛选、翻页不会推进它。
 * 真实实现应由页面状态派生（例如查询条件的序列化值 + 数据版本），
 * 这样并发操作才有意义。
 */
let rev = 1;

/** 注册宿主，返回注销函数 */
export function registerUIBridgeHost(getter: () => UIBridgeHost | null): () => void {
  hostGetter = getter;
  return () => {
    // 只有还是自己注册的那个才清空，避免后注册者被先卸载的页面误注销
    if (hostGetter === getter) hostGetter = null;
  };
}

/** 取当前宿主，没有注册时返回 null */
export function getUIBridgeHost(): UIBridgeHost | null {
  return hostGetter ? hostGetter() : null;
}

/** 当前页面版本 */
export function currentRev(): number {
  return rev;
}

/** 推进页面版本 */
export function bumpRev(): number {
  rev += 1;
  return rev;
}
