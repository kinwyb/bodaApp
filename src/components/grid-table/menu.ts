/** 右键菜单 / 表头下拉菜单：类型定义与配置 */

/**
 * 菜单项。
 * @visactor/vtable 未从包根导出 MenuListItem，这里按官方 ts-types/menu.d.ts 的 MenuListItem 声明，
 * 保证页面写 `menu.contextMenuItems` 时拿到的就是原生形态（直接透传，不做二次转换）。
 *
 * - 字符串：普通菜单项，文本与 menuKey 都等于该字符串
 * - `{ type: 'split' }`：分隔线（注意不是字符串 '-'，写 '-' 会渲染成一个文本项）
 * - `{ type: 'title' }`：分组标题
 * - `children`：二级子菜单
 *
 * 图标（`icon`）：`svg` 要传**完整的 `<svg>…</svg>` 字符串** ——
 * @visactor/vtable 是把它 innerHTML 进一个 span（见 `es/components/menu/dom/logic/MenuElement.js`
 * 的 createItem），只有当内容长得像 URL 时才会改用 `<img>` 加载。
 * 所以别传裸 `<path>`（HTML 解析下不会成为 SVG 元素，什么都不显示）。
 *
 * 想直接用 antd 图标的话不用手写 svg，用 `@/components/grid-table/menuIcon` 的 `toMenuIcon`：
 *
 * ```ts
 * const MENU_ICON_DELETE = toMenuIcon(<DeleteOutlined />);
 * // { text: '删除行', menuKey: 'deleteRow', icon: MENU_ICON_DELETE }
 * ```
 *
 * ⚠️ 图标是**单独占一列**的，所以同一份菜单里若有的项有图标、有的没有，没图标的项文字会顶到
 * 最左边（看起来错位）。用 `@/components/grid-table/menuIcon` 的 `alignMenuIcons(items)` 包一层即可，
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
export type GridTableMenuItem =
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
      children?: GridTableMenuItem[];
      disabled?: boolean;
    };

/** 生成菜单项时的上下文：页面据此决定这一格显示哪些菜单 */
export interface GridTableMenuContext {
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
  /** 是否树形分组的组行（右键到组行时用它区分「对一组操作」还是「对一条单据操作」） */
  isGroupRow: boolean;
}

/** 菜单项被点击时回传的信息 */
export interface GridTableMenuClickInfo extends GridTableMenuContext {
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
export interface GridTableMenuConfig {
  /**
   * 单元格右键菜单。
   * 传数组为固定菜单；传函数可按行列动态返回（返回空数组表示这一格不弹菜单）。
   */
  contextMenuItems?: GridTableMenuItem[] | ((ctx: GridTableMenuContext) => GridTableMenuItem[]);
  /** 表头下拉菜单（表头右侧的小三角）。不传则表头没有下拉菜单，与 @visactor/vtable 默认一致 */
  headerMenuItems?: GridTableMenuItem[] | ((ctx: GridTableMenuContext) => GridTableMenuItem[]);
  /** 渲染模式，默认 'html'（'canvas' 更轻，但对菜单外观的控制有限） */
  renderMode?: 'canvas' | 'html';
  /**
   * 是否只在单元格 / 表头上响应右键。
   * @visactor/vtable 内部只有 `contextMenuWorkOnlyCell === false` 时才额外绑定「画布空白处」的右键，
   * 所以不传（或传 true）时就只有单元格和表头能弹出菜单。
   */
  workOnlyCell?: boolean;
  /** 菜单项点击回调（右键菜单与表头下拉菜单共用） */
  onClick?: (info: GridTableMenuClickInfo) => void;
}
