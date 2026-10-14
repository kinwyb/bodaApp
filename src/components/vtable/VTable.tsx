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
import { ListTable } from '@visactor/vtable';
import type { ColumnsDefine, ListTableConstructorOptions } from '@visactor/vtable';
import { TableExportPlugin } from '@visactor/vtable-plugins';
import type { TableExportPluginOptions } from '@visactor/vtable-plugins';
import {
  toVTableCellStyle,
  type VTableCellStyleHook,
  type VTableCellTooltipHook,
} from './cellStyle';
import {
  collectRowIndexes,
  createSelectionController,
  type VTableSelectedRowChangeInfo,
  type VTableSelection,
} from './selection';
import type { EditCellTrigger, VTableCellValueChangeInfo } from './editing';
import type { VTableExportCsvOptions, VTableExportExcelOptions } from './export';
import { scheduleBottomFrozen } from './frozen';
import type { VTableMenuConfig, VTableMenuItem } from './menu';
import { defaultCompare, type VTableSortState } from './sorting';
import { THEME } from './theme';
import type { StyleArgs, VTableCellInfo, VTableRowInfo } from './types';
import { shallowEqualRecord } from './utils';

// 本组件只负责「装配 + 事件绑定」，各功能域的实现分别在：
//   cellStyle.ts   单元格样式语义化层 + customCellStyle 插件访问
//   selection.ts   选中行整行底色 / Ctrl 整行 toggle / 当前激活行
//   menu.ts        右键菜单与表头下拉的类型
//   editing.ts     单元格编辑（触发方式、编辑结果回调）
//   export.ts      导出 Excel / CSV 的选项类型
//   sorting.ts     表头排序状态与比较规则
//   theme.ts       表格主题
//   frozen.ts      底部冻结行（统计行）
//   types.ts       跨域基础类型（样式回调参数、单元格信息、行信息）

/**
 * 统计行的主键值。
 * 组件会自动把它补到 summary 的 rowKey 字段上（summary 里已显式给主键时保留原值），
 * 所以业务不需要自己塞这个值；要判断统计行，用回调参数里的 isSummaryRow 即可。
 */
