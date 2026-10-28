/**
 * 界面操作协议（对应 buibuiCodex 的 core/ws/protocol/payload.go 里 UIRequestData / UIResponseData）。
 *
 * 分工：**后端只做透传**，不认识下面的业务结构；快照由页面生产、由模型消费。
 * 所以这个文件是「页面结构与模型之间的契约」，改它等于改模型看到的世界。
 *
 * 四条约定（比字段本身更重要）：
 * 1. 快照是**目录**，不是数据：列表给全部列 + 行数 + 排序，**数据行要用 data.page 按需取**。
 *    早先的「前 20 行」既不是用户看到的 20 行（排序在表格内部），也白占上下文。
 * 2. 行标识用**业务主键**（rowId），不要用行号或数组下标 —— 排序一变就全错。
 *    但「按行号取数据」是允许的，且**必须与用户屏幕一致**：见 UIDataSummary.total。
 * 3. rev 是乐观锁：命令必须带上看快照时的 rev，不匹配就拒绝并要求重新观察。
 * 4. **模型能做的任何事都必须出现在 actions 里**：filters / selection / data 只是「当前是什么」，
 *    不是「怎么改」。只发数据不发命令，模型就只能干猜（筛选条件踩过这个坑）。
 */

import type { AgentEnvelope } from './envelope';
import { KIND, UI_TYPE, newEnvelope } from './envelope';

/** 快照版本，结构不兼容变更时递增（v2：data 段改成目录 + 按需取行） */
export const UI_SNAPSHOT_VERSION = 2;

/**
 * 命令参数的类型。
 *
 * 比 `UIFieldType` 多一个 `object`：批量参数（例如「字段 id → 新值」的一整张表）不是界面控件，
 * 它只是给模型的形状提示 —— 服务端只透传、不校验，页面自己决定收对象还是它的 JSON 字符串。
 */
export type UIActionParamType = UIFieldType | 'object';

