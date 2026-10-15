/**
 * 按行展开：撑开目标行 + DOM 覆盖层渲染任意 React 控件。
 *
 * 与官方 MasterDetailPlugin 的分工取舍：那套把「撑行高的机制」和「内容层」焊死在一起 ——
 * 内容只能是嵌套 ListTable（detailTableOptions 就是一份完整表格配置），样式带着一整套
 * 表格语义，且重度依赖内部 API（_setRowHeight、_heightResizedRowMap、猴子补丁
 * _refreshHierarchyState、包裹 stage.defaultLayer.render/draw），升版本首当其冲。
 *
 * 这里只保留机制，内容层整个换掉：
 * 1. **撑行高**走公开 API `table.setRowHeight(row, h)` —— 它内部一次做完：写行高 map、
 *    重排该行单元格、把可见窗口内后续行的 y 下移、更新表格尺寸与滚动条，并把该行标记进
 *    `_heightResizedRowMap`（此后 autoRowHeight 不再覆盖它，见 scenegraph.js:742 与
 *    compute-row-height.js:134）。只动可见窗口（proxy.rowStart..rowEnd）内的行，窗口外的行
 *    滚入时按行高 map 自然布局，不需要额外处理。
 * 2. **内容层**是绝对定位的 DOM 覆盖层，用 `createRoot` 渲染页面传来的 ReactNode ——
 *    antd 表单、按钮、图表都能放，交互与样式完全自由。项目里 `editors/antd-editors.tsx`
 *    的编辑器就是同一模式（absolute div + createRoot），这里把它从「一个单元格」放大到
 *    「一整行的展开区」。
 * 3. **展开按钮**是专门列上的 customRender 图元（rect + 折线箭头），只画不响应事件 ——
 *    customRender 元素没有事件通道（vrender 的 onClick 映射只存在于 JSX customLayout），
 *    点击统一走 `click_cell`，与编辑器的「控件在 DOM、交互走表格事件」一致。
 *
 * 逻辑做成**工厂**而不是 React Hook：整体是命令式的，只读写 table 实例与几份内部状态，
 * 不参与 React 渲染。组件里用 useRef 惰性创建一次，deps 全是取值函数，读到的永远是最新值
 * （同 selection.ts 的模式）。
 */
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import type { ColumnsDefine, ListTable } from '@visactor/vtable';
import { BODY_CELL_PADDING } from './theme';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 展开列占用的字段名：records 里没有这个字段，值恒为 undefined，仅供列定义定位 */
export const EXPAND_COLUMN_FIELD = '__vtable_expand__';
/** 展开列宽度 */
export const EXPAND_COLUMN_WIDTH = 44;
/**
 * 展开行的单元格样式补偿：**把下内边距撑到展开区的高度**。
 *
 * 撑高行之后 VTable 会按新行高重新摆放这一行的内容（默认垂直居中），内容于是落到行中部 ——
 * 而展开层压在原行高下方的位置，正好把它整个盖住，看起来就是「展开后这一行空白了」
 * （实测：行高 28 → 92 时文字中心落在 y≈46，展开层盖住 28~92 这一段）。
 *
 * 为什么不是简单改 `textBaseline: 'top'`：那样确实能躲开遮挡（实测截图确认），但这一行会
 * 与上下行的居中不一致 —— 别人都居中、就它贴顶，非常扎眼。
 *
 * 补下内边距则让内容区缩回「原行高」那一段：行高 = 原行高 + 展开区高度，
 * 下内边距 = 原下内边距 + 展开区高度，于是内容区高度恰好还是 `原行高 - 上下内边距`，
 * 文字仍在原来的垂直位置居中，与相邻行严丝合缝地对齐。
 */
