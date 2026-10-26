/**
 * 界面桥的宿主契约。
 *
 * 页面只做两件事：描述自己（snapshot）和声明每条命令怎么执行（handlers）。
 * 「快照长什么样、命令怎么校验、回执怎么发」都在桥这一层，页面不重复实现。
 */

import type { UINavItem, UISnapshotData } from '../protocol';

/** 一条命令的执行函数：参数来自模型，返回值作为 result 回传给模型 */
export type UIBridgeHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

/** 业务页面注册给桥的能力：只描述「本页」 */
export type UIBridgeHost = {
  /**
   * 生成当前页面快照；纯读取，不应有副作用。每次 observe / act / navigate 后都会被调用。
   * guide 也由这里给出（属于「这一页怎么操作」，与页面描述同源）。
   */
  snapshot: () => UISnapshotData;
  /** 命令 ID → 执行函数；ID 必须与 snapshot().actions[].id 对齐 */
  handlers?: Record<string, UIBridgeHandler>;
  /**
   * 页面是否已就绪（数据加载完）。ui_navigate 会等它变 true 再回执 ——
   * 否则模型拿到的是一份空列表，会以为页面没打开。不填视为「挂载即就绪」。
   */
  ready?: () => boolean;
};

/**
 * 工作台级宿主：挂在 MainLayout 上，全局唯一。
 *
 * 它管「去哪」而不是「怎么操作」：当前是哪个页面、有哪些页面能打开、怎么打开。
 */
export type UIWorkbenchHost = {
  /** 当前激活页面的 view；停在主页时为空串 */
  currentView: () => string;
  /** 可打开的页面清单（权限过滤后的菜单，已平铺成 {view, title, trail}） */
  navigation: () => UINavItem[];
  /** 打开或激活一个页面，等价于点左侧菜单 */
  openView: (view: string, params?: Record<string, unknown>) => void;
};
