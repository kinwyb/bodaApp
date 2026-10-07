import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ListTable,themes } from '@visactor/vtable';
import type { ColumnsDefine, ListTableConstructorOptions } from '@visactor/vtable';

/** 样式回调参数（VTable 未从包根导出该类型，这里按官方定义声明） */
interface StyleArgs {
  col: number;
  row: number;
  dataValue?: unknown;
  value?: unknown;
  table: { columnHeaderLevelCount: number };
}

/** 自定义单元格样式的回调参数 */
export interface VTableCellStyleInfo {
  /** 表格行号（含表头行） */
  row: number;
  /** 数据行索引（不含表头，0 起） */
  rowIndex: number;
  /** 列字段名 */
  field: string;
  /** 行主键（空白补足行 / 统计行为空串） */
  rowKey: string;
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

/** 表格实例对外暴露的方法 */
export interface VTableApi {
  /** 按内容自适应所有列宽（与双击列边界的效果一致） */
  autoFitColumns: () => void;
  /** 重绘表格：页面自定义样式（cellStyle）变化后调用即可生效 */
  repaint: () => void;
  /** 当前选中态（行 + 单元格 + 最后点选的单元格），取自 VTable 原生选中态 */
  getSelection: () => VTableSelection;
  /** 获取内部 ListTable 实例（供 SearchComponent 等外部工具使用） */
  getTable: () => ListTable | null;
}

export interface VTableProps {
  columns: ColumnsDefine;
  records: Array<Record<string, unknown>>;
  /** 行主键字段，用于回传勾选结果 */
  rowKey?: string;
  /** 勾选列的字段名；传入后会在最左侧自动插入一列复选框 */
  selectField?: string;
  /** 勾选列表头名称；不传则表头只显示复选框 */
  selectTitle?: string;
  /** 左侧冻结列数 */
  frozenColCount?: number;
  /** 统计行数据：追加为最后一行并固定在表格底部 */
  summary?: Record<string, unknown>;
  /** 选择高亮模式，默认整行高亮 */
  highlightMode?: 'row' | 'column' | 'cell' | 'cross';
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
  onCellClick?: (info: VTableCellInfo) => void;
  onCellDblClick?: (info: VTableCellInfo) => void;
  /** 勾选变化时回传全部选中行的主键 */
  onSelectionChange?: (keys: string[]) => void;
  /** 原生单元格选中变化（点击 / 框选），回传选中行数 */
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
  selectField,
  selectTitle = '',
  frozenColCount = 0,
  summary,
  highlightMode = 'row',
  autoFillWidth = false,
  cellStyle,
  editableFields,
  editCellTrigger = 'doubleclick',
  onCellValueChange,
  rowHeight = 28,
  headerRowHeight = 32,
  emptyTip,
  onCellClick,
  onCellDblClick,
  onSelectionChange,
  onActiveSelectionChange,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<ListTable | null>(null);
  /** 构造时的完整 options：updateOption 需要完整配置，否则 theme / 行高等会被重置为默认值 */
  const optionsRef = useRef<ListTableConstructorOptions | null>(null);
  /** 已勾选行的主键（VTable 的勾选状态在自己的 state 里，不回写 record） */
  const selectedRef = useRef<Set<string>>(new Set());
  const handlers = useRef({ onCellClick, onCellDblClick, onSelectionChange, onCellValueChange, onActiveSelectionChange });
  handlers.current = { onCellClick, onCellDblClick, onSelectionChange, onCellValueChange, onActiveSelectionChange };
  /** 当前排序状态（由表头排序图标驱动，排序在本地完成，统计行不参与） */
  const [sortState, setSortState] = useState<VTableSortState | null>(null);
  /** 判断某行是否为统计行，供勾选列 / 选中高亮禁用使用 */
  const isSummaryRowRef = useRef<(row: number, headerLevel: number) => boolean>(() => false);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  const baseColumns = useMemo<ColumnsDefine>(() => {
    if (!selectField) return columns;
    return [
      {
        field: selectField,
        title: selectTitle,
        width: selectTitle ? 88 : 56,
        cellType: 'checkbox',
        headerType: 'checkbox',
        align: 'center',
        headerStyle: { textAlign: 'left', padding: [0, 6] },
        // 统计行禁用勾选，避免用户点击后出现选中态
        disable: (args: { row: number; table: { columnHeaderLevelCount: number } }) =>
          isSummaryRowRef.current(args.row, args.table.columnHeaderLevelCount),
      },
      ...columns,
    ] as ColumnsDefine;
  }, [columns, selectField, selectTitle]);

  /** 统计行固定在数据行之后（含表头行号） */
  const isSummaryRow = useCallback(
    (row: number, headerLevel: number): boolean =>
      Boolean(summary) && row >= headerLevel + records.length,
    [records.length, summary],
  );

  isSummaryRowRef.current = isSummaryRow;

