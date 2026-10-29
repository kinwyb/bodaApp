/**
 * 界面操作协议（对应 buibuiCodex 的 core/ws/protocol/payload.go 里 UIRequestData / UIResponseData）。
 *
 * 分工：**后端只做透传**，不认识下面的业务结构；快照由页面生产、由模型消费。
 * 所以这个文件是「页面结构与模型之间的契约」，改它等于改模型看到的世界。
 *
 * 五条约定（比字段本身更重要）：
 * 1. 快照是**目录**，不是数据：列表给全部列 + 行数 + 排序，**数据行要用 `<name>.page` 按需取**。
 *    早先的「前 20 行」既不是用户看到的 20 行（排序在表格内部），也白占上下文。
 * 2. 行标识用**业务主键**（rowId），不要用行号或数组下标 —— 排序一变就全错。
 *    但「按行号取数据」是允许的，且**必须与用户屏幕一致**：见 UIDataSummary.total。
 * 3. rev 是乐观锁：命令必须带上看快照时的 rev，不匹配就拒绝并要求重新观察。
 * 4. **模型能做的任何事都必须出现在 actions 里**：filters / selection / data 只是「当前是什么」，
 *    不是「怎么改」。只发数据不发命令，模型就只能干猜（筛选条件踩过这个坑）。
 * 5. **回执默认是补丁，不是整页快照**（v3）：一条命令只回它真正改变的那几段，列目录 / guide /
 *    参数说明这些静态段只出现在 observe、navigate 与结构变化的 full 里。所以「模型手里那份快照」
 *    = 最近一次 full + 之后所有 patch 合并出来的结果。
 * 6. **档位由桥算，不由页面写**（v4）：桥记着「模型手里那份快照的结构指纹 + 变化段指纹」，
 *    命令执行后拿新快照一比：结构变了发 full，什么都没变发 result，否则发 patch。
 *    `UIAction.returns` 只是**覆盖**这个判断的出口（纯读命令用它省掉一次等待），页面正常不用写。
 *    模型可以用 `patch.basedOn` 自查手里的快照是否还有效。
 */

import type { AgentEnvelope } from './envelope';
import { KIND, UI_TYPE, newEnvelope } from './envelope';

/**
 * 快照版本，结构不兼容变更时递增。
 * - v2：data 段改成目录 + 按需取行；
 * - v3：回执改成 result / patch / full 三档，patch 扩到能独立表达「取值变了」；
 * - v4：回执档位由桥 diff 得出（`returns` 退化成可选覆盖），快照带结构指纹 `fp`、补丁带 `basedOn`；
 * - v5：补丁本身也是增量的 —— 每段只列**变了的那几项**（改 2 个字段就只给 2 个字段）；
 * - v6：表增加「此刻读不读得到 / 用户看不看得见」（`readable` / `visible`）。
 *   一页多表（标签页、折叠区）时，未渲染的那张不该被当成「0 条数据」回答，
 *   切换标签页也只该改这两个状态、不该整页重发。
 * - v7：**表格只剩一个容器** —— `data` 并入 `tables[]`，单表页面也是一个元素的数组。
 *   同时把「一页多表就分不清归属」的两样东西下沉到每张表：`filters` 与 `selection`。
 *   两者的分工要说清（它们是**两件事**，不是一套东西的两种实现）：
 *   - 页面级 `query` = **数据查询**。业务层负责，改完重新请求（`query.set`），一次可能刷新整页；
 *   - 表级 `filters` = **表上的筛选**。桥**自动**对接 `FilterTable`（读 `getFilters`、
 *     写 `setFilters`），页面**不用为它写任何代码** —— 列上配了 `filterType` 就有。
 */
export const UI_SNAPSHOT_VERSION = 7;

/**
 * 命令参数的类型。
 *
 * 比 `UIFieldType` 多一个 `object`：批量参数（例如「字段 id → 新值」的一整张表）不是界面控件，
 * 它只是给模型的形状提示 —— 服务端只透传、不校验，页面自己决定收对象还是它的 JSON 字符串。
 */
export type UIActionParamType = UIFieldType | 'object';

/**
 * 一条命令的回执形态（由动作表声明，桥按它决定回什么，见 ui-bridge/handler.ts）。
 *
 * - `result` 纯读：不改变页面状态，不推 rev，回执只有 `result`。
 *   再夹一份整页快照是纯浪费 —— 那份快照里的数据行本来就是空的。典型：`<name>.page`、`<name>.row`。
 * - `patch` 默认：取值变了、结构没变。回执带 `patch`（选中、筛选取值、行数与排序、
 *   表单字段值、可用命令清单），并推 rev。列目录、guide、参数说明一个字节没变，不重发。
 * - `full` 结构变了才用：换页、打开弹窗（模型第一次见这张表单的字段表）、模式切换。
 *   整页快照 + 推 rev。
 *
 * 判据只有一条：**模型手里那份快照合并完这段变化之后，还差不差它没见过的东西**。
 * 差（新出现一段结构）就给 full，不差就给 patch。
 */