/** 命令参数说明：模型据此构造 ui_act 的 params，不用去猜字段名 */
export type UIActionParam = {
  /** 参数名，就是 ui_act 的 params 里的键 */
  name: string;
  type: UIActionParamType;
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
  /**
   * **纯读命令**：不改变页面状态。
   *
   * 两个后果，都写在桥里统一处理（命令自己不用管）：
   * - 不推进 rev —— 否则模型每读一次都要重新 observe 才能读下一次；
   * - 回执**不带快照** —— 读命令的产出就在 `result` 里，再夹一份整页快照是纯浪费，
   *   而且那份快照里的数据行还是空的（快照本来就不带数据）。
   *
   * 典型：按行号取数据（data.page）、按主键取整行（data.row）。
   */
  readOnly?: boolean;
  /**
   * **轻量回执**：只改了选中态这类「快照里一小块」的操作。
   *
   * 回执只带 `patch`（selection / activeRowIndex / enabled 命令清单），不回整页快照；
   * 也不推进 rev —— 选中不影响任何命令的可用性判断（`runAction` 读的是**当前**动作表，
   * 不是快照里的那份），推 rev 只会逼模型再 observe 一次。
   *
   * 什么时候**不能**标它：这个操作还会让列表数据 / 表单内容变（例如选中后去查明细、
   * 触发重新加载）。那种情况模型需要新的目录或字段，必须走完整快照。
   *
   * `readOnly` 优先于它（读命令连 patch 都不给）。
   */
  lightweight?: boolean;
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

/** 列表列摘要：**全部列**，不是完整列定义（没有宽度、渲染格式、校验规则） */
export type UIColumn = {
  /** 取值键，data.page 的 fields 参数与行数据里的键都对应它 */
  field: string;
  /** 列头文字，用户就是按这个认列的 */
  title: string;
  /**
   * 值类型提示：决定模型怎么比较与格式化（"3" 与 3、"2026-01-01" 是字符串还是日期）。
   * 拿不到类型信息时省略，别猜。
   */
  type?: 'text' | 'number' | 'date' | 'boolean';
  /** 业务提示，例如「单位：件」「可选值：越南工厂 / 义乌工厂」 */
  hint?: string;
};

/** 数据窗口：offset 是 0 起的**显示行号**（0 即用户屏幕第一行） */
export type UIWindow = {
  offset: number;
  limit: number;
};

/**
 * 列表数据摘要 = **目录**，不含数据行。
 *
 * 为什么不再默认塞前若干行：用户说「第 5 条」时，那 20 行既帮不上（排序在表格内部，
 * 快照那份顺序和屏幕不一致），又白占上下文（每行 30 多列全塞进去更是不可能）。
 * 现在只回答「有哪些列、一共几行、按什么排的」，要哪几行由模型用 data.page 自己取。
 */
export type UIDataSummary = {
  /**
   * 这张表的**对象名**，也是取数命令的前缀：`name` 为 `order` → 取数用 `order.page`、选中用 `order.select`。
   *
   * 为什么必须带名字：一个页面上可能有两张表（主表 + 明细），命令 ID 撞在一起就没法区分
   * 「读哪张」「选中哪张」。默认名 `data`（单表页面的命令就是 `data.page`），页面可以自定义。
   */
  name: string;
  /**
   * 行主键字段名 —— 行数据里 `rowId` 的值就取自这个字段（例如 `ID`）。
   *
   * **它通常不在 `columns` 里**：表格不显示主键，但 agent 必须知道它 ——
   * 否则只拿到一个 rowId 的值、不知道它属于哪个字段，也没法在完整记录里认出主键。
   * 「按主键取完整一行」用的就是它（见 `<name>.row`）。
   */
  rowKey: string;
  /**
   * 显示行总数 —— **与用户屏幕上的行数一致**（跟随筛选、排序、分组，含底部统计行）。
   *
   * 同时它是 `<name>.page` 的 `offset` 上界：`offset` 取 `0..total-1`。
   */
  total: number;
  /** 已加载条数（纯前端列表等于 total；服务端分页时会小于 total） */
  loaded: number;
  columns: UIColumn[];
  /**
   * 当前排序：**数组**，按优先级从高到低；空数组 = 没排序（顺序即数据传入顺序）。
   *
   * 数组而不是单个对象：多列排序天生是多条（表格组件目前只排一列，所以现在最多一项）。
   */
  sorts: { field: string; order: 'asc' | 'desc' }[];
  /** 是否分组显示：为 true 时取到的行里会混入组行（isGroupRow），它们没有业务主键 */
  grouped: boolean;
  /**
   * 底部统计行的显示行号（0 起）；没有统计行时为 null。
   *
   * 有了它，模型才不会把汇总行的合计当成「第 N 条单据」—— 统计行确实占一个行号
   * （用户屏幕上看得见），但它的数值是合计，不是业务数据。
   */
  summaryRow?: number | null;
  /** 附带的数行数据（只有页面主动给的时候才有，默认不给）；给了就必须带 window */
  rows?: Record<string, unknown>[];
  /** rows 对应的窗口 */
  window?: UIWindow;
  /** 当前激活行的完整数据，模型据此决策编辑、发布等下一步 */
  active?: Record<string, unknown>;
  /** 激活行的显示行号（0 起）；没有激活行为 null */
  activeRowIndex?: number | null;
};

/** 当前打开的表单/弹窗 */
export type UIForm = {
  id: string;
  title: string;
  mode: 'add' | 'edit' | 'view' | 'copy';
  recordId: string | null;
  fields: UIField[];
  errors: string[];
  /** 是否有未保存的改动；页面不提供时省略，不要瞎猜成 false */
  dirty?: boolean;
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
  /**
   * **主表**的目录（agent 默认操作的那张）。没有表格的页面不填。
   *
   * `data.name` 决定取数 / 选中的命令前缀（默认 `data` → `data.page`、`data.select`）。
   */
  data?: UIDataSummary | null;
  /**
   * 同一页面上的**其他表**（主表之外的，例如主表明细、汇总表）。
   *
   * 每张表都带自己的 `name`，命令各用各的前缀（`detail.page` / `detail.select`）——
   * 所以「一页多表」不会撞命令，也不会让模型分不清在读哪一张。
   * 只有一张表时不要填这个字段（`data` 就够了）。
   */
  tables?: UIDataSummary[];
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

/**
 * 轻量回执的**快照补丁**：只含本次操作真正改变的段（见 `UIAction.lightweight`）。
 *
 * 模型要把它合并进手里那份快照，而不是当成一份新快照 —— 没出现的段表示「没变」。
 * 目前只用于「选中行」：它改的就是 selection、激活行，以及由此变可用的命令。
 */
export type UISnapshotPatch = {
  selection?: UISelection;
  /** 激活行的显示行号（0 起，与 `<name>.page` 的 offset 同一套坐标）；null = 没有激活行 */
  activeRowIndex?: number | null;
  /** 当前**可执行**的命令 ID。没列出来的命令仍然存在，只是 disabled（原因见原快照） */
  enabled?: string[];
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
  /** 轻量回执：本次只变了这些段（与 snapshot 二选一，不同时出现） */
  patch?: UISnapshotPatch;
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
