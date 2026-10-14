/**
 * 选择与激活行。
 *
 * 这个模块管三件事，它们共享同一份「选中范围」事实来源：
 * 1. **选中行整行铺底色** —— 走 customCellStyle 插件，而不是 VTable 原生选中高亮；
 * 2. **Ctrl 点选的整行 toggle** —— 原生只会把点中的那一格追加进范围，全选后想 Ctrl 点掉几行做不到；
 * 3. **当前激活行** —— `onSelectedChange` 回调与 `getActiveRow()` 共用同一份判定。
 *
 * 逻辑做成**工厂**而不是 React Hook：它整体是命令式的，只读写 table 实例与几份内部状态，
 * 不参与 React 渲染。组件里用 `useRef` 惰性创建一次，引用天然稳定 ——
 * 比一串 useCallback 更容易保证「不因引用变化触发多余重渲染 / updateOption」。
 */
import type { ListTable } from '@visactor/vtable';
import { getStylePlugin } from './cellStyle';

/** 选中行整行底色的样式 id 与配色（配色与 theme.bodyStyle.select.cellBgColor 保持一致） */
const SELECTED_ROW_STYLE_ID = '__selected_row__';
const SELECTED_ROW_BG = '#e6f4ff';

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
 *
 * 组件在事件回调里也要用（算对外行数、算 Ctrl 基准），所以从这里导出。
 */
