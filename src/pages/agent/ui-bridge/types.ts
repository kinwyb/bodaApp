/**
 * 界面桥的宿主契约。
 *
 * 页面只做两件事：描述自己（snapshot）和声明每条命令怎么执行（handlers）。
 * 「快照长什么样、命令怎么校验、回执怎么发」都在桥这一层，页面不重复实现。
 */

import type { UISnapshotData } from '../protocol';

/** 一条命令的执行函数：参数来自模型，返回值作为 result 回传给模型 */
export type UIBridgeHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

/** 页面注册给桥的能力 */
export type UIBridgeHost = {
  /** 生成当前页面快照；纯读取，不应有副作用。每次 observe / act 后都会被调用 */
  snapshot: () => UISnapshotData;
  /** 命令 ID → 执行函数；ID 必须与 snapshot().actions[].id 对齐 */
  handlers?: Record<string, UIBridgeHandler>;
};