export type UIActionReturn = 'result' | 'patch' | 'full';

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
   * 回执形态的**显式覆盖**（见 `UIActionReturn`）。**正常不用写**：
   * 省略时由桥比较新旧快照自己定（结构变了 full、什么都没变 result、否则 patch）。
   *
   * 什么情况下才值得覆盖：纯读命令写 `result` —— 桥能省掉「等页面落定 + 取新快照」这一趟，
   * 回执也立刻发出（读命令本来就不改状态，diff 出来一定是什么都没有）。
   * 想强制每次都给整页目录（例如某个动作会换一整套命令但没有结构差异）才写 `full`。
   */
  returns?: UIActionReturn;
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

/**
 * 筛选控件类型（对应列定义上的 `filterType`）。
 * 与 `UIColumn.type`（值类型）是两件事：`enum` 是「从若干值里挑」，跟值本身是不是文本无关。
 */
export type UITableFilterType = 'enum' | 'text' | 'date' | 'number';

/**
 * 表的筛选条件 —— **只给「哪个字段、筛成了什么」，不给候选项**。
 *
 * 为什么不下发 enum 的候选项：产地、款号这类字段的候选值动辄几十上百个，
 * 一次快照就为它们付几千 token，而模型真正需要的只有一件事 —— **能按哪些字段筛**。
 * 那件事已经在列目录里了（`UIColumn.filter`），这里只补「此刻筛成了什么」。
 *
 * 归到表上是必须的：一页多表时每张表各筛各的，页面级只放一份就等于让模型猜。
 */
export type UITableFilter = {
  /** 列字段名，与 `columns[].field` 对齐（字段名、中文名、类型都在列目录里，这里不重复） */
  field: string;
  /**
   * 当前值：
   * - `enum`：值的数组（多选）；
   * - `text`：关键字；
   * - `date` / `number`：`起~止`，只有一头就是单值。
   */
  value: string | string[];
};

/** 列表列摘要：**全部列**，不是完整列定义（没有宽度、渲染格式、校验规则） */
export type UIColumn = {
  /** 取值键，`<name>.page` 的 fields 参数与行数据里的键都对应它 */
  field: string;
  /** 列头文字，用户就是按这个认列的 */
  title: string;
  /**
   * 值类型提示：决定模型怎么比较与格式化（"3" 与 3、"2026-01-01" 是字符串还是日期）。
   * 拿不到类型信息时省略，别猜。
   */
  type?: 'text' | 'number' | 'date' | 'boolean';
  /**
   * 这一列**能不能筛、用哪种控件筛**（列上配了 `filterType` 才有；省略 = 不能筛）。
   *
   * 「能筛哪些字段」就靠这一个短键表达 —— 不另发一份筛选字段清单（那就与列目录重复了）。
   * 候选值（enum 的选项）**故意不下发**：几十上百个值纯占上下文，模型要知道的是「能按产地筛」，
   * 不是「产地有哪 63 个取值」。真要填值时用 `<name>.filter.options` 按需取（还能按 `match` 缩小），
   * 或传业务上已知的那个。
   */
  filter?: UITableFilterType;
  /** 业务提示，例如「单位：件」「可选值：越南工厂 / 义乌工厂」 */
  hint?: string;
};

/** 数据窗口：offset 是 0 起的**显示行号**（0 即用户屏幕第一行） */
export type UIWindow = {
  offset: number;
  limit: number;
};

/**
 * 一张表的目录 = **快照里表格段的唯一形状**（不论页面只有一张表还是有好几张）。
 *
 * 为什么不再默认塞前若干行：用户说「第 5 条」时，那 20 行既帮不上（排序在表格内部，
 * 快照那份顺序和屏幕不一致），又白占上下文（每行 30 多列全塞进去更是不可能）。
 * 现在只回答「有哪些列、一共几行、按什么排的、筛了什么、选中了谁」，
 * 要哪几行由模型用 `<name>.page` 自己取。
 */