  const finalColumns = useMemo<ColumnsDefine>(() => {
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
            const isSelectColumn = (col as { field?: string }).field === selectField;
            // 勾选框在这些行里不显示
            const hideCheckbox = (style: Record<string, unknown>) => {
              if (!isSelectColumn) return style;
              return {
                ...style,
                checkboxStyle: {
                  defaultFill: 'transparent',
                  defaultStroke: 'transparent',
                  disableFill: 'transparent',
                  disableCheckedFill: 'transparent',
                  disableCheckedStroke: 'transparent',
                },
              };
            };
            // 统计行：灰底加粗，隐藏勾选框
            if (isSummaryRow(args.row, headerLevel)) {
              return hideCheckbox({ ...base, bgColor: '#fafafa', fontWeight: 'bold' });
            }
            // 页面自定义样式（业务提醒）
            const index = args.row - headerLevel;
            const rowKeyAt = rowKeyByIndexRef.current[index] ?? '';
            const custom = cellStyleRef.current?.({
              row: args.row,
              rowIndex: index,
              field: (col as { field?: string }).field ?? '',
              rowKey: rowKeyAt,
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
    return decorate(baseColumns);
  }, [baseColumns, editableFields, isSummaryRow, selectField]);

  /** 排序只作用于真实数据行，统计行永远追加在最后 */
  const rows = useMemo(() => {
    const data = sortState
      ? [...records].sort((a, b) => {
          const result = defaultCompare(a?.[sortState.field], b?.[sortState.field]);
          return sortState.order === 'desc' ? -result : result;
        })
      : records;
    return summary ? [...data, summary] : data;
  }, [records, summary, sortState]);

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
    // 勾选列保持原宽
    for (let col = selectField ? 1 : 0; col < host.colCount; col += 1) {
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
  }, [selectField]);

  // 创建实例（仅一次），后续数据/列变化通过 API 增量更新
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const options: ListTableConstructorOptions = {
      columns: finalColumns,
      records: rows,
      // 勾选列会插到最前，所以冻结列数要把它算进去
      frozenColCount: frozenColCount + (selectField ? 1 : 0),
      select: {
        highlightMode,
        headerSelectMode: 'inline',
        blankAreaClickDeselect: true,
        // 统计行不参与选中高亮
        disableSelect: (_col: number, row: number, inner: { columnHeaderLevelCount: number }) =>
          isSummaryRowRef.current(row, inner.columnHeaderLevelCount),
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
      },
      ...(editableFields ? { editCellTrigger } : {}),
      ...(emptyTip ? { emptyTip: { text: emptyTip } } : {}),
    };
    optionsRef.current = options;
    const table = new ListTable(container, options);
    tableRef.current = table;

    const toInfo = (args: { col: number; row: number; field?: unknown }): VTableCellInfo => ({
      col: args.col,
      row: args.row,
      field: args.field === undefined ? undefined : String(args.field),
      record: table.getCellOriginRecord(args.col, args.row) as
        | Record<string, unknown>
        | undefined,
    });

    // 选中高亮交给 VTable 原生 select（样式取自 theme.bodyStyle.select），这里只透传点击事件
    table.on('click_cell', (args) => handlers.current.onCellClick?.(toInfo(args)));
    table.on('dblclick_cell', (args) => handlers.current.onCellDblClick?.(toInfo(args)));

    // 原生选中变化：点击 / 框选单元格时通知外部
    table.on('selected_cell', () => {
      if (!handlers.current.onActiveSelectionChange) return;
      const infos = table.getSelectedCellInfos();
      if (!infos || infos.length === 0) {
        handlers.current.onActiveSelectionChange({ rowCount: 0 });
        return;
      }
      const rows = new Set<number>();
      infos.forEach((group) => group.forEach((cell) => rows.add(cell.row)));
      handlers.current.onActiveSelectionChange({ rowCount: rows.size });
    });
    // 单元格编辑完成：回传字段、行索引与新值
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
    table.on('checkbox_state_change', (args) => {
      if (!selectField) return;
      const record = table.getCellOriginRecord(args.col, args.row) as
        | Record<string, unknown>
        | undefined;
      const key = record ? String(record[rowKey] ?? '') : '';
      const summaryKey = summaryRef.current ? String(summaryRef.current[rowKey] ?? '') : '';
      if (key) {
        // 统计行不参与勾选
        if (key === summaryKey) return;
        if (args.checked) selectedRef.current.add(key);
        else selectedRef.current.delete(key);
      } else {
        // 解析不到记录，说明点的是表头复选框 → 全选 / 取消全选
        selectedRef.current.clear();
        if (args.checked) {
          recordsRef.current.forEach((item) => selectedRef.current.add(String(item?.[rowKey] ?? '')));
        }
      }
      handlers.current.onSelectionChange?.(Array.from(selectedRef.current));
    });

    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        table.resize();
        // resize 会重置底部冻结，这里补偿一次
        scheduleBottomFrozen(table, summaryRef.current ? 1 : 0);
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      table.release();
      tableRef.current = null;
    };
    // 仅初始化一次，后续更新由下面的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const sortState = table.sortState;
    // 先清掉排序状态，避免 setRecords 内部再排一次把统计行带走
    table.updateSortState(null, false);
    table.setRecords(rows);
    table.clearSelected();
    // setRecords 会重置排序状态（表头图标会消失），这里还原状态但不再执行排序
    if (sortState) table.updateSortState(sortState, false);
    scheduleBottomFrozen(table, summary ? 1 : 0);
    // 换页 / 换数据后重置勾选
    selectedRef.current.clear();
    if (selectField) {
      table.clearCheckboxState(selectField);
      handlers.current.onSelectionChange?.([]);
    }
  }, [rows, selectField, summary]);

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

  // 把方法挂到 ref 上：<VTable ref={tableRef} />，之后用 tableRef.current?.repaint()
  useImperativeHandle(
    ref,
    () => ({ autoFitColumns, repaint, getSelection, getTable: () => tableRef.current }),
    [autoFitColumns, repaint, getSelection],
  );

  useEffect(() => {
    const table = tableRef.current;
    const base = optionsRef.current;
    if (!table || !base) return;
    // 列不足容器时是否拉宽填满：可在运行时切换
    base.autoFillWidth = autoFillWidth;
    // 传入完整 options（去掉 records，避免重复 setRecords），否则 theme 等配置会被重置
    const next: ListTableConstructorOptions = { ...base, columns: finalColumns };
    delete next.records;
    void table.updateOption(next);
  }, [finalColumns, autoFillWidth]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />;
});

VTable.displayName = 'VTable';
