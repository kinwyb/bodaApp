import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Spin } from 'antd';
import { ListTable,themes } from '@visactor/vtable';
import type { ColumnsDefine, ListTableConstructorOptions } from '@visactor/vtable';
import { TableExportPlugin } from '@visactor/vtable-plugins';
import type { TableExportPluginOptions } from '@visactor/vtable-plugins';

/**
 * 插件包只从根导出了 TableExportPluginOptions，没导出下面这两个子类型
 * （它们在 es/table-export/index 里，而 package.json 的 exports 字段只放开了 "." 和 "./gantt-extensions"，
 * 深路径导入会被拦），所以从 TableExportPluginOptions 上取。
 */
export type VTableExportExcelOptions = NonNullable<TableExportPluginOptions['exportExcelOptions']>;
export type VTableExportCsvOptions = NonNullable<TableExportPluginOptions['exportCsvOptions']>;
export type { TableExportPluginOptions };

/** 样式回调参数（VTable 未从包根导出该类型，这里按官方定义声明） */
interface StyleArgs {
  col: number;
  row: number;
  dataValue?: unknown;
  value?: unknown;
  table: { columnHeaderLevelCount: number };
}

/**
 * 统计行的主键值。
 * 组件会自动把它补到 summary 的 rowKey 字段上（summary 里已显式给主键时保留原值），
 * 所以业务不需要自己塞这个值；要判断统计行，用回调参数里的 isSummaryRow 即可。
 */
export const SUMMARY_ROW_KEY = '__summary__';

/** 选中行整行底色的样式 id 与配色（配色与 theme.bodyStyle.select.cellBgColor 保持一致） */
const SELECTED_ROW_STYLE_ID = '__selected_row__';

/**
 * 把行号压成尽量少的连续区间（排序 + 去重后合并相邻）。
 *
 * 不压段的话，全选会逐行构造整行 range 交给 table.selectCells —— 而 selectCells 内部对每个 range
 * 都要跑一遍完整的选中流程（BaseTable.js:1301-1306：两次 updateSelectPos + endSelectCells
 * + 选中边框重建），行数一多就明显卡。压成一段后只跑一次。
 * 勾选不连续时同样有效，能把区间数降到「连续段的个数」。
 */
function toContinuousSegments(rows: number[]): Array<{ from: number; to: number }> {
  const sorted = Array.from(new Set(rows)).sort((a, b) => a - b);
  const segments: Array<{ from: number; to: number }> = [];
  sorted.forEach((row) => {
    const last = segments[segments.length - 1];
    if (last && row === last.to + 1) last.to = row;
    else segments.push({ from: row, to: row });
  });
  return segments;
}

/**
 * 把选中范围展开成「覆盖到的行号」集合（表头行不计）。
 * Ctrl 点击的基准要在 mousedown 时算、在 click 时用，两个事件里得用同一套展开规则。
 */
function collectRowIndexes(
  ranges: Array<{ start: { row: number }; end: { row: number } }>,
  headerLevel: number,
): Set<number> {
  const rows = new Set<number>();
  ranges.forEach((range) => {
    const from = Math.max(Math.min(range.start.row, range.end.row), headerLevel);
    const to = Math.max(range.start.row, range.end.row);
    for (let i = from; i <= to; i += 1) rows.add(i);
  });
  return rows;
}
const SELECTED_ROW_BG = '#e6f4ff';

/**
 * customCellStyle 插件的类型没有从包根导出，这里只声明实际用到的两个方法。
 * 该插件由 BaseTable 无条件创建（options.customCellStyle 默认是 []），所以表建好后一定拿得到。
 */
interface CustomCellStylePluginLike {
  registerCustomCellStyle: (id: string, style: Record<string, unknown>) => void;
  arrangeCustomCellStyle: (
    cellPos: {
      col?: number;
      row?: number;
      range?: { start: { col: number; row: number }; end: { col: number; row: number } };
    },
    customStyleId?: string,
  ) => void;
}

function getStylePlugin(table: ListTable): CustomCellStylePluginLike | undefined {
  return (table as unknown as { customCellStylePlugin?: CustomCellStylePluginLike })
    .customCellStylePlugin;
}

/** 自定义单元格样式的回调参数 */
export interface VTableCellStyleInfo {
  /** 表格行号（含表头行） */
  row: number;
  /** 数据行索引（不含表头，0 起） */
  rowIndex: number;
  /** 列字段名 */
  field: string;
  /** 行主键（空白补足行为空串，统计行为 SUMMARY_ROW_KEY） */
  rowKey: string;
  /** 是否底部统计行 */
  isSummaryRow: boolean;
  /** 该行原始记录 */
  record?: Record<string, unknown>;
  /** 该单元格原始值 */
  dataValue?: unknown;
}

/**
 * 页面自定义单元格样式：返回的样式会合并到内置样式之上，
 * 适合「最近变更标绿」「超期标红」这类业务提醒。
 */
export type VTableCellStyleHook = (info: VTableCellStyleInfo) => Record<string, unknown> | undefined;

/** 进入单元格编辑的触发方式 */
export type EditCellTrigger =
  | 'doubleclick'
  | 'click'
  | 'api'
  | 'keydown'
  | Array<'doubleclick' | 'click' | 'api' | 'keydown'>;

/** 单元格编辑完成后的回调参数 */
export interface VTableCellValueChangeInfo {
  /** 列字段名 */
  field: string;
  /** 数据行索引（不含表头，0 起） */
  rowIndex: number;
  /** 该行原始记录 */
  record?: Record<string, unknown>;
  /** 编辑后的值 */
  value: unknown;
  /**
   * 编辑**前**的值（单元格原来的内容），对应 VTable 原生事件里的 currentValue。
   *
   * 想要新旧对比必须读这个字段：VTable 提交编辑时是**直接改写 record 对象**的
   * （DataSource.changeFieldValue → setRecordFieldValue），所以回调触发时，
   * 页面手里那份 records 里的值已经被覆盖成新值了，回头去读同一个 record 拿不到旧值。
   *
   * 需要「编辑前的整行」时，`{...record, [field]: previousValue}` 拼一下即可 ——
   * 这次提交只改了 field 这一个字段，行里其余字段本来就还是旧值。
   */
  previousValue?: unknown;
}

export interface VTableSortState {
  field: string;
  order: 'asc' | 'desc';
}

/** 默认比较：数值按大小、字符串按字典序，空值排最后 */
function defaultCompare(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) > String(b) ? 1 : -1;
}