export const SUMMARY_ROW_KEY = '__summary__';

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
   * 当前激活行（鼠标点选 / 键盘方向键移动到的**那一行**）及其数据，判定规则与
   * onSelectedChange 完全一致 —— Ctrl+A、选中被清空、点表头时 record 为 undefined。
   *
   * 和 getSelection().rows 的区别：那个回的是「选中的行集合」（多选时有好几条，
   * 且看不出「哪一条是当前聚焦的」）；这个只回答「当前聚焦的是哪一行」。
   * 要操作选中集合用 getSelection，要操作「当前这一行」用它。
   */
  getActiveRow: () => VTableSelectedRowChangeInfo;
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
  /**
   * 单元格悬停提示：返回文案即在该格显示 tooltip。
   * 与 cellStyle 配套，用来解释「为什么这一格是红的」这类信息。
   */
  cellTooltip?: VTableCellTooltipHook;
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
  /**
   * 当前激活行变化回调：回传「当前激活的那一行」的整行数据（`info.record`）。
   *
   * 触发时机：单击、Shift 扩展、拖拽框选、Ctrl 点选（含被 Ctrl 取消勾选），
   * 以及**键盘上下左右移动选中**（方向键走 selectCell，最终同样派发选中变化）——
   * 这些都是「当前激活行」发生变化的时刻。左右移动只是换列、行没变，不会触发。
   *
   * 三处例外：
   * - Ctrl+A 全选：**回写「没有激活行」**（`record: undefined`）。那一刻 cellPos 还停在上次
   *   点过的那一格上，拿它当激活行是错的，所以主动清一次，免得页面留着过期的当前行。
   * - 选中被清空：同样回写 undefined（点画布空白处、`clearSelection()`、换了一页数据）。
   * - 点表头（整列选中）：静默不回调 —— 那不是选中一行数据，页面上的当前行保持不动。
   *
   * 只在**行**变化时回调：同一行里换点另一列不会重复触发 —— 要「每次点击都通知」请用 onCellClick。
   *
   * 与 onActiveSelectionChange 的分工：那个报「选了几行」（驱动按钮 disabled），
   * 这个报「哪一行是激活行 + 它的数据」（驱动右侧详情、编辑态等）。多选时激活行只有一个。
   */
  onSelectedChange?: (info: VTableSelectedRowChangeInfo) => void;
}

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
  cellTooltip,
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
  onSelectedChange,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<ListTable | null>(null);
  /** 构造时的完整 options：updateOption 需要完整配置，否则 theme / 行高等会被重置为默认值 */
  const optionsRef = useRef<ListTableConstructorOptions | null>(null);
  const handlers = useRef({
    onCellClick,
    onCellDblClick,
    onCellValueChange,
    onActiveSelectionChange,
    onSelectedChange,
  });
  handlers.current = {
    onCellClick,
    onCellDblClick,
    onCellValueChange,
    onActiveSelectionChange,
    onSelectedChange,
  };
  /** 建表 effect 只跑一次会锁住闭包，点击时要读的最新开关统一走 ref */
  const multiSelectRef = useRef(multiSelect);
  multiSelectRef.current = multiSelect;

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
              // 语义化字段在这里落到 VTable 原生样式名上；空对象翻译成 undefined，等于不改
              const translated = toVTableCellStyle(custom);
              if (translated) return { ...base, ...translated };
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
  const cellTooltipRef = useRef(cellTooltip);
  cellTooltipRef.current = cellTooltip;

  /**
   * 选择控制器（选中行整行底色 / Ctrl 整行 toggle / 当前激活行）—— 实现见 ./selection.ts。
   *
   * 用 ref 惰性创建一次、引用永久稳定：建表 effect 里锁住的闭包直接调它即可，
   * 不必再往 ref 上转发方法。各 deps 都是取值函数，读到的永远是最新值。
   */
  const selectionRef = useRef<ReturnType<typeof createSelectionController> | null>(null);
  if (!selectionRef.current) {
    selectionRef.current = createSelectionController({
      getTable: () => tableRef.current,
      getRows: () => rowsRef.current,
      getRowKeys: () => rowKeyByIndexRef.current,
      isSummaryRow,
      notifySelectionCount: (rowCount) =>
        handlers.current.onActiveSelectionChange?.({ rowCount }),
      notifyActiveRow: (info) => handlers.current.onSelectedChange?.(info),
    });
  }
  const selection = selectionRef.current;

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
        if (!moved) selection.applyCtrlToggle(pending.row, pending.rows);
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
      selection.paintSelectedRows();
      /**
       * 当前激活行的回调（onSelectedChange）。这里走到的情况有：鼠标点选 / 框选 / Ctrl 点选、
       * 键盘上下左右移动（方向键最终也会走 selectCell → selected_cell）。
       *
       * - Ctrl+A 全选：必须回写「没有激活行」，全选那一刻 cellPos 还停在上次点过的那一格上，
       *   拿它当激活行是错的（emitSelectedRow 内部按 isSelectAll 判空）；
       * - 落在表头行（点表头 = 整列选中）：静默跳过，不回调也不清页面状态 —— 那不是选中了一行数据；
       * - 其余（数据行）：如实回传鼠标/键盘当前激活的那一行。
       */
      const selectAll = table.stateManager?.select?.isSelectAll === true;
      const pos = table.stateManager?.select?.cellPos;
      if (selectAll || (pos && pos.col >= 0 && pos.row >= table.columnHeaderLevelCount)) {
        selection.emitSelectedRow();
      }
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
      selection.paintSelectedRows();
      // 激活行跟着回写「没有激活行」（能走到这里就没有「最后点选的那一行」了）
      selection.emitSelectedRow();
      handlers.current.onActiveSelectionChange?.({ rowCount: 0 });
    });
    // 悬停到单元格：页面给了文案就当 tooltip 显示（校验错误「为什么红」靠它）
    table.on('mouseenter_cell', (args) => {
      const hook = cellTooltipRef.current;
      if (!hook) return;
      const headerLevel = table.columnHeaderLevelCount;
      const index = args.row - headerLevel;
      // ⚠️ 事件参数里**没有 field**（vtable 只派发 col/row/cellRange/target —— 见
      // es/event/listener/table-group.js 的 MOUSEENTER_CELL 派发处，类型上 field 是可选所以 TS 不报错），
      // 必须自己按坐标反查列字段，否则拿到的永远是空串、匹配不到任何错误。
      const eventField = (args as { field?: unknown }).field;
      const columnField = table.getHeaderField?.(args.col, args.row);
      const content = hook({
        row: args.row,
        rowIndex: index,
        field: String(eventField ?? columnField ?? ''),
        rowKey: rowKeyByIndexRef.current[index] ?? '',
        isSummaryRow: isSummaryRow(args.row, headerLevel),
        record: rowsRef.current[index],
        dataValue: table.getCellOriginValue?.(args.col, args.row),
      });
      // 没文案就别调：VTable 自己的溢出文本提示还在用同一套 tooltip，
      // 这里空手调一次 showTooltip 会把它的提示顶掉
      if (!content) return;
      table.showTooltip(args.col, args.row, {
        content,
        /**
         * ⚠️ `referencePosition` 必须给，否则什么都看不见：
         * `BubbleTooltipElement._bindToCell` 里是 `if (!position && !referencePosition) return false`，
         * 两个都不传时内容虽已写进 tooltip 的 DOM（textContent 能读到），但元素不会被加上
         * `--shown` 类、始终停在 `--hidden` 状态 —— 表现就是「代码都对，就是不弹」。
         * rect 用表格自身的相对矩形，placement 缺省是 bottom（提示在单元格下方）。
         */
        referencePosition: {
          rect: table.getCellRangeRelativeRect({ col: args.col, row: args.row }),
        },
        appearDelay: 120,
        // 与编辑器里的校验提示条同配色，一眼能看出「这是错误说明」
        style: {
          bgColor: '#fff2f0',
          color: '#cf1322',
          padding: [6, 10],
          maxWidth: 260,
          arrowMark: true,
        },
      });
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
    selection.clearPaintedRows();
    // 激活行同理：换了一批数据后，就算行号与主键恰好没变，也不再是同一条记录，
    // 所以去重状态清空、无条件回写一次「没有激活行」
    selection.resetActiveRowTracking();
    selection.emitSelectedRow(true);
    // 主动通知外部归零：clearSelected() 不一定触发 selected_clear（它只在框选结束时触发），
    // 不回调的话页面那边的「选中行数」会停在旧值上
    handlers.current.onActiveSelectionChange?.({ rowCount: 0 });
    // 不依赖 summary：统计行内容没变时 stableSummaryRow 复用旧引用，rows 不失效，
    // 父组件重渲染就不会再触发一次全量 setRecords
  }, [rows, selection]);

  /** 重绘：异步拿到业务标记（如变更明细）后调用，让 cellStyle 生效 */
  const repaint = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    table.renderWithRecreateCells();
    scheduleBottomFrozen(table, summaryRef.current ? 1 : 0);
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
      getSelection: selection.getSelection,
      getRowByIndex,
      // 与 onSelectedChange 同一份判定，命中的就是「当前激活的那一行」
      getActiveRow: selection.resolveSelectedRow,
      getTable: () => tableRef.current,
      exportExcel,
      exportCsv,
      clearSelection: selection.clearSelection,
    }) satisfies VTableApi,
    [
      autoFitColumns,
      repaint,
      getRowByIndex,
      selection,
      exportExcel,
      exportCsv,
    ],
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
