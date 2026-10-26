/**
 * 界面操作协议（对应 buibuiCodex 的 core/ws/protocol/payload.go 里 UIRequestData / UIResponseData）。
 *
 * 分工：**后端只做透传**，不认识下面的业务结构；快照由页面生产、由模型消费。
 * 所以这个文件是「页面结构与模型之间的契约」，改它等于改模型看到的世界。
 *
 * 三条约定（比字段本身更重要）：
 * 1. 快照是**当前视野**，不是完整数据集：列表只给识别列 + 前若干行，超出要标 truncated。
 * 2. 行标识用**业务主键**（rowId），不要用行号或数组下标 —— 排序一变就全错。
 * 3. rev 是乐观锁：命令必须带上看快照时的 rev，不匹配就拒绝并要求重新观察。
 * 4. **模型能做的任何事都必须出现在 actions 里**：filters / selection / data 只是「当前是什么」，
 *    不是「怎么改」。只发数据不发命令，模型就只能干猜（筛选条件踩过这个坑）。
 */

import type { AgentEnvelope } from './envelope';
import { KIND, UI_TYPE, newEnvelope } from './envelope';

/** 快照版本，结构不兼容变更时递增 */
export const UI_SNAPSHOT_VERSION = 1;

/** 命令参数说明：模型据此构造 ui_act 的 params，不用去猜字段名 */
export type UIActionParam = {
  /** 参数名，就是 ui_act 的 params 里的键 */
  name: string;
  type: UIFieldType;
  required?: boolean;
  /** 可选值（下拉类参数） */
  options?: string[];
  /** 这个参数对应界面上的什么，例如「产地」 */
  hint?: string;
};

/** 可执行动作：CommandBar 的命令、页面零散按钮、表单提交都归到这里 */
export type UIAction = {
  /** 命令 ID，agent 的 ui_act 就是按它分发 */
  id: string;
  /** 人类可读名称，模型主要靠它理解这个命令做什么 */
  label: string;
  /** 命令所在位置：工具栏 / 筛选区 / 表单内 / 行内 */
  group?: 'toolbar' | 'filter' | 'form' | 'row';
  danger?: boolean;
  disabled?: boolean;
  /** 不可用原因。模型看到 disabled 会猜，给一句话比让它试错便宜得多 */
  disabledReason?: string;
  /** 需要的参数；不填表示这条命令不需要参数 */
  params?: UIActionParam[];
};

/** 界面控件的类型，决定模型怎么填值 */
export type UIFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'switch'
  | 'textarea'
  | 'readonly';

/** 表单字段 / 筛选条件共用的控件描述 */
export type UIField = {
  /** 稳定 ID：antd 表单下就是 Form name + Form.Item name 拼出的字段 ID */
  id: string;
  label: string;
  type: UIFieldType;
  value?: unknown;
  options?: string[];
  required?: boolean;
  readOnly?: boolean;
  /** 业务含义提示，例如「单位：件」「格式 YYYY-MM-DD」 */
  hint?: string;
  errors?: string[];
};

/** 选中态：命令的 disabled 大多由它决定，模型据此知道为什么点不动 */
export type UISelection = {
  count: number;
  activeRowId: string | null;
  rowIds: string[];
};

/** 列表列摘要：只列识别列，不是全部列定义 */
export type UIColumn = {
  field: string;
  title: string;
};

/** 列表数据摘要：识别列 + 前若干行 + 激活行全量数据 */
export type UIDataSummary = {
  /** 后端总数（不等于已加载数） */
  total: number;
  /** 当前页已加载条数 */
  loaded: number;
  /** 本次实际给了几行 */
  shown: number;
  /** shown < total 时为 true：要看更多得先筛，别反复刷新 */
  truncated: boolean;
  columns: UIColumn[];
  rows: Record<string, unknown>[];
  /** 当前激活行的完整数据，模型据此决策编辑、发布等下一步 */
  active?: Record<string, unknown>;
};

/** 当前打开的表单/弹窗 */
export type UIForm = {
  id: string;
  title: string;
  mode: 'add' | 'edit' | 'view' | 'copy';
  recordId: string | null;
  fields: UIField[];
  errors: string[];
  dirty: boolean;
};