export function expandedRowCellStyle(detailHeight: number): { padding: number[] } {
  const [vertical, horizontal] = BODY_CELL_PADDING;
  return { padding: [vertical, horizontal, vertical + detailHeight, horizontal] };
}
/** 展开区默认高度 */
const DEFAULT_DETAIL_HEIGHT = 200;
/** 展开按钮方块边长 */
const BUTTON_SIZE = 18;
/** 展开区最小高度（页面传了更小的值也兜住，不然覆盖层没法看） */
const MIN_DETAIL_HEIGHT = 40;
/**
 * 「按下 -> 抬起」的位移阈值（px）：超过就当成拖拽（框选 / 滚动），不当作点击。
 * 与 VTable 自己判断 Ctrl 点击是否拖拽用的是同一量级（3px）。
 */
const CLICK_MOVE_THRESHOLD = 4;

// ─── 对外类型 ────────────────────────────────────────────────────────────────

/** 展开行的上下文信息：按钮判定、展开内容都用它 */
export interface VTableExpandableInfo {
  /** 行主键 */
  rowKey: string;
  /** 数据行下标（不含表头，0 起，跟随显示顺序） */
  rowIndex: number;
  /** VTable 行号（含表头） */
  row: number;
  /** 该行的数据 */
  record: Record<string, unknown>;
}

export interface VTableExpandableOptions {
  /**
   * 该行按钮是否有效（能否展开）：返回 false 时按钮置灰、点击无响应。
   * 不传则所有行可展开。统计行永远不可展开（组件内部拦截）。
   */
  rowExpandable?: (info: VTableExpandableInfo) => boolean;
  /** 展开区内容：返回任意 React 节点（antd 表单 / 子表格 / 图表都行） */
  renderExpanded: (info: VTableExpandableInfo) => ReactNode;
  /** 展开区高度（px），默认 200。内容更高时覆盖层内部可出现滚动条 */
  height?: number;
  /** 展开态变化（展开 / 收起 / 重建后）回调，回传当前所有展开行的主键 */
  onExpandChange?: (info: { expandedRowKeys: string[] }) => void;
}

// ─── customRender 的最小类型声明 ─────────────────────────────────────────────

/**
 * VTable 没有从包根导出 ICustomRender 系列类型（es/index.d.ts 只转出了列定义等少量类型），
 * 这里按官方定义（ts-types/customElement.d.ts）摘一个最小集，装配列定义时再整体断言。
 * 注意 RectElement 上没有 lineWidth（边框粗细恒为 1），折线才有。
 */
type ButtonElement =
  | {
      type: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      radius?: number;
      fill?: string;
      stroke?: string;
      cursor?: string;
    }
  | {
      type: 'line';
      points: Array<{ x: number; y: number }>;
      stroke?: string;
      lineWidth?: number;
      cursor?: string;
    };

interface ExpandButtonArgs {
  col: number;
  row: number;
  rect?: { width: number; height: number };
  /** VTable 未导出 BaseTableAPI，按 unknown 收，用的时候再断言 */
  table: unknown;
}

interface ExpandButtonResult {
  elements: ButtonElement[];
  expectedHeight: number;
  expectedWidth: number;
  renderDefault?: boolean;
}

// ─── 内部状态 ────────────────────────────────────────────────────────────────

/** 每个展开行的记录：展开前行高（收起时还原）+ 展开区高度 */
interface ExpandedEntry {
  originalHeight: number;
  detailHeight: number;
}

/** 覆盖层实例：DOM 容器 + React root + 滚轮转发监听 */
interface OverlayEntry {
  wrapper: HTMLDivElement;
  root: Root;
  onWheel: (event: WheelEvent) => void;
}

/** 画布上按下的待确认点击：抬起时若没怎么移动，就算是点了一次展开列 */
interface PendingPress {
  col: number;
  row: number;
  clientX: number;
  clientY: number;
}

/** setRecords 之前记下的「展开行 -> 旧行号」，reapply 时据此还原旧行高 */
/** setRecords 之前记下的「展开行 -> 旧行号」，reapply 时据此还原旧行高（每控制器一份） */
interface CapturedRow {
  rowKey: string;
  row: number;
}

