/**
 * 组行吸顶：滚动时把「当前可见明细所属的组行」固定在表头下方。
 *
 * 为什么需要它：分组后明细一多，滚过一屏就只剩一堆明细行，看不出这些行属于哪一组。
 * 原生 group 的标题条有吸顶行为，我们的分组是自研的树形结构（见 ./group.ts），
 * 拿不到那套 GroupTitleBar，所以这里自己补一层。
 *
 * 为什么不用 VTable 自带的 `enableTreeStickCell`：那个开关背后是
 * `es/plugins/list-tree-stick-cell.js`，它把组行 cell 复制到表头节点的 shadowRoot 里绘制。
 * 在本项目的依赖组合下（vtable 1.26.8 + vrender-core 1.1.11）打开它直接抛
 * `TypeError: undefined is not an object (evaluating 'shadowGroup.removeAllChild')` ——
 * 因为 `attachShadow()` 读的是 `application.graphicService.creator.shadowRoot`，
 * 而 vtable 只调了 `registerForVrender()`（只装 poptip），没有注册 ShadowRoot 图形；
 * 它指望的 `require('./shadow-root')` 兜底在 ESM 构建里根本走不到。
 * 另外它把层间距硬编码成 40px（源码里 `y: 40 * i`），而本项目行高 28，多层分组会错位。
 *
 * 这里走公开 API + DOM 覆盖层，逐个解决上面两个问题：
 * - 层级用「记录 → 祖先组行链」的 WeakMap 查，不依赖 scenegraph 内部结构；
 * - 行高、列位置（含横向滚动、冻结列）全部现问表格（`getCellRelativeRect`），不写死像素；
 * - `pointer-events: none`，点击 / 双击 / 右键仍然落到下面的真实单元格上。
 *
 * 组行显示什么：只画「这一行有值的列」（组值 + 汇总值），其它列留空 —— 与表格里的
 * 组行完全一致。文本走列自己的 `fieldFormat`，所以数字小数位、日期、枚举文案
 * 与单元格里看到的一模一样，不需要在这里另写一套格式化规则。
 */
import type { ColumnsDefine, ListTable } from '@visactor/vtable';
import { isGroupRow } from './group';

type Row = Record<string, unknown>;

/** 组行上「有值就画」的列定义：只用到 field 与 fieldFormat */
interface CellDef {
  field: string;
  fieldFormat?: (record: Row, col?: number, row?: number, table?: ListTable) => unknown;
}

/** 与 VTable.tsx 里组行的 cellStyle 保持一致：灰底 + 加粗 */
const GROUP_BG = '#fafafa';
const GROUP_BORDER = '#e8e8e8';
const GROUP_TEXT = 'rgba(0, 0, 0, 0.88)';

export interface StickyGroupOptions {
  /** 取表格实例（建表前可能还没有） */
  getTable: () => ListTable | null;
  /** 取当前渲染用的树形数据（组行 + children） */
  getRows: () => readonly Row[];
  /** 取列定义：组行上的值要用列自己的 fieldFormat 格式化，才不会和单元格里的写法不一致 */
  getColumns: () => ColumnsDefine;
  /** 行高（组行与明细行同高，项目里没有给组行单独设高）。做成取值函数：行高可在运行时改 */
  getRowHeight: () => number;
}

export interface StickyGroupController {
  /** 数据 / 列 / 分组配置变了以后调用：重建索引并重绘 */
  refresh: () => void;
  /** 卸载：摘掉事件与覆盖层 */
  release: () => void;
}

/** 事件名直接用字符串：这几个都在 TABLE_EVENT_TYPE 里，没必要为此引一层类型 */
const LISTEN_EVENTS = ['scroll', 'resize_column', 'tree_hierarchy_state_change'] as const;

/** 递归展开列定义（分组表头会嵌套 children），按 field 建索引 */
function collectCellDefs(columns: ColumnsDefine): Map<string, CellDef> {
  const result = new Map<string, CellDef>();
  const walk = (cols: ColumnsDefine) => {
    for (const col of cols) {
      const cell = col as { columns?: ColumnsDefine; field?: unknown };
      if (cell.columns) {
        walk(cell.columns);
        continue;
      }
      if (typeof cell.field !== 'string') continue;
      result.set(cell.field, cell as unknown as CellDef);
    }
  };
  walk(columns);
  return result;
}

/**
 * 取组行某一列要显示的文本。
 *
 * 走列自己的 `fieldFormat`，所以小数位、日期格式、枚举文案、页面自定义格式化
 * 全都与单元格里一模一样 —— 不要在这里另写一套格式化规则。
 */
