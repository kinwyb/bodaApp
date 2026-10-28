/**
 * 界面桥的宿主契约。
 *
 * 页面只做两件事：描述自己（snapshot）和声明每条命令怎么执行（handlers）。
 * 「快照长什么样、命令怎么校验、回执怎么发」都在桥这一层，页面不重复实现。
 */

import type { UIAction, UIGuide, UIForm, UINavItem, UISnapshotData } from '../protocol';

/** 一条命令的执行函数：参数来自模型，返回值作为 result 回传给模型 */
export type UIBridgeHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

/** 业务页面注册给桥的能力：只描述「本页」 */
export type UIBridgeHost = {
  /**
   * 生成当前页面快照；纯读取，不应有副作用。
   *
   * observe / navigate 直接把它发给模型；act 之后桥也从这里取，但**默认只发变化的那几段**
   * （见协议里的 `UIAction.returns`）—— 所以它可以放心地算得细一点，字节数由桥控制。
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
  /**
   * 可操作的页面清单（权限过滤后的菜单里，**只保留已接入界面桥的页面**，
   * 已平铺成 {view, title, trail}）。
   *
   * 没接桥的页面 agent 既看不见内容也执行不了命令，列出来只会让它白跑一趟
   * （navigate 过去再超时）。哪些算「已接入」由目录下的 `bridged.ts` 决定，
   * 见 `bridged.ts` / `isBridgedView`。
   */
  navigation: () => UINavItem[];
  /**
   * 这个 view 是否在当前账号的菜单里（不论有没有接入桥）。
   *
   * 只用于把 navigate 的失败原因说准：菜单里没有 = 没权限，菜单里有 = 这页没接入。
   * 两种原因的排查方向完全不同，混成一句话会让人去查权限。
   */
  canOpen?: (view: string) => boolean;
  /** 打开或激活一个页面，等价于点左侧菜单 */
  openView: (view: string, params?: Record<string, unknown>) => void;
};

/**
 * 弹窗层：由弹窗组件自己注册，**只在打开期间生效**。
 *
 * 为什么要单独一层而不是让页面转述：弹窗的字段、动作、提交语义都属于弹窗自己。
 * 让页面代劳的话，一个页面上有五个弹窗，`index.tsx` 里就要写五份字段映射 + 动作表 + 处理函数，
 * 页面文件变成瓶颈 —— 改弹窗还得回页面里改，且页面被某个弹窗的形状绑死。
 *
 * 打开时的覆盖规则在桥里统一实现（页面与弹窗都不用管）：
 * 弹窗的 actions 顶掉页面工具栏动作、mode 变 form、filters/data 清空（它们被弹窗挡住了）。
 * 同时只会有一个弹窗打开，所以「后注册的生效」等价于「最上面那个生效」。
 *
 * **表单类弹窗请提供 `form.setMany`**（一次收一整张 `{字段id: 新值}`），别只给 `form.set`：
 * 一次 `ui_act` 只能带一条命令，逐字段设的话 16 个字段就是 16 次往返、16 段补丁、16 轮推理 ——
 * 模型每一轮都要重新读一遍才知道下一个填什么。写入顺序（哪几个字段要先检测/查人）由弹窗自己定。
 */
export type UIDialogHost = {
  /** 快照里的 form 段：弹窗的标题、模式、字段与取值 */
  snapshot: () => UIForm;
  /** 弹窗自己的动作表，打开期间顶掉页面工具栏动作 */
  actions: () => UIAction[];
  /** 弹窗自己的命令处理（form.setMany / form.set / form.submit / ...） */
  handlers: Record<string, UIBridgeHandler>;
  /** 本弹窗的操作说明；不填则沿用页面的 guide */
  guide?: UIGuide;
  /** 是否已就绪（编辑/复制要先把数据拉回来，那之前字段是空的） */
  ready?: () => boolean;
};