export interface ExpandableControllerDeps {
  /** 取表格实例；表格尚未建好或已销毁时为 null */
  getTable: () => ListTable | null;
  /** 取表格容器 div（覆盖层挂载点） */
  getContainer: () => HTMLElement | null;
  /** 取画布元素（滚轮转发目标） */
  getCanvas: () => HTMLCanvasElement | null;
  /** 取「渲染用的那份数据」（已排序、统计行追加在末尾） */
  getRows: () => Array<Record<string, unknown>>;
  /** 取「数据行下标 -> 行主键」的映射 */
  getRowKeys: () => string[];
  /** 取展开配置（页面每次渲染都是新对象，必须现取现读） */
  getOptions: () => VTableExpandableOptions | undefined;
  /** 展开列列号：行号列占 1 列时为 1，否则为 0 */
  getExpandCol: () => number;
  /** 统计行判定（按 VTable 行号，含表头） */
  isSummaryRow: (row: number, headerLevel: number) => boolean;
}

export interface ExpandableController {
  /** 展开列的 customRender：画展开/收起按钮（禁用态置灰） */
  renderButton: (args: ExpandButtonArgs) => ExpandButtonResult;
  /**
   * 按下展开列时调用（由组件的 mousedown_cell 转发），记下「可能是点击」的位置；
   * 真正的切换发生在画布 DOM 的 pointerup 上（见 notePress 的说明）。
   */
  notePress: (col: number, row: number, clientX: number, clientY: number) => void;
  /** setRecords **之前**调用：记下每个展开行当前的行号（旧行高靠它还原） */
  captureRows: () => void;
  /** setRecords **之后**调用：还原旧行高、按新行号撑高并重挂覆盖层 */
  reapply: () => void;
  /** 滚动 / 容器尺寸变化：重算所有覆盖层位置 */
  positionAll: () => void;
  /** 销毁：卸掉所有覆盖层与 DOM 监听（表格 release、StrictMode 重挂载时调用） */
  dispose: () => void;
  /** 按行主键展开；行不在当前数据里或不可展开时静默忽略 */
  expand: (rowKey: string) => void;
  /** 按行主键收起 */
  collapse: (rowKey: string) => void;
  /** 收起全部 */
  collapseAll: () => void;
  isExpanded: (rowKey: string) => boolean;
  /**
   * 该展开行的展开区高度；未展开的行返回 0。
   * 列样式靠它补下内边距（见 expandedRowCellStyle），让内容留在原行高那一段里居中。
   */
  getDetailHeight: (rowKey: string) => number;
  getExpandedRowKeys: () => string[];
}

// ─── 控制器 ──────────────────────────────────────────────────────────────────