export type UIDataSummary = {
  /**
   * 这张表的**对象名**，也是它在这个页面上的**定位键**：取数 `order.page`、选中 `order.select`。
   *
   * 为什么必须带名字：一个页面上可能有好几张表（主表 + 明细 + 标签页），命令 ID 撞在一起就
   * 没法区分「读哪张」「选中哪张」，补丁合并时也认不出该改哪一段。
   * **单表页面通常不写**（默认名 `data`，命令就是 `data.page`）—— 「默认表」叫 data，
   * 与容器叫什么无关：即使 `tables` 里只有一个元素，它的 name 仍然是 `data`。
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
   * 这张表此刻**读不读得到**。省略 = 能读（绝大多数情况）。
   *
   * 为 false 的典型场景：控件还没挂载（标签页没切过去、折叠区没展开）、数据还没回来、
   * 当前账号没有这张表的权限。**这时 `total` / `sorts` / `active` 都不代表真实情况** ——
   * 别据此回答「共几条」，先按 `readableReason` 说的把它变成可读（切标签页 / 展开行）。
   */
  readable?: boolean;
  /** `readable` 为 false 时说明为什么读不到、怎么才能读（页面自己给，桥不猜） */
  readableReason?: string;
  /**
   * 用户此刻**看不看得见**这张表。省略 = 看得见。
   *
   * 为 false 的典型场景：表在没激活的标签页里（或折叠区里）—— 挂载了、读得到，
   * 但用户没有在看它。用户说「这一行」时指的**不是**它。
   *
   * 与 `readable` 是两个维度：看不见但读得到（切走过，实例还在）、
   * 看不见也读不到（从没打开过，库都是冷的）、看得见当然也读得到。
   * 「看不见却读得到」正是切标签页之后的状态，所以两者不能合成一个字段。
   */
  visible?: boolean;
  /**
   * 显示行总数 —— **与用户屏幕上的行数一致**（跟随筛选、排序、分组，含底部统计行）。
   *
   * 同时它是 `<name>.page` 的 `offset` 上界：`offset` 取 `0..total-1`。
   * `readable: false` 时它是 0，但那个 0 的意思是「不知道」，不是「没有数据」。
   */
  total: number;
  /** 已加载条数（纯前端列表等于 total；服务端分页时会小于 total） */
  loaded: number;
  columns: UIColumn[];
  /**
   * 这张表此刻的筛选条件（只有 `field` + 当前值，**不含 title / 类型 / 候选项** ——
   * 字段名、中文名、能不能筛都在 `columns` 里，这里不重复）。
   *
   * `total` 是筛选之后的显示行数 —— 模型看到行数偏少时先看这里与页面级 `query`，
   * 别一上来就怀疑数据没取全。没有筛就省略（而不是给空数组）。
   */
  filters?: UITableFilter[];
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
  /**
   * 这张表的选中态（命令的 disabled 大多由它决定）。
   *
   * 必须挂在表上：一页多表时 `items.select` 与 `colors.select` 各选各的，
   * 页面级只放一份就等于让模型猜「这个选中属于哪张表」。没有选中时省略。
   */
  selection?: UISelection;
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
  /**
   * 页面级**数据查询条件**（查询表单 / 拉库参数）—— 改它要重新发请求。
   *
   * 与表的 `filters` 是两件事：
   * - 这里改一次会重新查库，可能一次刷新全页的表（主从一起查），所以它**属于页面**；
   * - 表的 `filters` 是筛选面板那套，纯前端隐掉几行，由桥自动读写（见 `UIDataSummary.filters`）。
   *
   * 判据：**改完要不要发请求**。要发就在这（业务层负责），不发就在表里（桥自动管）。
   */
  query?: UIField[];
  /**
   * 本页的表格 —— **表格段唯一的容器，单表页面也是一个元素的数组**。
   *
   * 早先有个 `data` 字段专门表示「主表」，`tables` 存其余的表。那套形状的问题在于
   * 「主表」在不同页面上含义不同（BOM 矩阵里是唯一可编辑的那张、预订单里是唯一一张），
   * 模型要记两套位置、补丁要合并两个段、指纹要拼一次数组 —— 而收益只是省一层方括号。
   * 现在一律是数组：谁是谁全靠 `name`，单表页面自然就是 `tables: [one]`。
   *
   * 数组顺序不代表优先级，**定位只认 `name`**（结构指纹里也按 name 排序，见桥的 structureKey）。
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
  /**
   * **结构指纹**（8 位十六进制）：这一份快照里「模型必须知道才能看懂补丁」的那部分
   * （模式、命令表与参数说明、列目录、guide、字段表、可导航清单）的哈希。
   *
   * 由桥计算，页面不用管。作用是让模型能自查手里的快照还作不作数：
   * 补丁的 `basedOn` 与自己那份快照的 `fp` 不一致（或压根没有），就先 `ui_observe`。
   */
  fp: string;
};

/**
 * 表格段的补丁：`UIDataSummary` 里**会变**的那几项。
 *
 * 故意不带 `columns` 与 `rowKey` —— 它们是这张表的目录，只有换页 / 换表才会变，
 * 而那属于 `full`（模型没见过这份目录）。
 *
 * 这里也只带真正变了的键（除了定位用的 `name`）：行数变了就只给 `total/loaded`，
 * 没变的 `sorts/grouped` 不重发。
 */