/**
 * 页面自述（本页怎么操作）。
 *
 * 由页面作者人工编写，**只写快照里推不出来的东西**：步骤顺序、前置条件、业务术语映射、陷阱。
 * 两条禁忌：
 * - 不写命令清单（命令已经在 actions 里，再写一份就是平行维护，必然对不上）；
 * - 不从页面数据生成（它是可信内容，data 是不可信内容，混起来等于把用户文本当指令）。
 */
export type UIGuide = {
  /** 一句话说明这一页是干什么的 */
  summary?: string;
  /** 本页特有的操作顺序与前置条件 */
  steps?: string[];
  /** 业务术语 → 字段取值，例如 { 越南工厂: "workPlace = 越南" } */
  terms?: Record<string, string>;
  /** 容易踩的坑，例如「发布后不可撤销」 */
  cautions?: string[];
};

/** 可导航的页面条目（来自权限过滤后的菜单树） */
export type UINavItem = {
  /** 菜单的 View 字段，ui_navigate 用它打开页面 */
  view: string;
  /** 菜单名，模型按业务名称选，不要按 URL 猜 */
  title: string;
  /** 从根到当前的层级，例如 ["计划管理", "预订单"] */
  trail?: string[];
};

/** 页面发布给桥的结构（rev / ts 由桥补齐，页面不用管） */
export type UISnapshotData = {
  /** 页面标识，如 V0189_V0279_V0280（来自路由/视图注册表） */
  view: string;
  title?: string;
  mode?: 'list' | 'form';
  /** 本页怎么操作，由页面提供 */
  guide?: UIGuide;
  actions: UIAction[];
  filters?: UIField[];
  selection?: UISelection;
  data?: UIDataSummary | null;
  form?: UIForm | null;
  /**
   * 能打开哪些页面。只在「当前没有业务页面」时给（主页），且只给顶层若干条 ——
   * 菜单上百项，每次 observe 都全量下发是纯浪费；要搜完整菜单用 ui_navigate 的 query。
   */
  navigation?: UINavItem[];
};

/** 下发给模型的完整快照 */
export type UISnapshot = UISnapshotData & {
  v: number;
  rev: number;
  ts: number;
};

/** 服务端的操作类型 */
export type UIRequestOp = 'observe' | 'act' | 'navigate';

/** 服务端下发的请求载荷 */
export type UIRequestPayload = {
  op: UIRequestOp;
  /** act 的命令 ID，必须来自最近一次快照的 actions[].id */
  cmd?: string;
  params?: Record<string, unknown>;
  /** 看快照时的页面版本 */
  rev?: number;
  /** navigate 的目标页面（菜单的 View 字段）；与 query 二选一 */
  view?: string;
  /** navigate 的检索词：只给 query 表示「搜菜单」，不导航 */
  query?: string;
};

/** 浏览器回传的结果载荷 */
export type UIResponsePayload = {
  ok: boolean;
  /** ok=false 必填：会原样交给模型，所以要说清「为什么」 */
  error?: string;
  rev?: number;
  /** observe 的返回，或 act 成功后的新快照 */
  snapshot?: UISnapshot;
  /** 命令自身的执行结果 */
  result?: unknown;
};

/** 解析下行 ui.request 载荷，非法时返回 null（按协议忽略未知消息） */
export function parseUIRequest(data: unknown): UIRequestPayload | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Partial<UIRequestPayload>;
  if (raw.op !== 'observe' && raw.op !== 'act' && raw.op !== 'navigate') return null;

  const payload: UIRequestPayload = { op: raw.op };
  if (typeof raw.cmd === 'string' && raw.cmd) payload.cmd = raw.cmd;
  if (raw.params && typeof raw.params === 'object') {
    payload.params = raw.params as Record<string, unknown>;
  }
  if (typeof raw.rev === 'number') payload.rev = raw.rev;
  if (typeof raw.view === 'string' && raw.view) payload.view = raw.view;
  if (typeof raw.query === 'string' && raw.query) payload.query = raw.query;
  return payload;
}

/**
 * 构造上行回执。
 *
 * sessionID 必须原样带回：服务端用它校验回执与请求属于同一会话，
 * 也避免同一用户多标签页之间串号（见 core/ws/server/ui.go 的 handleUIResponse）。
 */
export function buildUIResponse(
  payload: UIResponsePayload,
  request: { replyTo: string; sessionID?: string },
): AgentEnvelope {
  const envelope = newEnvelope({
    kind: KIND.client,
    type: UI_TYPE.response,
    sessionID: request.sessionID,
    data: payload,
  });
  envelope.replyTo = request.replyTo;
  return envelope;
}