export function createExpandableController(deps: ExpandableControllerDeps): ExpandableController {
  /** 已展开的行：rowKey -> 行高记录。按主键而不是行号存 —— 排序 / 换页后行号全变 */
  const expanded = new Map<string, ExpandedEntry>();
  /** 覆盖层实例：rowKey -> DOM + React root */
  const overlays = new Map<string, OverlayEntry>();
  /** 覆盖层宿主：盖在容器上的透明层，pointer-events:none，只有覆盖层本身可交互 */
  let host: HTMLDivElement | null = null;
  /** setRecords 之前记下的「展开行 -> 旧行号」，reapply 时据此还原旧行高 */
  let capturedRows: CapturedRow[] = [];
  /** 画布上按下的待确认点击（见 notePress） */
  let pendingPress: PendingPress | null = null;
  /** 已经挂了 DOM 监听的容器（换容器或销毁时解绑） */
  let boundHost: HTMLElement | null = null;

  // ─── 基础查询 ───

  const headerLevelOf = (table: ListTable) => table.columnHeaderLevelCount;

  const findRowIndex = (rowKey: string): number => {
    const index = deps.getRowKeys().indexOf(rowKey);
    return index;
  };

  const buildInfo = (rowKey: string, rowIndex: number, row: number): VTableExpandableInfo => ({
    rowKey,
    rowIndex,
    row,
    record: deps.getRows()[rowIndex] ?? {},
  });

  const notifyChange = () => {
    deps.getOptions()?.onExpandChange?.({ expandedRowKeys: Array.from(expanded.keys()) });
  };

  // ─── 覆盖层 ───

  const ensureHost = (container: HTMLElement): HTMLDivElement => {
    if (!host) {
      host = document.createElement('div');
      // inset:0 覆盖整个容器；overflow:hidden 把滚出视口的覆盖层裁掉（与画布行为一致）；
      // pointer-events:none 让未覆盖区域的点击/滚轮照旧穿透到画布
      host.style.cssText =
        'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1;';
      container.appendChild(host);
    }
    return host;
  };

  /**
   * 展开区内部还能不能往这个方向滚 —— 能就让给它，不能才转给主表格。
   *
   * **横向必须一起判**：展开层的宽度跟着表格总宽走（表宽超出视口时它自己就有横向滚动条），
   * 只判纵向的话横向滚轮会被当成「滚不动」转给主表格，用户就永远滚不动展开区的横向内容。
   *
   * 每个方向单独看当前位置：贴边了才放行给表格，否则内部滚（不这样判的话，滚到一半
   * 就会把剩下的量甩给表格，表现为「展开区没滚到头、主表格先动了」）。
   */
  const canScrollWithin = (el: HTMLElement, event: WheelEvent): boolean => {
    const { deltaX, deltaY } = event;
    if (deltaY !== 0 && el.scrollHeight > el.clientHeight + 1) {
      const maxTop = el.scrollHeight - el.clientHeight - 1;
      if (deltaY < 0 ? el.scrollTop > 0 : el.scrollTop < maxTop) return true;
    }
    if (deltaX !== 0 && el.scrollWidth > el.clientWidth + 1) {
      const maxLeft = el.scrollWidth - el.clientWidth - 1;
      if (deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft < maxLeft) return true;
    }
    return false;
  };

  const mountOverlay = (rowKey: string, row: number, entry: ExpandedEntry) => {
    const table = deps.getTable();
    const container = deps.getContainer();
    const options = deps.getOptions();
    if (!table || !container || !options) return;
    const rowIndex = row - headerLevelOf(table);
    const info = buildInfo(rowKey, rowIndex, row);

    const existing = overlays.get(rowKey);
    if (existing) {
      // 复用 root 只刷新内容：保留展开区内部的组件 state（比如用户正在填的表单），
      // 排序 / 换数据导致的重建不会把用户填了一半的东西冲掉
      existing.root.render(options.renderExpanded(info));
      positionOverlay(rowKey, row, entry);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'vtable-expand-overlay';
    ensureHost(container).appendChild(wrapper);

    const onWheel = (event: WheelEvent) => {
      // 展开区是个**滚动孤岛**：鼠标停在它上面时，滚轮只作用于它自己 ——
      // 既不冒泡给主表格，也不主动转发过去。
      //
      // 两个都试过、都被实测否掉了：
      // 1. 让事件冒泡（不 stopPropagation）：覆盖层就挂在表格容器里，事件冒上去会进
      //    VTable 的滚动逻辑，于是展开区自己还没滚、主表格已经跟着滚了；
      // 2. 展开区滚不动时把滚轮转给画布：同样会让主表格动起来。
      // 后果都是展开区随行滚出视口，用户正想看/正在操作的内容直接消失。
      //
      // 滚不动时宁可没反应：展开区只占一行的高度，鼠标稍微移开就能滚表格。
      event.stopPropagation();
      if (!canScrollWithin(wrapper, event)) {
        // 自己滚不动：挡掉浏览器接着去滚页面/外层容器，保持「无反应」
        event.preventDefault();
      }
    };
    wrapper.addEventListener('wheel', onWheel, { passive: false });

    const root = createRoot(wrapper);
    overlays.set(rowKey, { wrapper, root, onWheel });
    root.render(options.renderExpanded(info));
    positionOverlay(rowKey, row, entry);
  };

  const unmountOverlay = (rowKey: string) => {
    const overlay = overlays.get(rowKey);
    if (!overlay) return;
    overlay.wrapper.removeEventListener('wheel', overlay.onWheel);
    overlay.root.unmount();
    overlay.wrapper.remove();
    overlays.delete(rowKey);
  };

  /**
   * 把覆盖层摆到展开行的「原内容下方」。
   * 坐标用 `getCellRangeRelativeRect`（canvas 相对坐标，已含滚动偏移），
   * 再加展开前的行高就是展开区起点；宿主 overflow:hidden 负责裁掉半截露头的部分。
   */
  const positionOverlay = (rowKey: string, row: number, entry: ExpandedEntry) => {
    const table = deps.getTable();
    const overlay = overlays.get(rowKey);
    const container = deps.getContainer();
    if (!table || !overlay) return;
    const rect = table.getCellRangeRelativeRect({ col: 0, row });
    const top = rect.top + entry.originalHeight;
    const bottom = top + entry.detailHeight;
    const viewportHeight = container?.clientHeight ?? 0;
    // 整个展开区都滚出视口就藏起来：宿主虽会裁剪，但藏掉更稳（不残留可交互区域）
    if (bottom <= 0 || top >= viewportHeight) {
      overlay.wrapper.style.display = 'none';
      return;
    }
    overlay.wrapper.style.display = '';
    overlay.wrapper.style.left = '0px';
    overlay.wrapper.style.top = `${Math.round(top)}px`;
    overlay.wrapper.style.width = `${Math.round(table.tableNoFrameWidth)}px`;
    overlay.wrapper.style.height = `${Math.round(entry.detailHeight)}px`;
  };

  // ─── 展开 / 收起 ───

  const expandRow = (rowKey: string, row: number) => {
    const table = deps.getTable();
    const options = deps.getOptions();
    if (!table || !options) return;
    const detailHeight = Math.max(MIN_DETAIL_HEIGHT, options.height ?? DEFAULT_DETAIL_HEIGHT);
    const originalHeight = table.getRowHeight(row);
    const entry: ExpandedEntry = { originalHeight, detailHeight };
    // 先记状态再撑行高：setRowHeight 内部会重排该行单元格、重画 customRender，
    // 那一刻按钮必须已经是「展开态」
    expanded.set(rowKey, entry);
    table.setRowHeight(row, originalHeight + detailHeight);
    mountOverlay(rowKey, row, entry);
    notifyChange();
  };

  /**
   * 收起一行。row 为 -1 表示行已不在当前数据里（换页 / 被筛掉）：
   * 那时只撤展开态与覆盖层，没有行高要收。
   */
  const collapseRow = (rowKey: string, row: number) => {
    const table = deps.getTable();
    const entry = expanded.get(rowKey);
    if (!table || !entry) return;
    // 先摘状态再收行高：理由同 expandRow（收起时按钮要立刻变回「可展开」）
    expanded.delete(rowKey);
    unmountOverlay(rowKey);
    if (row >= 0) table.setRowHeight(row, entry.originalHeight);
    notifyChange();
  };

  /**
   * 真正执行一次展开列的点击（按下已确认未拖拽）。
   * 列号 / 表头 / 统计行 / 禁用态的判定都在 notePress 里做过，这里只做切换。
   */
  const commitPress = (press: PendingPress) => {
    const table = deps.getTable();
    const options = deps.getOptions();
    if (!table || !options) return;
    const headerLevel = headerLevelOf(table);
    const rowIndex = press.row - headerLevel;
    const rowKey = deps.getRowKeys()[rowIndex] ?? '';
    if (!rowKey) return;
    if (expanded.has(rowKey)) {
      collapseRow(rowKey, press.row);
      return;
    }
    const info = buildInfo(rowKey, rowIndex, press.row);
    // 行数据说话：不可展开的行按钮是灰的，点击也不响应
    if (options.rowExpandable && !options.rowExpandable(info)) return;
    expandRow(rowKey, press.row);
  };

  /**
   * 容器上的 pointerdown（**捕获阶段**）：清掉上一次没抬起就结束的待确认点击。
   *
   * 必须挂捕获 + 挂在容器上：vrender 是在**画布**上以捕获阶段监听 pointerdown 的，
   * 捕获顺序是「容器 -> 画布」，所以这个处理器一定早于 VTable 的派发（也就早于 notePress），
   * 不会把本次刚记下的 pending 清掉。挂在画布上就踩过这个坑 —— 画布是事件目标，
   * 目标阶段的冒泡监听器在 vrender 的捕获监听器之后执行，正好把 notePress 刚设的值清空。
   */
  const onHostPointerDown = () => {
    pendingPress = null;
  };

  /**
   * 容器上的 pointerup（**冒泡阶段**）：确认「按下后没怎么移动」就当作点了一次展开列。
   *
   * 为什么不用 VTable 的 click_cell：**自绘（customRender）单元格的第一次点击不会派发
   * click_cell**（实测复现，纯 VTable 环境同样如此 —— 一个只有 customRender 列、不带任何
   * 展开逻辑的表格，第一次点该列也没有 click_cell，第二次起才正常）。
   * 原因是选中态变化会在 pointerup 派发到 tableGroup 之前触发一次单元格内容重建，
   * VTable 处理器里随后的命中判定落空，整个 click_cell 分支被跳过。这是上游行为，改不动；
   * 而 DOM 事件与场景图完全解耦，用「mousedown_cell 记位置 + pointerup 确认位移」自己判定，
   * 任何一次点击都可靠。
   *
   * 挂冒泡 + 挂在容器上：冒泡顺序是「画布 -> 容器」，所以它一定在 vrender 的处理之后执行，
   * 不与 VTable 自己的 pointerup 逻辑抢时序。
   */
  const onCanvasPointerUp = (event: PointerEvent) => {
    const press = pendingPress;
    pendingPress = null;
    if (!press) return;
    // 位移超过阈值算拖拽（框选 / 滚动），不当作点击
    if (
      Math.abs(event.clientX - press.clientX) > CLICK_MOVE_THRESHOLD ||
      Math.abs(event.clientY - press.clientY) > CLICK_MOVE_THRESHOLD
    ) {
      return;
    }
    // 抬起时不在同一格也不算（按住后在别的单元格松手）
    const table = deps.getTable();
    const host = deps.getContainer();
    if (table && host) {
      const rect = host.getBoundingClientRect();
      const at = table.getCellAtRelativePosition(event.clientX - rect.left, event.clientY - rect.top);
      if (at && (at.col !== press.col || at.row !== press.row)) return;
    }
    commitPress(press);
  };

  /** 惰性绑定容器 DOM 监听：控制器创建时表格还没建好，第一次按下才挂 */
  const bindCanvasEvents = () => {
    const host = deps.getContainer();
    if (!host || boundHost === host) return;
    unbindCanvasEvents();
    host.addEventListener('pointerdown', onHostPointerDown, true);
    host.addEventListener('pointerup', onCanvasPointerUp);
    boundHost = host;
  };

  const unbindCanvasEvents = () => {
    if (!boundHost) return;
    boundHost.removeEventListener('pointerdown', onHostPointerDown, true);
    boundHost.removeEventListener('pointerup', onCanvasPointerUp);
    boundHost = null;
  };

  const notePress = (col: number, row: number, clientX: number, clientY: number) => {
    const table = deps.getTable();
    const options = deps.getOptions();
    pendingPress = null;
    if (!table || !options) return;
    const headerLevel = headerLevelOf(table);
    // 只认展开列的数据行；统计行不参与
    if (col !== deps.getExpandCol()) return;
    if (row < headerLevel) return;
    if (deps.isSummaryRow(row, headerLevel)) return;
    const rowKey = deps.getRowKeys()[row - headerLevel] ?? '';
    if (!rowKey) return;
    bindCanvasEvents();
    pendingPress = { col, row, clientX, clientY };
  };

  // ─── 数据变化后的重建 ───

  const captureRows = () => {
    const table = deps.getTable();
    if (!table) {
      capturedRows = [];
      return;
    }
    const headerLevel = headerLevelOf(table);
    capturedRows = [];
    expanded.forEach((_entry, rowKey) => {
      const index = findRowIndex(rowKey);
      if (index >= 0) capturedRows.push({ rowKey, row: index + headerLevel });
    });
  };

  /**
   * setRecords 之后调用。行高 map 是按**行号**存的且不会被 setRecords 清掉
   * （compute-row-height.js:134：_heightResizedRowMap 里的行直接读旧高度），
   * 所以旧行号上撑开的高度必须显式还原，否则换一批数据后某些行会莫名其妙高一截。
   */
  const reapply = () => {
    const table = deps.getTable();
    if (!table) return;
    const headerLevel = headerLevelOf(table);
    // 1. 还原旧行号上的展开高度（此刻数据已换，旧行号指的是别的记录了）
    capturedRows.forEach(({ rowKey, row }) => {
      const entry = expanded.get(rowKey);
      if (entry) table.setRowHeight(row, entry.originalHeight);
    });
    capturedRows = [];
    // 2. 仍展开的行：按新行号撑高 + 覆盖层就位（行被筛掉时只撤覆盖层，展开态留着，
    //    数据回来了自动恢复 —— 与官方插件记 expandedRecordIndices 的做法一致）
    expanded.forEach((entry, rowKey) => {
      const index = findRowIndex(rowKey);
      if (index < 0) {
        unmountOverlay(rowKey);
        return;
      }
      const row = index + headerLevel;
      if (deps.isSummaryRow(row, headerLevel)) return;
      table.setRowHeight(row, entry.originalHeight + entry.detailHeight);
      mountOverlay(rowKey, row, entry);
    });
  };

  /**
   * 重算所有覆盖层位置，并**顺带自愈行高**。
   *
   * 自愈是必需的：`updateOption` / `resize` 会重建场景图，把展开行的行高打回原值
   * （实测：父组件用内联 columns 数组时每次渲染都会走一次 updateOption，行高随即归位 28）。
   * 这里发现高度不是「原行高 + 展开区」就补回来 —— 高度本就对的时候等于空转，
   * 所以滚动时每帧调用也不亏。
   */
  const positionAll = () => {
    const table = deps.getTable();
    if (!table) return;
    const headerLevel = headerLevelOf(table);
    expanded.forEach((entry, rowKey) => {
      const index = findRowIndex(rowKey);
      if (index < 0) return;
      const row = index + headerLevel;
      if (deps.isSummaryRow(row, headerLevel)) return;
      const expected = entry.originalHeight + entry.detailHeight;
      if (table.getRowHeight(row) !== expected) table.setRowHeight(row, expected);
      positionOverlay(rowKey, row, entry);
    });
  };

  const dispose = () => {
    capturedRows = [];
    pendingPress = null;
    unbindCanvasEvents();
    expanded.clear();
    overlays.forEach((overlay) => {
      overlay.wrapper.removeEventListener('wheel', overlay.onWheel);
      overlay.root.unmount();
      overlay.wrapper.remove();
    });
    overlays.clear();
    if (host) {
      host.remove();
      host = null;
    }
  };

  // ─── 展开按钮（customRender） ───

  /**
   * 画展开/收起按钮：圆角方块 + 折线箭头（收起向右、展开向下），禁用态整体置灰。
   *
   * 两个细节：
   * - **按钮按展开前的行高居中**，不是按单元格高。展开后行变成两百多像素高，
   *   按整格居中按钮会飘到行中间去；
   * - customRender 元素没有事件通道，点击统一由 click_cell 接（见 handleClick），
   *   所以这里只负责画。cursor 给了也没坏处 —— pickable 的图元 hover 时会生效。
   */
  const renderButton = (args: ExpandButtonArgs): ExpandButtonResult => {
    const table = args.table as ListTable;
    const headerLevel = headerLevelOf(table);
    const rowIndex = args.row - headerLevel;
    const rowKey = deps.getRowKeys()[rowIndex] ?? '';
    const isExpanded = expanded.has(rowKey);
    const entry = expanded.get(rowKey);
    const options = deps.getOptions();
    const info = buildInfo(rowKey, rowIndex, args.row);
    const enabled = options?.rowExpandable ? options.rowExpandable(info) : true;

    const cellWidth = args.rect?.width ?? EXPAND_COLUMN_WIDTH;
    const baseHeight = entry ? entry.originalHeight : (args.rect?.height ?? 28);
    const size = Math.min(BUTTON_SIZE, Math.max(12, baseHeight - 8));
    const x = (cellWidth - size) / 2;
    const y = (baseHeight - size) / 2;

    // 配色：可用 = 白底灰边深色箭头；展开中 = 淡蓝底蓝边（与选中行高亮同色系）；
    // 禁用 = 近乎看不见的灰底灰边，箭头淡到只剩形状
    const fill = !enabled ? '#fafafa' : isExpanded ? '#e6f4ff' : '#ffffff';
    const stroke = !enabled ? '#f0f0f0' : isExpanded ? '#91caff' : '#d9d9d9';
    const arrowColor = !enabled ? '#d9d9d9' : isExpanded ? '#1677ff' : '#595959';
    const cursor = enabled ? 'pointer' : 'default';

    const half = size * 0.16;
    const points = isExpanded
      ? [
          { x: x + size * 0.5 - half * 1.6, y: y + size * 0.36 },
          { x: x + size * 0.5, y: y + size * 0.64 },
          { x: x + size * 0.5 + half * 1.6, y: y + size * 0.36 },
        ]
      : [
          { x: x + size * 0.38, y: y + size * 0.5 - half * 1.6 },
          { x: x + size * 0.62, y: y + size * 0.5 },
          { x: x + size * 0.38, y: y + size * 0.5 + half * 1.6 },
        ];

    return {
      elements: [
        { type: 'rect', x, y, width: size, height: size, radius: 4, fill, stroke, cursor },
        { type: 'line', points, stroke: arrowColor, lineWidth: 1.5, cursor },
      ],
      // 期望高度必须小于行高，否则会把这行撑高（computeCustomRenderHeight 取它参与行高计算）
      expectedHeight: size,
      expectedWidth: size,
      renderDefault: false,
    };
  };

  return {
    renderButton,
    notePress,
    captureRows,
    reapply,
    positionAll,
    dispose,
    expand: (rowKey: string) => {
      const table = deps.getTable();
      if (!table) return;
      const index = findRowIndex(rowKey);
      if (index < 0) return;
      const row = index + headerLevelOf(table);
      const info = buildInfo(rowKey, index, row);
      const options = deps.getOptions();
      if (deps.isSummaryRow(row, headerLevelOf(table))) return;
      if (options?.rowExpandable && !options.rowExpandable(info)) return;
      if (expanded.has(rowKey)) return;
      expandRow(rowKey, row);
    },
    collapse: (rowKey: string) => {
      const table = deps.getTable();
      if (!table || !expanded.has(rowKey)) return;
      const index = findRowIndex(rowKey);
      collapseRow(rowKey, index >= 0 ? index + headerLevelOf(table) : -1);
    },
    collapseAll: () => {
      const table = deps.getTable();
      if (!table) return;
      const headerLevel = headerLevelOf(table);
      Array.from(expanded.keys()).forEach((rowKey) => {
        const index = findRowIndex(rowKey);
        collapseRow(rowKey, index >= 0 ? index + headerLevel : -1);
      });
    },
    isExpanded: (rowKey: string) => expanded.has(rowKey),
    getDetailHeight: (rowKey: string) => expanded.get(rowKey)?.detailHeight ?? 0,
    getExpandedRowKeys: () => Array.from(expanded.keys()),
  };
}

// ─── 展开列定义 ──────────────────────────────────────────────────────────────

/**
 * 生成展开列：插在行号列之后、业务列之前（这样它能跟行号一起被冻住，横向滚动时按钮不消失）。
 *
 * customRender 用双重断言挂上去：VTable 没从包根导出 ICustomRender 类型，
 * 且 RectElement 上没有 lineWidth 等字段，直接赋值过不了元素联合类型的检查。
 */
export function buildExpandColumn(
  renderButton: (args: ExpandButtonArgs) => ExpandButtonResult,
): ColumnsDefine[number] {
  const column = {
    field: EXPAND_COLUMN_FIELD,
    title: '',
    width: EXPAND_COLUMN_WIDTH,
    customRender: renderButton,
  };
  return column as unknown as ColumnsDefine[number];
}