function formatGroupCell(
  def: CellDef | undefined,
  value: unknown,
  record: Row,
  col: number,
  row: number,
  table: ListTable,
): string {
  let raw: unknown = value;
  if (def?.fieldFormat) {
    try {
      raw = def.fieldFormat(record, col, row, table);
    } catch {
      raw = value;
    }
  }
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return '';
  // boolean 列的格式化器返回 { checked, text }，这里只取文案
  if (typeof raw === 'object' && 'text' in (raw as Record<string, unknown>)) {
    return String((raw as { text?: unknown }).text ?? '');
  }
  return String(raw);
}

export function createStickyGroupController(options: StickyGroupOptions): StickyGroupController {
  const { getTable, getRows, getColumns, getRowHeight } = options;

  let host: HTMLElement | null = null;
  let layer: HTMLDivElement | null = null;
  /** 每层吸顶行一个 div，滚动时只更新内容与位置，避免整块重排闪烁 */
  const rowEls: HTMLDivElement[] = [];
  /** 记录 → 祖先组行链（不含自己）。记录对象是数据本身，WeakMap 不会拦住回收 */
  let ancestors = new WeakMap<Row, Row[]>();
  let frame = 0;
  let released = false;
  let boundTable: ListTable | null = null;

  const rebuildIndex = () => {
    ancestors = new WeakMap();
    const walk = (list: readonly Row[], chain: Row[]) => {
      for (const row of list) {
        ancestors.set(row, chain);
        const children = row.children;
        if (isGroupRow(row) && Array.isArray(children)) {
          walk(children as Row[], [...chain, row]);
        }
      }
    };
    walk(getRows(), []);
  };

  const ensureLayer = (table: ListTable): HTMLDivElement | null => {
    // getElement() 是容器 div 的公开入口；表格重建（updateOption 不会重建）时换过宿主就重挂
    const nextHost = table.getElement();
    if (!nextHost) return null;
    if (layer && host === nextHost) return layer;
    layer?.remove();
    host = nextHost;
    // 覆盖层按容器的坐标系定位，容器本身得是定位父级（VTable 默认没设 position）
    if (getComputedStyle(nextHost).position === 'static') {
      nextHost.style.position = 'relative';
    }
    const el = document.createElement('div');
    el.className = 'vtable-sticky-group';
    // 不接事件：吸顶条只是视觉提示，交互一律落到底下真实单元格
    // 宽度交给 render 按表格实际宽度设（容器可能比表格宽，铺满会在右侧留一条空灰条）
    el.style.cssText =
      'position:absolute;left:0;display:none;pointer-events:none;z-index:3;overflow:hidden;box-sizing:border-box;';
    nextHost.appendChild(el);
    layer = el;
    return el;
  };

  const render = () => {
    frame = 0;
    if (released) return;
    const table = getTable();
    if (!table) {
      if (layer) layer.style.display = 'none';
      return;
    }
    const el = ensureLayer(table);
    if (!el) return;

    const range = table.getBodyVisibleRowRange();
    if (!range || range.rowStart > range.rowEnd) {
      el.style.display = 'none';
      return;
    }
    const rowEnd = range.rowEnd;
    const rowHeight = getRowHeight();
    const headerHeight = table.getFrozenRowsHeight();

    /**
     * 「当前行」是谁，要分两种，别混成一个判据：
     *
     * 1. **正在滑出的组行**（垂直方向跨过表头下沿）：吸顶条要跟着它被遮的高度一点点长出来，
     *    所以优先认它；
     * 2. **完整可见的第一行**：它才是用户读到的第一行数据，吸顶条的内容必须以它为准。
     *
     * 只按「下边缘在表头下面」取（上一版就是这么写的）会把**只露 1px 的上一组明细**也选进来 ——
     * 那条明细几乎看不见，但它的祖先组是上一组，于是出现「底下明明是 2024-01 的明细，
     * 吸顶条却写着 2023-12」。
     *
     * 顺带说明为什么不用 `getBodyVisibleRowRange().rowStart`：它内部是
     * `ceil((scrollTop + 1) / defaultRowHeight)`，拿**平均行高**除内容坐标，
     * 表头 32 ≠ 行高 28 时会偏一行，组行压到表头下面了它还以为顶部是组行。
     */
    const dataStartRow = table.frozenRowCount;
    const scanStart = Math.max(range.rowStart - 3, dataStartRow);
    let slidingRow = -1;
    let baseRow = rowEnd;
    for (let row = scanStart; row <= rowEnd; row++) {
      const rect = table.getCellRelativeRect(0, row);
      // 整行都在表头上方（0.5 容差：正好贴齐表头下沿的那行已经看不见了）
      if (rect.bottom <= headerHeight + 0.5) continue;
      // 第一条完整可见的行；再往下的行只会更靠下，不会再有跨越表头下沿的
      const straddles = rect.top < headerHeight - 0.5;
      baseRow = row;
      if (!straddles) break;
      /**
       * 这一行跨着表头下沿 —— 它就是用户看到的第一行，算作 `baseRow`（吸顶内容以它为准），
       * 但只有**展开着的组行**才额外做「平滑补位」。
       *
       * 补位的语义是「这一组还有内容在下面，组行被表头吃掉多少、吸顶条就补多少」。
       * 折叠的组只有它自己一行，下面紧接着就是**下一组** —— 它只剩 1px 在视口里时
       * 还补出 27px，用户看到的就成了「底下明明是 2024-01 的明细，吸顶条却写着 2023-12」，
       * 而且这条凭空多出来的灰条直接盖住了下一组的第一行。
       *
       * 判断展开状态不用 `getHierarchyState`（它要指定 tree 列的索引，传错列会拿到 null），
       * 直接看下一行是不是自己的子行：是 → 展开，否（同层组行 / 已到末尾）→ 折叠。
       *
       * ⚠️ 跨越的**明细行**也要停在这里、当 baseRow：否则会一路跳到下面那一组的组行，
       * 吸顶条跟着变成「下一组」（或直接消失），而用户眼前明明还是一条上一组的明细。
       */
      const record = table.getCellOriginRecord(0, row);
      if (!record || typeof record !== 'object' || !isGroupRow(record)) break;
      const nextRecord = table.getCellOriginRecord(0, row + 1);
      const nextChain =
        nextRecord && typeof nextRecord === 'object'
          ? (ancestors.get(nextRecord as Row) ?? [])
          : [];
      if (nextChain.includes(record as Row)) slidingRow = row;
      break;
    }

    const topRow = slidingRow >= 0 ? slidingRow : baseRow;
    const topRect = table.getCellRelativeRect(0, topRow);

    // 可见记录集合：哪些祖先组行还露在屏幕上 —— 露着就不用再画一遍
    const visible = new Set<object>();
    for (let row = topRow; row <= rowEnd; row++) {
      const record = table.getCellOriginRecord(0, row);
      if (record && typeof record === 'object') visible.add(record as object);
    }
    const firstRecord = table.getCellOriginRecord(0, topRow);
    const first = firstRecord && typeof firstRecord === 'object' ? (firstRecord as Row) : null;
    const baseChain = first ? (ancestors.get(first) ?? []) : [];

    /**
     * 吸顶条是「已经滚出表头下沿的那些行」的替身，高度得跟着组行连续变化，两个方向都要：
     * - **出现**：组行正从表头下面滑出去，被遮住多少就露出多少（0 → 整行）；
     * - **消失**：下一个组行顶上来，吸顶条被顶掉多少就裁掉多少（整行 → 0）。
     */
    let sticky: Row[] = [];
    let shownHeight = 0;

    if (slidingRow >= 0 && first) {
      // 顶部那一行是被表头压住的组行：祖先照常满高，它自己只露被遮住的那部分
      const covered = Math.min(rowHeight, Math.max(0, headerHeight - topRect.top));
      sticky = [...baseChain.filter((group) => !visible.has(group)), first];
      shownHeight = baseChain.length * rowHeight + covered;
    } else {
      // 顶部是完整可见的第一行：它的祖先组行都已滚出（仍可见的那些在 visible 里）
      sticky = baseChain.filter((group) => !visible.has(group));
      /**
       * 吸顶条被**下一组组行**顶走：它顶上来多少就裁掉多少，顶到表头下沿时吸顶条正好消失。
       *
       * 不能图省事直接给满高（试过，会盖住下一组组行 —— 用户看到的就是「明明已经到
       * 2024-01 了，顶上还压着一整条 2023-12」），也不能裁得太早（那会露出上一组的明细，
       * 看起来像「下面还有一条明细，吸顶条却提前消失了」）。两者的平衡点就是这条组行本身的位置：
       * 它离表头还有多少空间，吸顶条就最多露多少。
       */
      let cutTop = Number.POSITIVE_INFINITY;
      for (let row = topRow + 1; row <= rowEnd; row++) {
        const record = table.getCellOriginRecord(0, row);
        if (!record || typeof record !== 'object' || !isGroupRow(record)) continue;
        cutTop = table.getCellRelativeRect(0, row).top;
        break;
      }
      const limit = first && isGroupRow(first) ? topRect.top : cutTop;
      shownHeight = Math.min(sticky.length * rowHeight, limit - headerHeight);
    }

    shownHeight = Math.max(0, shownHeight);
    if (sticky.length === 0 || shownHeight <= 0) {
      el.style.display = 'none';
      return;
    }

    // 贴着表头（含冻结行）下沿
    el.style.top = `${headerHeight}px`;
    // 宽度跟**列内容**走，不跟画布走：表格没铺满容器时画布仍是容器宽，
    // 按画布宽度铺会在右侧空白处拖出一条灰条（截图里那截）。
    // 列宽总和超过视口（横向滚动）时，取视口宽。
    el.style.width = `${Math.min(table.getAllColsWidth(), table.tableNoFrameWidth)}px`;
    el.style.display = 'block';
    el.style.height = `${shownHeight}px`;

    while (rowEls.length < sticky.length) {
      const rowEl = document.createElement('div');
      rowEl.style.cssText = `position:absolute;left:0;right:0;background:${GROUP_BG};color:${GROUP_TEXT};font-weight:bold;border-bottom:1px solid ${GROUP_BORDER};box-sizing:border-box;`;
      el.appendChild(rowEl);
      rowEls.push(rowEl);
    }
    while (rowEls.length > sticky.length) {
      rowEls.pop()?.remove();
    }
    // 第一层吸顶条与表头之间补一条分割线，否则灰底和表头连成一片、分不清哪条是吸顶的
    rowEls.forEach((rowEl, index) => {
      rowEl.style.borderTop = index === 0 ? `1px solid ${GROUP_BORDER}` : 'none';
    });

    // 列不按 getBodyVisibleCellRange 取（那套同样是 body 索引，还要自己补冻结列偏移），
    // 直接遍历全部列、用 getCellRect 问「这一列现在在哪」—— 横向滚动、冻结列、
    // 列宽拖拽全都由表格自己算好，覆盖层只负责按坐标摆。
    const cells = collectCellDefs(getColumns());
    const tableWidth = table.tableNoFrameWidth;

    sticky.forEach((group, index) => {
      const rowEl = rowEls[index];
      rowEl.style.top = `${index * rowHeight}px`;
      rowEl.style.height = `${rowHeight}px`;
      rowEl.textContent = '';

      for (let col = 0; col < table.colCount; col++) {
        const field = table.getHeaderField(col, 0) as string | undefined;
        if (!field) continue;
        const value = group[field];
        if (value === undefined || value === null || value === '') continue;
        // ⚠️ 必须是 getCellRelativeRect（视口坐标），不能用 getCellRect ——
        // 后者返回的是**内容坐标**（不减 scrollLeft），横向滚动后吸顶条会与列错位
        const rect = table.getCellRelativeRect(col, topRow);
        if (!rect || !(rect.width > 0)) continue;
        // 横向滚出窗口的列不画（覆盖层自己 overflow: hidden，这里只是省掉无用 DOM）
        if (rect.right <= 0 || rect.left >= tableWidth) continue;
        const text = formatGroupCell(cells.get(field), value, group, col, topRow, table);
        if (!text) continue;

        const cell = document.createElement('div');
        // 数值靠右，与单元格里 number 列的对齐一致（组行上的汇总值基本都是数字）
        const align = typeof value === 'number' ? 'flex-end' : 'flex-start';
        cell.style.cssText = `position:absolute;top:0;height:100%;left:${rect.left}px;width:${rect.width}px;display:flex;align-items:center;justify-content:${align};padding:0 8px;box-sizing:border-box;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;`;
        cell.textContent = text;
        rowEl.appendChild(cell);
      }
    });
  };

  /** 一次滚动里 VTable 会连发多个事件，合并到下一帧统一画 */
  const schedule = () => {
    if (frame || released) return;
    frame = requestAnimationFrame(render);
  };

  const unbind = () => {
    if (!boundTable) return;
    for (const name of LISTEN_EVENTS) {
      boundTable.off(name, schedule);
    }
    boundTable = null;
  };

  const bind = (table: ListTable) => {
    if (boundTable === table) return;
    unbind();
    boundTable = table;
    for (const name of LISTEN_EVENTS) {
      table.on(name, schedule);
    }
  };

  return {
    refresh: () => {
      const table = getTable();
      if (!table) return;
      bind(table);
      rebuildIndex();
      schedule();
    },
    release: () => {
      released = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      unbind();
      rowEls.length = 0;
      layer?.remove();
      layer = null;
      host = null;
    },
  };
}