export type UITablePatch = {
  /** 哪张表：与快照里 `tables[].name` 对齐（单表页面通常是 `data`） */
  name: string;
  total?: number;
  loaded?: number;
  sorts?: { field: string; order: 'asc' | 'desc' }[];
  grouped?: boolean;
  /**
   * 表内筛选取**当前值**（整段覆盖，没筛就是空数组）：按字段逐条比意义不大 ——
   * 表里通常只有两三个条件，而「去掉一个条件」在增量里表达不出来（省略只能表示没变）。
   */
  filters?: UITableFilter[];
  /**
   * 此刻读不读得到 / 用户看不看得见（见 `UIDataSummary` 同名字段）。
   *
   * **两个都是「当前值」而不是「变化量」**：从能读变成不能读、以及反过来，
   * 都必须如实出现 —— 省略只能表示「没变」，不能表示「恢复了」，
   * 否则模型会一直以为那张表还是读不到。
   */
  readable?: boolean;
  readableReason?: string;
  visible?: boolean;
  /** 底部统计行的显示行号；null = 没有统计行 */
  summaryRow?: number | null;
  /** 激活行的显示行号（0 起，与 `<name>.page` 的 offset 同一套坐标）；null = 没有激活行 */
  activeRowIndex?: number | null;
  /**
   * 选中态（整段覆盖）：选中集合变了就整份给。
   *
   * 激活行的**主键**也在这里（`activeRowId`），不再单开一个字段 —— 同一件事两处给，
   * 迟早会出现「补丁里 activeRowId 换了、selection 还是旧的」这种自相矛盾。
   */
  selection?: UISelection;
};

/** 字段级补丁：只给「值 + 还能不能改 + 报错」，label / type / options 属于目录 */
export type UIFieldPatch = {
  id: string;
  value?: unknown;
  /** 此刻是否被锁住（新增未检测通过这类），不给表示没变 */
  readOnly?: boolean;
  errors?: string[];
};

/** 表单段的补丁：除 `id` 外每项都只在变了时出现，`fields` 只列变了的那几项 */
export type UIFormPatch = {
  /** 哪个表单：与快照里 `form.id` 对齐（合并时按它定位） */
  id: string;
  title?: string;
  mode?: UIForm['mode'];
  recordId?: string | null;
  dirty?: boolean;
  /** 表单级报错（明细校验这类不属于单个字段的） */
  errors?: string[];
  fields?: UIFieldPatch[];
};

/**
 * 回执里的**快照补丁**：只含本次操作真正改变的段（见 `UIAction.returns`）。
 *
 * 模型要把它合并进手里那份快照，而不是当成一份新快照 —— 没出现的段表示「没变」。
 * `patch` 默认用在「取值变了、结构没变」的绝大多数命令上：选中、改筛选、删单、保存、填字段。
 *
 * **段内部同样是增量的**（v5）：`query` 与 `form.fields` 只列变了的那几项（按 `id` 覆盖合并），
 * `tables` 只带变了的键（按 `name` 定位个表，表内再逐键比）。
 * 一次填 2 个字段就只回 2 个字段，不会把整张 16 项的表单重发一遍。
 *
 * 两条合并约定，别搞混：
 * - `mode` 为 `form` 时，快照里的 `query` / `tables` 表示「被弹窗挡住了」，
 *   与 full 快照把它们置空是同一个意思，不用补丁里再出现一次；
 * - `enabled` 是**当前可执行**的命令 ID 全集（不是增量）。没列出来的命令仍然存在，
 *   只是 disabled，原因见原快照的 `disabledReason`。**这一项是全集覆盖，不做增量**。
 */
export type UISnapshotPatch = {
  /** 合并目标：哪个页面的快照 */
  view: string;
  /**
   * 这份补丁针对的结构指纹（等于它要合并进去的那份快照的 `fp`）。
   *
   * 对不上就说明手里没有对应的完整快照（上下文被折叠过、或这是本会话第一次操作这页）：
   * 别硬合，先 `ui_observe` 取一份带目录的快照。
   */
  basedOn: string;
  mode?: 'list' | 'form';
  /** 变了的那几个**数据查询条件**（按 id 覆盖；label / type 在目录里，补丁只带给值与报错） */
  query?: UIFieldPatch[];
  /**
   * 变了的那几张表，按 `name` 合并进快照的 `tables[]`。
   *
   * 筛选与选中也在这段里（见 `UITablePatch`）—— 它们本来就属于表，
   * 补丁不在页面层再开一个 `selection` 段，否则一页多表时又分不清归属。
   */
  tables?: UITablePatch[];
  /** 弹窗打开时的表单段 */
  form?: UIFormPatch;
  /** 当前**可执行**的命令 ID 全集 */
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
  /** observe / navigate 的返回，或 `returns: 'full'` 命令的新快照 */
  snapshot?: UISnapshot;
  /** 本次只变了这些段（与 snapshot 二选一，不同时出现；绝大多数命令走这条） */
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