/** 浅比较两条记录（统计行的值都是原始类型，浅比较足够） */
function shallowEqualRecord(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/**
 * VTable 1.26 的 bottomFrozenRowCount 不从构造参数读取，只认 internalProps，
 * 且只能在场景 clear 状态下写入，并且 setRecords 会把它重置为 0。
 * 因此顺序必须是：setRecords → clearCells → 赋值 → createSceneGraph。
 */
function applyBottomFrozen(table: ListTable, count: number): void {
  try {
    const scene = (
      table as unknown as {
        scenegraph?: { clearCells: () => void; createSceneGraph: () => void };
      }
    ).scenegraph;
    if (!scene) return;
    // 冻结行数没变就不用重建场景（重建会替换所有单元格节点，代价大且会打断双击识别）
    if (table.bottomFrozenRowCount === count) return;
    scene.clearCells();
    (table as unknown as { bottomFrozenRowCount: number }).bottomFrozenRowCount = count;
    scene.createSceneGraph();
  } catch {
    // 冻结失败不影响表格基本可用性
  }
}

/** VTable 的内部渲染是异步的，放到下一帧应用，避免被它自己重置 */
function scheduleBottomFrozen(table: ListTable, count: number): void {
  requestAnimationFrame(() => applyBottomFrozen(table, count));
}

export interface VTableCellInfo {
  col: number;
  row: number;
  field?: string;
  /** 是否底部统计行（统计行的 record 里只有汇总字段，不要当业务数据用） */
  isSummaryRow: boolean;
  /** 单元格对应的原始记录 */
  record?: Record<string, unknown>;
}

/** 选中单元格信息：单元格所在的行列、列字段与所在行的记录 */
export interface VTableCellSelection {
  /** 列号（含勾选列 / 序号列） */
  col: number;
  /** 行号（含表头行） */
  row: number;
  /** 列字段名 */
  field?: string;
  /** 该单元格所在行的原始记录 */
  record?: Record<string, unknown>;
  /** 单元格显示值 */
  value?: unknown;
  /** 单元格原始值 */
  dataValue?: unknown;
}

/** 表格当前选中态：行、单元格、以及最后点选的那一格 */
export interface VTableSelection {
  /** 选中的行数据（按行去重、行号升序） */
  rows: Array<Record<string, unknown>>;
  /** 选中的单元格：点选一格是一条，框选则是范围内所有格 */
  cells: VTableCellSelection[];
  /** 最后点选的单元格，用它可以知道「选中的是哪一列」 */
  activeCell: VTableCellSelection | null;
}

/**
 * 某一行在当前表格里的数据（getRowByIndex 的返回值）。
 *
 * 这里的「行号」指**数据行下标**：0 起、不含表头，传 0 就是界面上显示的第一行数据。
 * 下标跟着**显示顺序**走 —— 点列头排序后，传 0 拿到的仍是排序后显示的第一行，
 * 而不是页面 records 里的第一条。
 *
 * 提醒：各单元格回调里的 `row` 是另一套坐标（VTable 行号，**含表头**，0 起），
 * 与本方法入参差一个表头行数（分组表头会大于 1），换算要用 `table.columnHeaderLevelCount`；
 * 而回调里的 `rowIndex` 与本方法入参是同一套，可以直接传。
 */
export interface VTableRowInfo {
  /** 数据行下标（入参原样回传，0 起、不含表头） */
  rowIndex: number;
  /** 行主键值（统计行为 SUMMARY_ROW_KEY） */
  rowKey: string;
  /** 该行当前的数据 */
  record: Record<string, unknown>;
  /** 是否底部统计行（统计行里只有汇总字段，别当业务数据用） */
  isSummaryRow: boolean;
}

/**
 * 菜单项。
 * VTable 未从包根导出 MenuListItem，这里按官方 ts-types/menu.d.ts 的 MenuListItem 声明，
 * 保证页面写 `menu.contextMenuItems` 时拿到的就是原生形态（直接透传，不做二次转换）。
 *
 * - 字符串：普通菜单项，文本与 menuKey 都等于该字符串
 * - `{ type: 'split' }`：分隔线（注意不是字符串 '-'，写 '-' 会渲染成一个文本项）
 * - `{ type: 'title' }`：分组标题
 * - `children`：二级子菜单
 *
 * 图标（`icon`）：`svg` 要传**完整的 `<svg>…</svg>` 字符串** ——
 * VTable 是把它 innerHTML 进一个 span（见 `es/components/menu/dom/logic/MenuElement.js`
 * 的 createItem），只有当内容长得像 URL 时才会改用 `<img>` 加载。
 * 所以别传裸 `<path>`（HTML 解析下不会成为 SVG 元素，什么都不显示）。
 *
 * 想直接用 antd 图标的话不用手写 svg，用 `@/components/menuIcon` 的 `toMenuIcon`：
 *
 * ```ts
 * const MENU_ICON_DELETE = toMenuIcon(<DeleteOutlined />);
 * // { text: '删除行', menuKey: 'deleteRow', icon: MENU_ICON_DELETE }
 * ```
 *
 * ⚠️ 图标是**单独占一列**的，所以同一份菜单里若有的项有图标、有的没有，没图标的项文字会顶到
 * 最左边（看起来错位）。用 `@/components/menuIcon` 的 `alignMenuIcons(items)` 包一层即可，
 * 它会自动给没图标的项补上等宽空白占位。
 *
 * 尺寸与颜色：`width` / `height` 传了才会写到那个 svg 元素上，最省事的做法是让
 * svg 自己带 `width` / `height` / `viewBox`；颜色用 `currentColor`，这样鼠标移到
 * 菜单项上（高亮改文字色）图标会一起变。
 *
 * 三个图标字段各自的生效范围：
 * - `icon`：常态图标，html 渲染模式下右键菜单 / 表头下拉都生效；
 * - `selectedIcon`：该项高亮（hover / 选中）时**替换** `icon`，只在配了 `icon.svg` 时才用得上；
 * - `stateIcon`：表头下拉的勾选态图标（默认 22px），**右键菜单里不生效**。
 */
export type VTableMenuItem =
  | string
  | {
      text?: string;
      type?: 'title' | 'item' | 'split';
      /** 菜单项标识，点击回调里用它区分；不传时等于 text */
      menuKey?: string;
      icon?: { width?: number; height?: number; svg?: string };
      /** 高亮（hover）时替换 icon 的图标 */
      selectedIcon?: { width?: number; height?: number; svg?: string };
      /** 表头下拉的勾选态图标；右键菜单不生效 */
      stateIcon?: { width?: number; height?: number; svg?: string };
      children?: VTableMenuItem[];
      disabled?: boolean;
    };

/** 生成菜单项时的上下文：页面据此决定这一格显示哪些菜单 */
export interface VTableMenuContext {
  /** 列号（含勾选列） */
  col: number;
  /** 行号（含表头行） */
  row: number;
  /** 列字段名 */
  field?: string;
  /** 数据行索引（不含表头）；表头行为 -1 */
  rowIndex: number;
  /** 该单元格所在行的原始记录；表头行 / 画布空白处为 undefined */
  record?: Record<string, unknown>;
  /** 是否底部统计行 */
  isSummaryRow: boolean;
}

/** 菜单项被点击时回传的信息 */
export interface VTableMenuClickInfo extends VTableMenuContext {
  /** 菜单项标识（未配 menuKey 时等于菜单文本） */
  menuKey: string;
  /** 菜单项文本 */
  text: string;
  /** 该单元格显示值 */
  value?: unknown;
  /** 该单元格原始值 */
  dataValue?: unknown;
}

/** 右键菜单 / 表头下拉菜单配置 */
export interface VTableMenuConfig {
  /**
   * 单元格右键菜单。
   * 传数组为固定菜单；传函数可按行列动态返回（返回空数组表示这一格不弹菜单）。
   */
  contextMenuItems?: VTableMenuItem[] | ((ctx: VTableMenuContext) => VTableMenuItem[]);
  /** 表头下拉菜单（表头右侧的小三角）。不传则表头没有下拉菜单，与 VTable 默认一致 */
  headerMenuItems?: VTableMenuItem[] | ((ctx: VTableMenuContext) => VTableMenuItem[]);
  /** 渲染模式，默认 'html'（'canvas' 更轻，但对菜单外观的控制有限） */
  renderMode?: 'canvas' | 'html';
  /**
   * 是否只在单元格 / 表头上响应右键。
   * VTable 内部只有 `contextMenuWorkOnlyCell === false` 时才额外绑定「画布空白处」的右键，
   * 所以不传（或传 true）时就只有单元格和表头能弹出菜单。
   */
  workOnlyCell?: boolean;
  /** 菜单项点击回调（右键菜单与表头下拉菜单共用） */
  onClick?: (info: VTableMenuClickInfo) => void;
}

/** 表格实例对外暴露的方法 */
export interface VTableApi {
  /** 按内容自适应所有列宽（与双击列边界的效果一致） */
  autoFitColumns: () => void;
  /** 重绘表格：页面自定义样式（cellStyle）变化后调用即可生效 */
  repaint: () => void;
  /**
   * 当前选中态（行 + 单元格 + 最后点选的单元格），取自 VTable 原生选中态。
   *
   * rows 就是「选中的行」（勾选与点选/框选已同步成同一套），业务层要操作对象时直接取它，
   * 不要自己再维护一份 selectedKeys —— 两份状态必然会出现「页面以为选了 2 行、表格里亮着 3 行」
   * 这类不同步。只关心行数（比如按钮 disabled）时用 onActiveSelectionChange 回传的 rowCount。
   * 统计行有可能被框选进来，按业务数据源过滤一下即可（预订单页那层 filter 就是干这个的）。
   */
  getSelection: () => VTableSelection;
  /** 获取内部 ListTable 实例（供 SearchComponent 等外部工具使用） */
  getTable: () => ListTable | null;
  /**
   * 按**行号**取该行数据 —— 行号指数据行下标：0 起、不含表头，传 0 即界面上第一行。
   *
   * 跟随**显示顺序**：点列头排序后，0 仍是排序后显示的第一行，而不是页面 records 里的第一条。
   * 与各单元格回调里的 `rowIndex` 是同一套坐标，可直接传过去；
   * 但**别把回调里的 `row` 传进来** —— 那个含表头行，与这里差一个 columnHeaderLevelCount。
   *
   * 底部统计行也算一行（下标等于数据行数），会照常返回并把 isSummaryRow 标为 true；
   * 越界返回 undefined。
   */
  getRowByIndex: (index: number) => VTableRowInfo | undefined;
  /**
   * 清空表格的选中态：原生选中范围与铺过的整行底色一起清，并回调
   * onActiveSelectionChange({ rowCount: 0 })。
   *
   * 选中态只存在表格这一侧（vtable 的 select ranges），所以「删除成功后立刻清空」这类场景
   * 必须显式调这个方法 —— 光改页面自己的变量不会联动到表格。
   */
  clearSelection: () => void;
  /**
   * 导出 Excel（走 @visactor/vtable-plugins 的 TableExportPlugin，默认直接下载文件）。
   * 传 fileName 会覆盖 exportOptions 里配的文件名；返回插件的原始结果（配了 downloadFile: false 时是文件内容）。
   */
  exportExcel: (fileName?: string) => Promise<unknown>;
  /** 导出 CSV，规则同 exportExcel */
  exportCsv: (fileName?: string) => Promise<unknown>;
}

export interface VTableProps {
  columns: ColumnsDefine;
  records: Array<Record<string, unknown>>;
  /** 行主键字段 */
  rowKey?: string;
  /** 左侧冻结列数（不含行号列，它由组件自动加上） */
  frozenColCount?: number;
  /**
   * 最左侧的行号顺序列，**默认启用**。
   * 用 VTable 原生 rowSeriesNumber 生成，位置在所有 columns 之前，显示 1 起的连续行号
   * （排序后重新编号），统计行显示「汇总」。
   * 传 false 关闭；传对象可自定义标题 / 宽度。
   */
  rowNumber?: boolean | { title?: string; width?: number };
  /**
   * 冻结区允许的最大宽度，默认沿用 VTable 的 '80%'。
   * 冻结列多时必须放宽：一旦冻结区总宽超过该值，VTable 会按下面的开关处理。
   */
  maxFrozenWidth?: number | string;
  /**
   * 冻结列总宽超过 maxFrozenWidth 时是否取消**全部**冻结。
   * 默认 false：只从右侧裁掉超出的列；VTable 原生默认是 true（整块冻结被静默清空，很难排查）。
   */
  unfreezeAllOnExceedsMaxWidth?: boolean;
  /**
   * 统计行数据：追加为最后一行并固定在表格底部。
   * 主键不用自己填，组件会自动补成 SUMMARY_ROW_KEY（已显式给主键则保留原值）；
   * 判断统计行请用 cellStyle / menu / 单元格事件回调里的 isSummaryRow。
   */
  summary?: Record<string, unknown>;
  /** 选择高亮模式，默认整行高亮 */
  highlightMode?: 'row' | 'column' | 'cell' | 'cross';
  /**
   * 框选、Shift 扩展这类「一个范围覆盖多格」的选中，是否把高亮铺满整行。
   *
   * VTable 这项默认是 false（见 es/state/state.js:216 的 Object.assign 默认值），
   * 后果是：只有「单击一个单元格」才走整行高亮分支（isCellSelected 里要求范围是单格），
   * 一旦范围跨格就掉到多范围分支 —— 而那条分支只在 selectionFillMode === 'replace' 时才上色，
   * 主题默认是 'overlay'（theme-define.js:546），于是连单元格底色都没有，看起来就像「选中丢了」。
   * 所以这里默认打开，保证单击与框选的观感一致。
   */
  highlightInRange?: boolean;
  /**
   * 是否允许多选。true：Ctrl/Cmd 点选追加、Shift 点选扩展范围、可拖拽框选、
   * Ctrl+A 全选、点表头整列选中（VTable 原生行为）；
   * false：只能单选 —— 点新的会替换掉旧的，上面这些批量入口全部关闭。
   */
  multiSelect?: boolean;
  /** 列宽总和不足容器宽度时，是否自动拉宽各列来填满容器；默认 false（右侧留白） */
  autoFillWidth?: boolean;
  /** 页面自定义单元格样式（业务提醒用，如最近变更标绿） */
  cellStyle?: VTableCellStyleHook;
  /** 可编辑列：字段 -> 已注册的编辑器名（用 register.editor 注册），不传则整表只读 */
  editableFields?: Record<string, string>;
  /** 进入编辑的触发方式，默认双击 */
  editCellTrigger?: EditCellTrigger;
  /** 单元格编辑完成回调（含行索引与新值），用于把编辑结果同步回页面 */
  onCellValueChange?: (info: VTableCellValueChangeInfo) => void;
  rowHeight?: number;
  headerRowHeight?: number;
  emptyTip?: string;
  /**
   * 是否加载中：为 true 时在表格上盖一层不透明的加载遮罩。
   * 不传则永远不显示，对现有调用方没有影响。
   *
   * 遮罩刻意做成不透明：表格的 emptyTip（「暂无数据」的图标和文字）是 VTable 用 canvas
   * 画在画布上的，不是独立 DOM，z-index 压不下去 —— 半透明遮罩会让它透出来和遮罩文案叠成一团。
   */
  loading?: boolean;
  /** 加载遮罩上的文案，默认「数据加载中…」 */
  loadingTip?: string;
  /**
   * 导出配置，透传给 @visactor/vtable-plugins 的 TableExportPlugin。
   * 不传也能导出（默认：当前页数据、自动下载、文件名 export）。
   * 注意插件内部是 Object.assign 浅合并，只写 exportExcelOptions.fileName 会把默认的
   * downloadFile: true 整个替换掉（变成只返回内容不下载）—— 组件里已经显式补上了 downloadFile。
   */
  exportOptions?: TableExportPluginOptions;
  /** 右键菜单 / 表头菜单配置；不传则保持 VTable 默认（没有菜单） */
  menu?: VTableMenuConfig;
  onCellClick?: (info: VTableCellInfo) => void;
  onCellDblClick?: (info: VTableCellInfo) => void;
  /** 选中变化（点击 / 框选 / Ctrl+A 全选），回传选中的行数 */
  onActiveSelectionChange?: (info: { rowCount: number }) => void;
}

const THEME: themes.TableTheme = themes.DEFAULT.extends({
  underlayBackgroundColor: '#ffffff',
  // 内容没撑满容器时，横向滚动条也贴到容器边缘，避免停在数据行下方
  scrollStyle: { barToSide: true },
  defaultStyle: {
    bgColor: '#ffffff',
    color: '#1f1f1f',
    fontSize: 12,
    padding: [2, 8],
    borderColor: '#f0f0f0',
    borderLineWidth: 1,
  },
  headerStyle: {
    bgColor: '#fafafa',
    color: '#1f1f1f',
    fontSize: 12,
    fontWeight: 'bold',
    padding: [4, 8],
    frameStyle: { borderColor: '#e8e8e8', borderLineWidth: 1 },
  },
  bodyStyle: {
    bgColor: '#ffffff',
    color: '#1f1f1f',
    fontSize: 12,
    padding: [2, 8],
    // 选中整行 / 悬停整行的高亮色，横向滚动时也能看清选中的是哪一行
    select: { inlineRowBgColor: '#e6f4ff', cellBgColor: '#e6f4ff' },
    hover: { inlineRowBgColor: '#f5f8ff' },
    frameStyle: { borderColor: '#f0f0f0', borderLineWidth: 1 },
  },
  selectionStyle: {
    cellBorderColor: '#1677ff',
    cellBorderLineWidth: 1,
    cellBgColor: 'rgba(22,119,255,0.10)',
    // 多个选中范围（Ctrl 多选）时，isCellSelected 只有在这一项等于 'replace' 时才会给范围内的格子上色，
    // 主题默认是 'overlay'，结果就是多选一格都不上色、只剩范围边框
    selectionFillMode: 'replace',
  },
  frameStyle: { borderColor: '#e8e8e8', borderLineWidth: 1 },
});

/**
 * VTable（VisActor）的 React 封装：负责实例创建、数据更新、容器自适应与销毁。
 * 表格渲染在 canvas 上，单元格内容通过 columns 的样式/类型配置，交互通过事件回调。
 */
export const VTable = React.forwardRef<VTableApi, VTableProps>(({
  columns,
  records,
  rowKey = 'id',
  frozenColCount = 0,
  rowNumber = true,
  maxFrozenWidth,
  unfreezeAllOnExceedsMaxWidth = false,
  summary,
  highlightMode = 'row',
  highlightInRange = true,
  multiSelect = true,
  autoFillWidth = false,
  cellStyle,
  editableFields,
  editCellTrigger = 'doubleclick',
  onCellValueChange,
  rowHeight = 28,
  headerRowHeight = 32,
  emptyTip,
  loading,
  loadingTip = '数据加载中…',
  exportOptions,
  menu,
  onCellClick,
  onCellDblClick,
  onActiveSelectionChange,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<ListTable | null>(null);
  /** 构造时的完整 options：updateOption 需要完整配置，否则 theme / 行高等会被重置为默认值 */
  const optionsRef = useRef<ListTableConstructorOptions | null>(null);
  const handlers = useRef({ onCellClick, onCellDblClick, onCellValueChange, onActiveSelectionChange });
  handlers.current = { onCellClick, onCellDblClick, onCellValueChange, onActiveSelectionChange };
  /**
   * 上一次实际铺过底色的**区间坐标**（不是行号）。
   *
   * 必须记坐标而不是"哪些行"：arrangeCustomCellStyle 的清除是按 cellPosition 的坐标串精确匹配的
   * （_getCustomCellStyleArrangementKey → `range:startCol,startRow,endCol,endRow`）。
   * 拿新算出来的段去清旧条目是对不上的 —— 全选铺的是「一整块大 range」，取消某一行后段划分变成两段，
   * 按新段坐标找不到旧条目，那一整块就清不掉，表现就是「勾选去掉了但高亮还在」。
   */
  const paintedSegmentsRef = useRef<Array<{ from: number; to: number }>>([]);
  /** customCellStyle 的样式只需注册一次 */
  const styleRegisteredRef = useRef(false);
  /** 建表 effect 只跑一次会锁住闭包，点击时要读的最新开关统一走 ref */
  const multiSelectRef = useRef(multiSelect);
  multiSelectRef.current = multiSelect;

  /**
   * 给「当前选中的行」整行铺底色 —— 走 customCellStyle，而不是 VTable 原生的选中高亮。
   *
   * 为什么不用原生的：多个选中范围（Ctrl 多选产生的就是多个 range）时，VTable 只给 range 覆盖到的
   * 格子画 cellBgColor，而 Ctrl 点出来的 range 恰好是单格，所以整行铺不开
   * （见 es/state/select/is-cell-select-highlight.js 里 getCellSelectColor 的分支判断）。
   *
   * customCellStyle 正好合适：样式优先级最高（core/style-helper.js 里 mergeStyle 合成在业务样式之上），
   * 且渲染时现查；arrangeCustomCellStyle 内部还会自己 updateCellContent + updateNextFrame。
   *
   * 关键是**完全不动选中范围**：点一个格子就还是选中一个格子，getSelection() 行为保持原样。
   */
  const paintSelectedRows = useCallback(() => {
    const table = tableRef.current;
    const plugin = table ? getStylePlugin(table) : undefined;
    if (!table || !plugin) return;

    if (!styleRegisteredRef.current) {
      plugin.registerCustomCellStyle(SELECTED_ROW_STYLE_ID, { bgColor: SELECTED_ROW_BG });
      styleRegisteredRef.current = true;
    }

    // 选中范围可能跨行（框选），把覆盖到的行都算进来（与 Ctrl 点击的基准用同一套展开规则）
    const ranges = (table.stateManager?.select?.ranges ?? []) as Array<{
      start: { row: number };
      end: { row: number };
    }>;
    const nextRows = Array.from(collectRowIndexes(ranges, table.columnHeaderLevelCount));

    // arrangeCustomCellStyle 收的是 cellPosition（col / row / range 三选一），整行用 range 表达。
    // 连续行合并成一段：逐行 arrange 每行都会走一遍 updateCellContent + updateNextFrame，全选时很亏。
    const segmentCellPos = (from: number, to: number) => ({
      range: {
        start: { col: 0, row: from },
        end: { col: table.colCount - 1, row: to },
      },
    });
    // 差集按「段坐标」比对，而不是按行号重新压段：清除必须用与铺色时完全一致的坐标才能命中条目
    const nextSegments = toContinuousSegments(nextRows);
    const segmentKey = (seg: { from: number; to: number }) => `${seg.from}-${seg.to}`;
    const paintedKeys = new Set(paintedSegmentsRef.current.map(segmentKey));
    const nextKeys = new Set(nextSegments.map(segmentKey));
    // 先撤掉不再需要的段（不传样式 id 就是清除）
    paintedSegmentsRef.current
      .filter((seg) => !nextKeys.has(segmentKey(seg)))
      .forEach((seg) => plugin.arrangeCustomCellStyle(segmentCellPos(seg.from, seg.to)));
    // 再铺上新增的段
    nextSegments
      .filter((seg) => !paintedKeys.has(segmentKey(seg)))
      .forEach((seg) => {
        plugin.arrangeCustomCellStyle(segmentCellPos(seg.from, seg.to), SELECTED_ROW_STYLE_ID);
      });
    paintedSegmentsRef.current = nextSegments;
  }, []);

  /** 撤掉所有已铺的行底色（换数据 / 清空选中时用，旧行号在新数据里已经没意义了） */
  const clearPaintedRows = useCallback(() => {
    const table = tableRef.current;
    const plugin = table ? getStylePlugin(table) : undefined;
    if (!table || !plugin || paintedSegmentsRef.current.length === 0) return;
    // 按记下来的段坐标逐段清除：坐标必须与铺色时一致才能命中那些条目
    paintedSegmentsRef.current.forEach((seg) => {
      plugin.arrangeCustomCellStyle({
        range: {
          start: { col: 0, row: seg.from },
          end: { col: table.colCount - 1, row: seg.to },
        },
      });
    });
    paintedSegmentsRef.current = [];
  }, []);

  /**
   * 执行一次 Ctrl 点击的整行 toggle（已选中的取消、未选中的加入）。
   *
   * 必须自己接管 —— VTable 原生在 Ctrl 点击时只会「把点中的那一格追加进选中范围」，
   * 所以全选之后想用 Ctrl 点掉某几行根本做不到。
   *
   * baseRows 是「点击前」的选中行号集合，由 mousedown 时算好传进来：
   * Ctrl 模式下 VTable 会把点中的格子追加进 ranges，到了 click 阶段已经分不清
   * 「这一行本来就在选中里」还是「刚刚被追加进来的」，所以基准只能在 mousedown 取。
   */
  const applyCtrlToggle = useCallback(
    (row: number, baseRows: number[]) => {
      const table = tableRef.current;
      if (!table || row < table.columnHeaderLevelCount) return;

      const selected = new Set(baseRows);
      if (selected.has(row)) selected.delete(row);
      else selected.add(row);

      const nextRanges = toContinuousSegments(Array.from(selected)).map((seg) => ({
        start: { col: 0, row: seg.from },
        end: { col: table.colCount - 1, row: seg.to },
      }));
      /**
       * 直接把选中范围写成目标形状，不走 table.selectCells()。
       *
       * selectCells 会把每个「多格 range」拆成两步：先 push 起点那一格，再靠 grabing 分支
       * 把端点拖过去（BaseTable.js 的 selectCells 里，多格走 `updateSelectPos(start)` →
       * `updateInteractionState(grabing)` → `updateSelectPos(end)`）。第二步一旦没生效，
       * 范围就停在起点那一格 —— 对单行 range 看不出来（起终点同一行，行号仍然对），
       * 但对跨行 range 就是灾难：Ctrl+A 后取消一行，剩下两段本该覆盖 1~8 和 10~末行，
       * 实际只剩第 1 行和第 10 行。
       *
       * 只改 ranges、不动 interactionState，pointerup 的 endSelectCells() 照常收尾。
       */
      const host = table as unknown as {
        stateManager: { select: { ranges: typeof nextRanges } };
        scenegraph: {
          recreateAllSelectRangeComponents?: () => void;
          updateNextFrame?: () => void;
        };
      };
      host.stateManager.select.ranges = nextRanges;
      /**
       * 按新 ranges 重建选中边框。不能自己 forEach 调 updateCellSelectBorder：
       * 它每次进来都会清空「选择中」的边框集合，多段时会互相抹掉，最后只剩最后一段有线。
       * recreateAllSelectRangeComponents 是 VTable 自己的做法 ——
       * 清空全部 → 逐段 updateCellSelectBorder → 立刻固化到「已选中」集合，
       * 这样每段都不会被下一段清掉。
       */
      host.scenegraph.recreateAllSelectRangeComponents?.();
      host.scenegraph.updateNextFrame?.();

      // 改范围不会派发 selected_cell，整行底色与对外行数得自己补一次
      paintSelectedRows();
      handlers.current.onActiveSelectionChange?.({ rowCount: selected.size });
    },
    [paintSelectedRows],
  );

  /** 建表 effect 只跑一次会锁住闭包，事件里统一走 ref 取最新实现 */
  const applyCtrlToggleRef = useRef(applyCtrlToggle);
  applyCtrlToggleRef.current = applyCtrlToggle;

  /**
   * Ctrl 点击的待处理信息：mousedown 时记下「点击前的选中行」与按下坐标，click 时再决定要不要 toggle。
   *
   * 不在 mousedown 里直接执行，是因为那时还分不清用户要「点一下」还是「按住拖选」；
   * 抢在拖拽前改完 ranges，拖拽过程又会去改端点，整个选择就乱了（Ctrl+拖拽会失效）。
   */
  const pendingCtrlToggleRef = useRef<{
    row: number;
    x: number;
    y: number;
    rows: number[];
  } | null>(null);

  /** 当前排序状态（由表头排序图标驱动，排序在本地完成，统计行不参与） */
  const [sortState, setSortState] = useState<VTableSortState | null>(null);

  /**
   * 导出插件的两个配置对象。
   *
   * 刻意用 ref 持有、并把「对象本身」交给插件：TableExportPlugin 内部是 Object.assign 浅合并，
   * 拿到的是同一个引用，而且每次导出都现读一遍 —— 所以调用导出前改它的 fileName 就能生效。
   * 这是该插件唯一支持「动态改文件名」的口子：它挂在 table 实例上的 exportToExcel() / exportToCsv()
   * 都不接受参数，配置只在构造插件时读一次。
   *
   * downloadFile / fileName 显式写出来：浅合并下只要传了 exportExcelOptions，
   * 插件自带的 { downloadFile: true, fileName: 'export' } 就会被整个替换掉。
   */
  const exportExcelOptionsRef = useRef<VTableExportExcelOptions>({
    ...exportOptions?.exportExcelOptions,
    downloadFile: exportOptions?.exportExcelOptions?.downloadFile ?? true,
    fileName: exportOptions?.exportExcelOptions?.fileName ?? 'export',
  });
  const exportCsvOptionsRef = useRef<VTableExportCsvOptions>({
    ...exportOptions?.exportCsvOptions,
    downloadFile: exportOptions?.exportCsvOptions?.downloadFile ?? true,
    fileName: exportOptions?.exportCsvOptions?.fileName ?? 'export',
  });

  /** 插件只建一次（惰性初始化），构造时传进去的就是上面那两个对象本身 */
  const [exportPlugin] = useState(
    () =>
      new TableExportPlugin({
        exportExcelOptions: exportExcelOptionsRef.current,
        exportCsvOptions: exportCsvOptionsRef.current,
        exportOnIdle: exportOptions?.exportOnIdle ?? false,
      }),
  );
  const recordsRef = useRef(records);
  recordsRef.current = records;
  /**
   * 统计行记录：主键由组件补齐，业务不用自己塞 SUMMARY_ROW_KEY。
   * summary 里已经显式给了主键时保留原值，便于旧代码平滑过渡。
   */
  const summaryRow = useMemo(
    () => (summary ? { ...summary, [rowKey]: summary[rowKey] ?? SUMMARY_ROW_KEY } : undefined),
    [summary, rowKey],
  );
  /**
   * 内容没变就复用上一次的引用：页面常用内联对象写 summary（每次渲染都是新引用），
   * 不复用的话 rows 会跟着失效，父组件每次重渲染都会全量 setRecords 一次。
   */
  const stableSummaryRef = useRef(summaryRow);
  if (!shallowEqualRecord(stableSummaryRef.current, summaryRow)) {
    stableSummaryRef.current = summaryRow;
  }
  const stableSummaryRow = stableSummaryRef.current;
  const summaryRef = useRef(summaryRow);
  summaryRef.current = stableSummaryRow;
  /** 菜单配置：菜单项与回调都从 ref 实时读取，所以页面改菜单内容不用重建表格实例 */
  const menuRef = useRef(menu);
  menuRef.current = menu;

  /**
   * 统计行固定在数据行之后（含表头行号）。
   * 只从 ref 读数据，保证引用稳定：cellStyle / rowSeriesNumber / disableSelect 等回调
   * 都挂在这个函数上，它一旦变化整份列配置就要重建、表格要 updateOption 一次。
   */
  const isSummaryRow = useCallback(
    (row: number, headerLevel: number): boolean =>
      Boolean(summaryRef.current) && row >= headerLevel + recordsRef.current.length,
    [],
  );

  // 只看「有没有」，用于决定是否要包装列配置；包装后的回调内部都从 ref 读最新值
  const hasCellStyle = Boolean(cellStyle);
  const hasSummary = Boolean(stableSummaryRow);
  const finalColumns = useMemo<ColumnsDefine>(() => {
    // 没有任何要注入的能力时直接用原列配置：少一层逐单元格的包装函数，
    // 引用也保持等于 columns，下游 updateOption 不会跟着空转
    if (!editableFields && !hasCellStyle && !hasSummary) return columns;
    const decorate = (cols: ColumnsDefine): ColumnsDefine =>
      cols.map((col) => {
        const grouped = col as { columns?: ColumnsDefine };
        if (grouped.columns) {
          return { ...col, columns: decorate(grouped.columns) } as (typeof cols)[number];
        }
        const cell = col as { style?: unknown; field?: string };
        const previous = cell.style;
        const editor = cell.field ? editableFields?.[cell.field] : undefined;
        return {
          ...cell,
          // 配置了编辑器的列允许就地编辑，未配置的列保持只读
          ...(editor ? { editor } : {}),
          style: (args: StyleArgs) => {
            const base =
              typeof previous === 'function'
                ? (previous as (a: StyleArgs) => Record<string, unknown>)(args)
                : ((previous ?? {}) as Record<string, unknown>);
            const headerLevel = args.table.columnHeaderLevelCount;
            // 统计行：灰底加粗
            const isSummary = isSummaryRow(args.row, headerLevel);
            if (isSummary) {
              return { ...base, bgColor: '#fafafa', fontWeight: 'bold' };
            }
            // 页面自定义样式（业务提醒）
            const index = args.row - headerLevel;
            const rowKeyAt = rowKeyByIndexRef.current[index] ?? '';
            const custom = cellStyleRef.current?.({
              row: args.row,
              rowIndex: index,
              field: (col as { field?: string }).field ?? '',
              rowKey: rowKeyAt,
              isSummaryRow: isSummary,
              record: rowsRef.current[index],
              dataValue: args.dataValue,
            });
            if (custom) {
              return { ...base, ...custom };
            }
            return base;
          },
        } as unknown as (typeof cols)[number];
      });
    return decorate(columns);
  }, [columns, editableFields, hasCellStyle, hasSummary, isSummaryRow]);

  /** 排序只作用于真实数据行，统计行永远追加在最后 */
  const rows = useMemo(() => {
    const data = sortState
      ? [...records].sort((a, b) => {
          const result = defaultCompare(a?.[sortState.field], b?.[sortState.field]);
          return sortState.order === 'desc' ? -result : result;
        })
      : records;
    return stableSummaryRow ? [...data, stableSummaryRow] : data;
  }, [records, stableSummaryRow, sortState]);

  /** 表格行号 -> 行主键，供样式回调判断「哪一行」 */
  const rowKeyByIndex = useMemo(
    () => rows.map((row) => String((row as Record<string, unknown>)?.[rowKey] ?? '')),
    [rowKey, rows],
  );
  const rowKeyByIndexRef = useRef(rowKeyByIndex);
  rowKeyByIndexRef.current = rowKeyByIndex;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const cellStyleRef = useRef(cellStyle);
  cellStyleRef.current = cellStyle;

  /**
   * 按内容自适应所有列宽。
   * 直接复用 VTable 内部实现——双击列边界时调用的就是这个方法，
   * 所以度量和裁剪逻辑跟手动双击完全一致。
   */
  const autoFitColumns = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    const host = table as unknown as {
      colCount: number;
      frozenColCount: number;
      /** 左侧行号列数（未配 rowSeriesNumber 时为 0） */
      leftRowSeriesNumberCount: number;
      rightFrozenColCount: number;
      stateManager?: { checkFrozen?: () => void };
      scenegraph?: {
        updateAutoColWidth: (col: number) => void;
        component?: {
          setFrozenColumnShadow: (col: number, isRightFrozen?: boolean) => void;
          setRightFrozenColumnShadow: (col: number) => void;
        };
        updateNextFrame?: () => void;
      };
    };
    const scenegraph = host.scenegraph;
    if (!scenegraph?.updateAutoColWidth) return;
    // 行号列保持原宽，只自适应业务列
    const firstDataCol = host.leftRowSeriesNumberCount ?? 0;
    for (let col = firstDataCol; col < host.colCount; col += 1) {
      scenegraph.updateAutoColWidth(col);
      // 再调一次 setColWidth，把该列标记为“已手动调整”
      // （VTable 重建单元格时会跳过这些列，否则宽度会被列定义覆盖回去）
      table.setColWidth(col, table.getColWidth(col));
    }
    // 列宽变了 → 冻结区边界也跟着变。VTable 的双击列边界逻辑
    // (event/self-event-listener/base-table/dbclick-auto-column-width) 在这之后会重算冻结分割线，
    // 这里必须补上同样的动作，否则 frozenShadowLine 会停在旧的 x 上：
    // 表现为冻结分割竖线和内容错位，刷新页面重建场景图才恢复正常。
    host.stateManager?.checkFrozen?.();
    scenegraph.component?.setFrozenColumnShadow(host.frozenColCount - 1);
    scenegraph.component?.setRightFrozenColumnShadow(host.colCount - host.rightFrozenColCount);
    scenegraph.updateNextFrame?.();
  }, []);

  /**
   * 菜单项解析：把业务上下文补齐后交给页面配置的函数。
   * 页面只需要关心 field / record / isSummaryRow，不用自己换算表头偏移。
   */
  const resolveMenuItems = useCallback(
    (
      source: VTableMenuConfig['contextMenuItems'],
      table: ListTable,
      col: number,
      row: number,
      field?: string,
    ): VTableMenuItem[] => {
      if (!source) return [];
      if (Array.isArray(source)) return source;
      const headerLevel = table.columnHeaderLevelCount;
      // row < headerLevel 是表头行；col / row 为 -1 是画布空白处的右键
      const inBody = col >= 0 && row >= headerLevel;
      return source({
        col,
        row,
        field,
        rowIndex: inBody ? row - headerLevel : -1,
        record: inBody
          ? (table.getCellOriginRecord(col, row) as Record<string, unknown> | undefined)
          : undefined,
        isSummaryRow: inBody && isSummaryRow(row, headerLevel),
      });
    },
    [isSummaryRow],
  );

  /**
   * 构造 VTable 的 menu 配置。
   *
   * 一律以「函数形态」注册：VTable 是在每次弹菜单时才调用它，所以菜单项与 onClick
   * 始终读到最新配置，页面改菜单内容不需要重建表格实例。
   *
   * 注意两处 VTable 内部行为：
   * 1. 空数组是 truthy，会弹出一个空的菜单框，所以这里把空数组统一转成 undefined（= 不弹菜单）；
   * 2. renderMode / workOnlyCell 在 VTable 里只在建图时读取，改这两个值需重挂载组件。
   */
  const buildMenuOptions = useCallback((): ListTableConstructorOptions['menu'] => {
    const toContent = (items: VTableMenuItem[] | undefined) =>
      (items && items.length > 0 ? items : undefined) as unknown as VTableMenuItem[];
    return {
      renderMode: menuRef.current?.renderMode ?? 'html',
      contextMenuWorkOnlyCell: menuRef.current?.workOnlyCell,
      contextMenuItems: (field, row, col, table) =>
        toContent(
          resolveMenuItems(
            menuRef.current?.contextMenuItems,
            table as unknown as ListTable,
            col,
            row,
            field === undefined ? undefined : String(field),
          ),
        ),
      defaultHeaderMenuItems: (args) => {
        const source = menuRef.current?.headerMenuItems;
        if (!source) return toContent([]);
        return toContent(
          resolveMenuItems(source, args.table as unknown as ListTable, args.col, args.row),
        );
      },
    };
  }, [resolveMenuItems]);

  /**
   * 表格当前已经用上的「列配置 + autoFillWidth」。
   *
   * 不用「跳过首次执行」的布尔标记：StrictMode 下挂载期的 effect 会跑两遍
   * （mount → cleanup → mount），标记在第一遍就被消费掉，第二遍会真的多做一次
   * updateOption —— 表格刚建好就重建列，正是表头与列定义对不上
   * （getHeader 返回 undefined）的来源。改成和「建表时那一份」比引用，
   * 没变就必定是白跑，比布尔标记更贴合意图。
   */
  const syncedOptionRef = useRef<{ columns: ColumnsDefine; autoFillWidth: boolean } | null>(null);

  // 创建实例（仅一次），后续数据/列变化通过 API 增量更新
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const options: ListTableConstructorOptions = {
      columns: finalColumns,
      records: rows,
      // 行号列恒占 col 0，也要算进冻结列数
      frozenColCount: frozenColCount + (rowNumber ? 1 : 0),
      maxFrozenWidth,
      unfreezeAllOnExceedsMaxWidth,
      // 行号列：VTable 原生能力，生成的是独立列（不占 columns），位置在所有 columns 之前
      ...(rowNumber
        ? {
            rowSeriesNumber: {
              title: typeof rowNumber === 'object' && rowNumber.title ? rowNumber.title : '',
              width: typeof rowNumber === 'object' && rowNumber.width ? rowNumber.width : 48,
              headerStyle: { textAlign: 'center' as const },
              // 统计行灰底加粗；columns 上的 cellStyle 管不到这一列，必须在这里单独设
              style: (args: { row: number; table: { columnHeaderLevelCount: number } }) =>
                isSummaryRow(args.row, args.table.columnHeaderLevelCount)
                  ? { bgColor: '#fafafa', fontWeight: 'bold' as const, textAlign: 'center' as const }
                  : { textAlign: 'center' as const },
              // 统计行显示「汇总」，其余显示 1 起的连续行号（排序后重新编号）
              format: (_col?: number, row?: number, table?: { columnHeaderLevelCount: number }) => {
                const headerLevel = table?.columnHeaderLevelCount ?? 0;
                const current = row ?? headerLevel;
                return isSummaryRow(current, headerLevel)
                  ? '汇总'
                  : current - headerLevel + 1;
              },
            },
          }
        : {}),
      select: {
        highlightMode,
        // 打开后，框选 / Shift 扩展的多格范围也会整行高亮（默认不打开，只有单击整行）
        highlightInRange,
        // 单选模式：点表头只选中表头那一格。默认 'inline' 是点表头整列选中，
        // 角头（序号列表头）默认更是全表选中（cornerHeaderSelectMode 缺省 'all'），
        // 这两个口子都能绕过单选，一并收窄成 'cell'
        headerSelectMode: multiSelect ? 'inline' : 'cell',
        ...(multiSelect ? {} : { cornerHeaderSelectMode: 'cell' as const }),
        // 单选模式：拖拽不扩展选中范围。ctrlMultiSelect=false 只能关掉 Ctrl 追加，
        // 拖拽扩格走的是 grabing 状态改 range 端点那条路，原生开关只有 disableDragSelect
        ...(multiSelect ? {} : { disableDragSelect: true }),
        blankAreaClickDeselect: true,
        // 统计行不参与选中高亮
        disableSelect: (_col: number, row: number, inner: { columnHeaderLevelCount: number }) =>
          isSummaryRow(row, inner.columnHeaderLevelCount),
      },
      defaultRowHeight: rowHeight,
      defaultHeaderRowHeight: headerRowHeight,
      widthMode: 'standard',
      heightMode: 'standard',
      autoFillWidth,
      theme: THEME,
      // 启用 Ctrl+C 复制选中单元格内容
      keyboardOptions: {
        copySelected: true,
        // 关掉后 VTable 不再用 Ctrl/Shift 追加选中范围，等于单选
        ctrlMultiSelect: multiSelect,
        shiftMultiSelect: multiSelect,
        // Ctrl+A 全选（单选模式下不开启：keydown 处理只看这个开关，不看 ctrlMultiSelect，
        // 不关的话单选表格依然能被 Ctrl+A 一次全选）。
        // 它内部会派发 selected_cell（event.js 的 deelTableSelectAll），
        // 所以整行底色与对外行数会照常跟上，不需要额外接线。
        // disableHeaderSelect 让选中范围从第一个数据行开始，不含表头。
        ...(multiSelect ? { selectAllOnCtrlA: { disableHeaderSelect: true } } : {}),
      },
      ...(editableFields ? { editCellTrigger } : {}),
      ...(emptyTip ? { emptyTip: { text: emptyTip } } : {}),
      // 始终注册函数形态的 menu：配置文件在组件里，菜单内容在弹菜单时实时解析
      menu: buildMenuOptions(),
      // 导出插件：表格 INITIALIZED 时它会把 exportToExcel / exportToCsv 挂到 ListTable 实例上
      plugins: [exportPlugin],
    };
    optionsRef.current = options;
    const table = new ListTable(container, options);
    tableRef.current = table;
    // 记下建表用的那份配置，下面的同步 effect 据此判断要不要 updateOption
    syncedOptionRef.current = { columns: finalColumns, autoFillWidth };

    const toInfo = (args: { col: number; row: number; field?: unknown }): VTableCellInfo => ({
      col: args.col,
      row: args.row,
      field: args.field === undefined ? undefined : String(args.field),
      isSummaryRow: isSummaryRow(args.row, table.columnHeaderLevelCount),
      record: table.getCellOriginRecord(args.col, args.row) as
        | Record<string, unknown>
        | undefined,
    });

    /**
     * Ctrl / Cmd 点击的准备：只记下「点击前的选中行」与按下位置，不在这里改范围。
     *
     * 因为 mousedown 阶段还分不清用户是想点一下、还是按住拖选 —— 抢在拖拽前把 ranges 改成
     * toggle 的结果，拖拽过程又会去改端点，Ctrl+拖拽就废了。真正的 toggle 留到 click，
     * 那时用坐标比对确认没有拖动过。
     */
    table.on('mousedown_cell', (args) => {
      pendingCtrlToggleRef.current = null;
      // 断言成 MouseEvent：PointerEvent 继承自它，而 TouchEvent 上没有 ctrlKey / clientX，
      // 触摸场景下 ctrlKey 本来就是 falsy，下面会直接 return。
      const event = args.event as MouseEvent | undefined;
      const row = args.row;
      if (!multiSelectRef.current || !event) return;
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return;
      if (row < table.columnHeaderLevelCount) return;

      // Ctrl 模式下 VTable 已经把点中的这一格追加成最后一个 range，基准要把它排除掉；
      // 若最后那个 range 不是它（比如这次点击被 disableSelect 拦下），就以现有 ranges 为准，
      // 免得误删一个正经的选中范围。
      const ranges = (table.stateManager?.select?.ranges ?? []) as Array<{
        start: { row: number };
        end: { row: number };
      }>;
      const last = ranges[ranges.length - 1];
      const appended =
        Boolean(last) &&
        Math.min(last.start.row, last.end.row) === row &&
        Math.max(last.start.row, last.end.row) === row;
      const base = appended ? ranges.slice(0, -1) : ranges;

      pendingCtrlToggleRef.current = {
        row,
        x: event.clientX,
        y: event.clientY,
        rows: Array.from(collectRowIndexes(base, table.columnHeaderLevelCount)),
      };
    });

    /**
     * 点击单元格。
     *
     * 不按修饰键时只透传事件（选中高亮交给 VTable 原生 select，整行底色由 paintSelectedRows 铺）。
     * Ctrl 点击若确认没有拖动过，就执行整行 toggle；拖动过的交给原生的范围选择，不抢。
     */
    table.on('click_cell', (args) => {
      const pending = pendingCtrlToggleRef.current;
      pendingCtrlToggleRef.current = null;
      const event = args.event as MouseEvent | undefined;
      if (pending && event && pending.row === args.row) {
        const moved =
          Math.abs(event.clientX - pending.x) > 3 || Math.abs(event.clientY - pending.y) > 3;
        if (!moved) applyCtrlToggleRef.current(pending.row, pending.rows);
      }
      handlers.current.onCellClick?.(toInfo(args));
    });
    table.on('dblclick_cell', (args) => handlers.current.onCellDblClick?.(toInfo(args)));

    /**
     * 右键菜单 / 表头下拉菜单的点击。
     * VTable 只给「行列号 + menuKey」，这里补上页面真正需要的字段名、记录、单元格值，
     * 页面就不用再去查记录、也不用管表头占了几行。
     * 画布空白处的右键（col/row 为 -1）也会走到这里，此时 record / 值为 undefined。
     */
    table.on('dropdown_menu_click', (args) => {
      const onClick = menuRef.current?.onClick;
      if (!onClick) return;
      const { col, row } = args;
      const headerLevel = table.columnHeaderLevelCount;
      const inTable = col >= 0 && row >= 0;
      const inBody = col >= 0 && row >= headerLevel;
      onClick({
        col,
        row,
        rowIndex: inBody ? row - headerLevel : -1,
        field: args.field === undefined ? undefined : String(args.field),
        record: inBody
          ? (table.getCellOriginRecord(col, row) as Record<string, unknown> | undefined)
          : undefined,
        isSummaryRow: inBody && isSummaryRow(row, headerLevel),
        menuKey: String(args.menuKey ?? ''),
        text: String(args.text ?? ''),
        value: inTable ? table.getCellValue(col, row) : undefined,
        dataValue: inTable ? table.getCellOriginValue(col, row) : undefined,
      });
    });

    // 原生选中变化：先给选中的行铺整行底色，再通知外部
    table.on('selected_cell', () => {
      paintSelectedRows();
      if (!handlers.current.onActiveSelectionChange) return;
      // 直接按选中范围算行数：getSelectedCellInfos 会把每个格子的信息都构造出来，
      // Ctrl+A 全选时是 O(行×列) 的对象分配，而 ranges 只有几段
      const ranges = (table.stateManager?.select?.ranges ?? []) as Array<{
        start: { row: number };
        end: { row: number };
      }>;
      handlers.current.onActiveSelectionChange({
        rowCount: collectRowIndexes(ranges, table.columnHeaderLevelCount).size,
      });
    });

    // 选中被清空（点画布空白处等）：底色一并撤掉，否则会留在那儿
    table.on('selected_clear', () => {
      paintSelectedRows();
      handlers.current.onActiveSelectionChange?.({ rowCount: 0 });
    });
    // 单元格编辑完成：回传字段、行索引、新值与编辑前的值
    table.on('change_cell_value', (args) => {
      const field = args.field === undefined ? '' : String(args.field);
      const headerLevel = table.columnHeaderLevelCount;
      const index =
        typeof args.recordIndex === 'number' ? args.recordIndex : args.row - headerLevel;
      handlers.current.onCellValueChange?.({
        field,
        rowIndex: index,
        record: rowsRef.current[index],
        value: args.changedValue,
        // currentValue 是 VTable 在改写 record **之前**取的单元格值，即编辑前的内容。
        // （原生还有 rawValue = 未格式化的原值，需要时再加）
        previousValue: args.currentValue,
      });
    });
    // 排序由本组件处理：先把统计行摘掉再排，排完追加回最后一行。
    // 返回 false 阻止 VTable 自己排序（否则统计行会被一起排走）。
    table.on('sort_click', (args) => {
      const field = args.field === undefined ? '' : String(args.field);
      const order = args.order === undefined ? '' : String(args.order);
      const next: VTableSortState | null =
        !field || order === 'normal'
          ? null
          : { field, order: order === 'desc' ? 'desc' : 'asc' };
      setSortState(next);
      // 同步表头图标状态，但不触发排序
      table.updateSortState(next, false);
      return false;
    });

    // ResizeObserver 的通知是异步投递的：disconnect() 之后仍可能有一次已经排队的回调落地，
    // 而那时 table 已经 release、内部 scenegraph 被置空，resize() 会抛
    // 「Cannot read properties of null (reading 'element')」。用 disposed 挡在门外。
    let disposed = false;
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        table.resize();
        // resize 会重置底部冻结，这里补偿一次
        scheduleBottomFrozen(table, summaryRef.current ? 1 : 0);
      }
    });
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      table.release();
      tableRef.current = null;
      syncedOptionRef.current = null;
    };
    // 仅初始化一次，后续更新由下面的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 数据变化后重建表格。
   *
   * 用 useLayoutEffect 而不是 useEffect：useEffect 要等浏览器绘制完才执行，于是
   * 「这次 commit 移除了加载遮罩」和「setRecords 把数据画进 canvas」这两件事会落在不同的帧上 ——
   * 表现就是遮罩消失后先闪出一屏空表格，数据这才补上来。
   * setRecords 本身是同步的（clearCells → createSceneGraph → render），放进 layout effect 里
   * 就在同一次绘制之前完成，遮罩的消失与数据的出现变成原子的，中间不会露馅。
   */
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const sortState = table.sortState;
    // 先清掉排序状态，避免 setRecords 内部再排一次把统计行带走
    table.updateSortState(null, false);
    table.setRecords(rows);
    table.clearSelected();
    // setRecords 会重置排序状态（表头图标会消失），这里还原状态但不再执行排序
    if (sortState) table.updateSortState(sortState, false);
    scheduleBottomFrozen(table, summaryRef.current ? 1 : 0);
    // 换页 / 换数据后重置选中：铺过的底色一并撤掉（行号在新数据里已经没意义了）
    clearPaintedRows();
    // 主动通知外部归零：clearSelected() 不一定触发 selected_clear（它只在框选结束时触发），
    // 不回调的话页面那边的「选中行数」会停在旧值上
    handlers.current.onActiveSelectionChange?.({ rowCount: 0 });
    // 不依赖 summary：统计行内容没变时 stableSummaryRow 复用旧引用，rows 不失效，
    // 父组件重渲染就不会再触发一次全量 setRecords
  }, [rows, clearPaintedRows]);

  /** 重绘：异步拿到业务标记（如变更明细）后调用，让 cellStyle 生效 */
  const repaint = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    table.renderWithRecreateCells();
    scheduleBottomFrozen(table, summaryRef.current ? 1 : 0);
  }, []);

  /**
   * 取当前选中态：走 VTable 原生选中态（getSelectedCellInfos）。
   * 选中高亮可以是整行，但选中范围是实际点选的那一格，所以既能拿整行数据，
   * 也能拿到具体行列 / 字段（activeCell 即「选中的是哪一列」）。
   *
   * 注意 rows 直接来自选中范围，框选到底部时会把统计行也带进来 —— 业务侧按自己的数据源过滤。
   */
  const getSelection = useCallback((): VTableSelection => {
    const empty: VTableSelection = { rows: [], cells: [], activeCell: null };
    const table = tableRef.current;
    if (!table) return empty;
    const infos = table.getSelectedCellInfos();
    if (!infos || infos.length === 0) return empty;

    const byRow = new Map<number, Record<string, unknown>>();
    const cells: VTableCellSelection[] = [];
    infos.forEach((group) => {
      group.forEach((cell) => {
        const record = (cell.originData ?? table.getCellOriginRecord(cell.col, cell.row)) as
          | Record<string, unknown>
          | undefined;
        cells.push({
          col: cell.col,
          row: cell.row,
          field: cell.field === undefined ? undefined : String(cell.field),
          record,
          value: cell.value,
          dataValue: cell.dataValue,
        });
        if (record && !byRow.has(cell.row)) byRow.set(cell.row, record);
      });
    });

    const pos = table.stateManager?.select?.cellPos;
    const activeCell =
      pos && pos.col >= 0 && pos.row >= 0
        ? (cells.find((cell) => cell.col === pos.col && cell.row === pos.row) ?? cells[cells.length - 1])
        : (cells[cells.length - 1] ?? null);

    return {
      rows: Array.from(byRow.entries())
        .sort(([a], [b]) => a - b)
        .map(([, record]) => record),
      cells,
      activeCell: activeCell ?? null,
    };
  }, []);

  /**
   * 统一导出入口，转发给插件挂在 ListTable 实例上的 exportToExcel / exportToCsv。
   * 这两个方法由 TableExportPlugin 在表格 INITIALIZED 时才挂上，所以必须判空
   * （表格还没初始化完时静默跳过，而不是抛错）。
   */
  const exportExcel = useCallback(async (fileName?: string) => {
    const table = tableRef.current as
      | (ListTable & { exportToExcel?: () => Promise<unknown> })
      | null;
    if (!table?.exportToExcel) return undefined;
    if (fileName) exportExcelOptionsRef.current.fileName = fileName;
    return table.exportToExcel();
  }, []);

  const exportCsv = useCallback(async (fileName?: string) => {
    const table = tableRef.current as
      | (ListTable & { exportToCsv?: () => unknown })
      | null;
    if (!table?.exportToCsv) return undefined;
    if (fileName) exportCsvOptionsRef.current.fileName = fileName;
    return table.exportToCsv();
  }, []);

  /**
   * 清空表格的选中态。
   * - 原生选中：clearSelected() 负责解除高亮，行数这里主动回调归零
   *   （不能指望 selected_clear 事件，它只在框选结束时触发）。
   * - 铺过的整行底色：clearPaintedRows() 按记录的段坐标逐段撤掉。
   */
  const clearSelection = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    clearPaintedRows();
    table.clearSelected();
    handlers.current.onActiveSelectionChange?.({ rowCount: 0 });
  }, [clearPaintedRows]);

  // 把方法挂到 ref 上：<VTable ref={tableRef} />，之后用 tableRef.current?.repaint()
  /**
   * 按数据行下标取该行数据（0 起、不含表头）。
   *
   * 下标跟着**显示顺序**走：rowsRef 装的就是渲染用的那份数据（已按列头排序、
   * 统计行追加在末尾），所以排序后传 0 拿到的仍是界面上第一行 —— 而非原始 records 的第一条。
   * 底部统计行同样能命中（它的下标等于数据行数）。
   *
   * 这样页面各处就不必再手算「表头占了几行」；回调给的 rowIndex 可直接传进来。
   */
  const getRowByIndex = useCallback(
    (index: number): VTableRowInfo | undefined => {
      const table = tableRef.current;
      if (!table || !Number.isFinite(index)) return undefined;
      const rowIndex = Math.floor(index);
      if (rowIndex < 0) return undefined;
      const record = rowsRef.current[rowIndex] as Record<string, unknown> | undefined;
      if (!record) return undefined;
      return {
        rowIndex,
        rowKey: String(record[rowKey] ?? ''),
        record,
        // 统计行的判定按 VTable 坐标（含表头），这里换算过去
        isSummaryRow: isSummaryRow(
          rowIndex + table.columnHeaderLevelCount,
          table.columnHeaderLevelCount,
        ),
      };
    },
    [isSummaryRow, rowKey],
  );

  useImperativeHandle(
    ref,
    () => ({
      autoFitColumns,
      repaint,
      getSelection,
      getRowByIndex,
      getTable: () => tableRef.current,
      exportExcel,
      exportCsv,
      clearSelection,
    }),
    [autoFitColumns, repaint, getSelection, getRowByIndex, exportExcel, exportCsv, clearSelection],
  );

  /**
   * 列配置 / autoFillWidth 变化后同步给表格。
   * 表格就是拿建表时那份配置建的，配置没换过就不必 updateOption（那等于白重建一遍场景）。
   */
  useEffect(() => {
    const table = tableRef.current;
    const base = optionsRef.current;
    if (!table || !base) return;
    const synced = syncedOptionRef.current;
    if (synced && synced.columns === finalColumns && synced.autoFillWidth === autoFillWidth) {
      return;
    }
    syncedOptionRef.current = { columns: finalColumns, autoFillWidth };
    // 列不足容器时是否拉宽填满：可在运行时切换
    base.autoFillWidth = autoFillWidth;
    // 传入完整 options（去掉 records，避免重复 setRecords），否则 theme 等配置会被重置
    const next: ListTableConstructorOptions = { ...base, columns: finalColumns };
    delete next.records;
    void table.updateOption(next);
  }, [finalColumns, autoFillWidth]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* 加载遮罩：不透明盖住整张表，避免空表格被误读成「确实没有数据」 */}
      {loading ? (
        <div className="vtable-loading">
          <Spin size="large" />
          <span>{loadingTip}</span>
        </div>
      ) : null}
    </div>
  );
});

VTable.displayName = 'VTable';