export function collectRowIndexes(
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
 * 当前激活行的信息，即 `onSelectedChange` 的回调参数。
 *
 * 「激活行」取 VTable 的 `select.cellPos` —— 那是**最后激活的那个单元格**（单击、Shift 扩展、
 * 拖拽框选、键盘方向键都会在流程里写它，见 `es/state/select/update-position.js`），
 * 按行取就是「当前激活的这一行」。
 *
 * 另外要求这一行确实还在选中范围里：Ctrl 点选把一行取消掉之后 cellPos 仍停在那行，
 * 但它已经不是选中行了，这时会回传「没有激活行」——
 * 免得页面拿着一行已经被取消勾选的数据当选中行用。
 */
export interface VTableSelectedRowChangeInfo {
  /**
   * 当前激活行的数据 —— 就是页面传进 records 里的那条记录本身（引号相等，可直接引用 / 修改）。
   * 「没有激活行」时为 undefined：选中被清空（点画布空白处、clearSelection、换数据）、
   * 只点中表头、激活的那行被 Ctrl 取消勾选。
   */
  record?: Record<string, unknown>;
  /** VTable 行号（含表头行）；没有激活行时为 -1 */
  row: number;
  /** 数据行下标（不含表头，0 起，跟随显示顺序）；没有激活行时为 -1 */
  rowIndex: number;
  /** 行主键；没有激活行时为空串 */
  rowKey: string;
  /** 是否底部统计行（统计行不参与选中，正常不会出现在这里） */
  isSummaryRow: boolean;
}

/** 没有激活行时的空信息（每次回传都是副本，页面改到不会污染下一次回调） */
const EMPTY_SELECTED_ROW: VTableSelectedRowChangeInfo = {
  record: undefined,
  row: -1,
  rowIndex: -1,
  rowKey: '',
  isSummaryRow: false,
};

/**
 * 选择控制器需要的外部能力。
 * 全部做成取值函数（而不是传值）：controller 只创建一次，
 * 但表格实例、行数据、回调都会随渲染更新，必须现取现读。
 */
export interface SelectionControllerDeps {
  /** 取表格实例；表格尚未建好或已销毁时为 null */
  getTable: () => ListTable | null;
  /** 取「渲染用的那份数据」（已排序、统计行追加在末尾） */
  getRows: () => Array<Record<string, unknown>>;
  /** 取「表格行号 -> 行主键」的映射 */
  getRowKeys: () => string[];
  /** 统计行判定（按 VTable 行号，含表头） */
  isSummaryRow: (row: number, headerLevel: number) => boolean;
  /** 选中行数变化（转发给外部的 onActiveSelectionChange） */
  notifySelectionCount: (rowCount: number) => void;
  /** 当前激活行变化（转发给外部的 onSelectedChange） */
  notifyActiveRow: (info: VTableSelectedRowChangeInfo) => void;
}

export interface SelectionController {
  /** 给「当前选中的行」整行铺底色 */
  paintSelectedRows: () => void;
  /** 撤掉所有已铺的行底色（换数据 / 清空选中时用） */
  clearPaintedRows: () => void;
  /** 执行一次 Ctrl 点击的整行 toggle（已选中的取消、未选中的加入） */
  applyCtrlToggle: (row: number, baseRows: number[]) => void;
  /** 解析「当前激活行」，判定规则见 VTableSelectedRowChangeInfo */
  resolveSelectedRow: () => VTableSelectedRowChangeInfo;
  /** 把「当前激活行」推给页面；force 用于「换了整批数据但行号主键没变」的场景 */
  emitSelectedRow: (force?: boolean) => void;
  /** 取当前选中态（行 + 单元格 + 最后点选的那一格） */
  getSelection: () => VTableSelection;
  /** 清空选中：原生选中范围与铺过的整行底色一起清 */
  clearSelection: () => void;
  /** 数据整体换了一批：清空激活行的去重状态（让下一次 emit 必定回调） */
  resetActiveRowTracking: () => void;
}

export function createSelectionController(deps: SelectionControllerDeps): SelectionController {
  /**
   * 上一次实际铺过底色的**区间坐标**（不是行号）。
   *
   * 必须记坐标而不是"哪些行"：arrangeCustomCellStyle 的清除是按 cellPosition 的坐标串精确匹配的
   * （_getCustomCellStyleArrangementKey → `range:startCol,startRow,endCol,endRow`）。
   * 拿新算出来的段去清旧条目是对不上的 —— 全选铺的是「一整块大 range」，取消某一行后段划分变成两段，
   * 按新段坐标找不到旧条目，那一整块就清不掉，表现就是「勾选去掉了但高亮还在」。
   */
  let paintedSegments: Array<{ from: number; to: number }> = [];
  /** customCellStyle 的样式只需注册一次 */
  let styleRegistered = false;
  /**
   * 上一次回调出去的激活行，用来避免「同一行里换一列」这类重复通知。
   * 用行号 + 行主键一起比对：行号相同但主键不同（排序/换页后正好落在同一行号）算另一行。
   */
  let lastActiveRow: { row: number; rowKey: string } | null = null;

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
  const paintSelectedRows = () => {
    const table = deps.getTable();
    const plugin = table ? getStylePlugin(table) : undefined;
    if (!table || !plugin) return;

    if (!styleRegistered) {
      plugin.registerCustomCellStyle(SELECTED_ROW_STYLE_ID, { bgColor: SELECTED_ROW_BG });
      styleRegistered = true;
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
    const paintedKeys = new Set(paintedSegments.map(segmentKey));
    const nextKeys = new Set(nextSegments.map(segmentKey));
    // 先撤掉不再需要的段（不传样式 id 就是清除）
    paintedSegments
      .filter((seg) => !nextKeys.has(segmentKey(seg)))
      .forEach((seg) => plugin.arrangeCustomCellStyle(segmentCellPos(seg.from, seg.to)));
    // 再铺上新增的段
    nextSegments
      .filter((seg) => !paintedKeys.has(segmentKey(seg)))
      .forEach((seg) => {
        plugin.arrangeCustomCellStyle(segmentCellPos(seg.from, seg.to), SELECTED_ROW_STYLE_ID);
      });
    paintedSegments = nextSegments;
  };

  /** 撤掉所有已铺的行底色（换数据 / 清空选中时用，旧行号在新数据里已经没意义了） */
  const clearPaintedRows = () => {
    const table = deps.getTable();
    const plugin = table ? getStylePlugin(table) : undefined;
    if (!table || !plugin || paintedSegments.length === 0) return;
    // 按记下来的段坐标逐段清除：坐标必须与铺色时一致才能命中那些条目
    paintedSegments.forEach((seg) => {
      plugin.arrangeCustomCellStyle({
        range: {
          start: { col: 0, row: seg.from },
          end: { col: table.colCount - 1, row: seg.to },
        },
      });
    });
    paintedSegments = [];
  };

  /**
   * 解析「当前激活行」—— onSelectedChange 的推送与 VTableApi.getActiveRow 的按需取值共用这一份判定。
   *
   * 激活行取 VTable 的 `select.cellPos`（最后激活的单元格，鼠标点选与键盘移动都会写它），
   * 按行取就是「当前激活的这一行」。
   * 三个会让它「不算激活行」的例外，都返回「没有激活行」（record 为 undefined）：
   * - **点表头**：cellPos 落在表头行，那只是整列选中，不是选中了一行数据；
   * - **被 Ctrl 取消勾选**：cellPos 仍停在那一行，但它已经不在选中范围里了，
   *   这时若还报它是激活行，页面会拿着一条已被取消勾选的数据当选中行用；
   * - **Ctrl+A 全选**（`select.isSelectAll`）：cellPos 停在上次点过的那一格上
   *   （全选走 `updateSelectPos(-1,-1,isSelectAll=true)`，根本不更新 cellPos），不能拿它冒充激活行。
   */
  const resolveSelectedRow = (): VTableSelectedRowChangeInfo => {
    const table = deps.getTable();
    if (!table) return { ...EMPTY_SELECTED_ROW };
    const select = table.stateManager?.select;
    const headerLevel = table.columnHeaderLevelCount;
    // 全选时没有单一激活行：cellPos 是陈旧的，直接不看它
    const pos = select?.isSelectAll ? undefined : select?.cellPos;
    if (!pos || pos.col < 0 || pos.row < headerLevel) return { ...EMPTY_SELECTED_ROW };
    const ranges = (select?.ranges ?? []) as Array<{
      start: { row: number };
      end: { row: number };
    }>;
    // 必须在选中范围里才算激活行（Ctrl 取消勾选后 cellPos 仍停在原处，靠这一条排除）
    if (!collectRowIndexes(ranges, headerLevel).has(pos.row)) return { ...EMPTY_SELECTED_ROW };
    const rowIndex = pos.row - headerLevel;
    const record = deps.getRows()[rowIndex] as Record<string, unknown> | undefined;
    if (!record) return { ...EMPTY_SELECTED_ROW };
    return {
      record,
      row: pos.row,
      rowIndex,
      rowKey: deps.getRowKeys()[rowIndex] ?? '',
      isSummaryRow: deps.isSummaryRow(pos.row, headerLevel),
    };
  };

  const emitSelectedRow = (force = false) => {
    if (!deps.getTable()) return;
    const next = resolveSelectedRow();
    // 「没有激活行」记 null，与「激活行就是第 0 行」区分开
    const key = next.record ? { row: next.row, rowKey: next.rowKey } : null;
    const same =
      key === null
        ? lastActiveRow === null
        : lastActiveRow !== null &&
          lastActiveRow.row === key.row &&
          lastActiveRow.rowKey === key.rowKey;
    if (same && !force) return;
    lastActiveRow = key;
    deps.notifyActiveRow(next);
  };

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
  const applyCtrlToggle = (row: number, baseRows: number[]) => {
    const table = deps.getTable();
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

    // 改范围不会派发 selected_cell，整行底色、对外行数与激活行都得自己补一次。
    // 补激活行时若被 toggle 掉的正好是当前激活行，emitSelectedRow 会因为它已不在选中范围里
    // 而回传「没有激活行」—— 正是想要的结果。
    paintSelectedRows();
    deps.notifySelectionCount(selected.size);
    emitSelectedRow();
  };

  /**
   * 取当前选中态：走 VTable 原生选中态（getSelectedCellInfos）。
   * 选中高亮可以是整行，但选中范围是实际点选的那一格，所以既能拿整行数据，
   * 也能拿到具体行列 / 字段（activeCell 即「选中的是哪一列」）。
   *
   * 注意 rows 直接来自选中范围，框选到底部时会把统计行也带进来 —— 业务侧按自己的数据源过滤。
   */
  const getSelection = (): VTableSelection => {
    const empty: VTableSelection = { rows: [], cells: [], activeCell: null };
    const table = deps.getTable();
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
        ? (cells.find((cell) => cell.col === pos.col && cell.row === pos.row) ??
          cells[cells.length - 1])
        : (cells[cells.length - 1] ?? null);

    return {
      rows: Array.from(byRow.entries())
        .sort(([a], [b]) => a - b)
        .map(([, record]) => record),
      cells,
      activeCell: activeCell ?? null,
    };
  };

  /**
   * 清空表格的选中态。
   * - 原生选中：clearSelected() 负责解除高亮，行数这里主动回调归零
   *   （不能指望 selected_clear 事件，它只在框选结束时触发）。
   * - 铺过的整行底色：clearPaintedRows() 按记录的段坐标逐段撤掉。
   */
  const clearSelection = () => {
    if (!deps.getTable()) return;
    clearPaintedRows();
    deps.getTable()?.clearSelected();
    // 选中没了就没有激活行了（clearSelected 不派发 selected_clear，得自己补）
    emitSelectedRow();
    deps.notifySelectionCount(0);
  };

  return {
    paintSelectedRows,
    clearPaintedRows,
    applyCtrlToggle,
    resolveSelectedRow,
    emitSelectedRow,
    getSelection,
    clearSelection,
    resetActiveRowTracking: () => {
      lastActiveRow = null;
    },
  };
}
