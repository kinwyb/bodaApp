/**
 * 单元格样式的「语义化层」：页面写的字段名（`textColor` / `backgroundColor`…）在这里
 * 翻译成 @visactor/vtable 的原生样式名（`color` / `bgColor`…）。**不含任何运行时代码依赖**，
 * 可以脱离 React 与 DOM 单独验证。
 *
 * 为什么要这层：原生 `cellStyle` 的返回值是 `Record<string, unknown>`，用户得自己记住
 * 「字体颜色叫 color、背景色叫 bgColor」，**而且写错了不报错、只是样式静默不生效**
 * （与 `rowKey` 漏传同类问题）。语义化之后，字段名对齐 CSS 直觉，写错就是编译错误。
 */
import type { IStyleOption } from '../../../node_modules/@visactor/vtable/es/ts-types/column/style';
import type { ListTable } from '@visactor/vtable';

/**
 * 页面自定义单元格样式（语义化写法）。
 *
 * 键名刻意对齐 CSS 直觉，不用记 @visactor/vtable 的原生样式名。**只写要改的属性**，
 * 其余沿用列配置与主题。返回空对象 / 全 undefined 等同于「不改」（翻译层会给出 undefined），
 * 别为了「这一格没变更」另造一份完整配色 —— 那会把列上配好的样式一并盖掉。
 */
export interface GridTableCellStyle {
  /** 文字颜色，如 '#cf1322' */
  textColor?: string;
  /** 背景颜色，如 '#fff2f0' */
  backgroundColor?: string;
  /** 文字加粗；显式传 false 可取消加粗（恢复常规字重） */
  bold?: boolean;
  /** 文字斜体 */
  italic?: boolean;
  /** 字号（px） */
  fontSize?: number;
  /** 字体族 */
  fontFamily?: string;
  /** 水平对齐 */
  align?: 'left' | 'center' | 'right';
  /** 垂直对齐 */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** 下划线 */
  underline?: boolean;
  /** 删除线 */
  strikeThrough?: boolean;
  /** 单元格内边距：数字四边相同，数组按「上右下左」 */
  padding?: number | number[];
  /** 行高（px） */
  lineHeight?: number;
  /** 鼠标移入该格时的光标样式 */
  cursor?: string;
  /** 边框颜色，数组按「上右下左」 */
  borderColor?: string | string[];
  /** 边框线宽，数组按「上右下左」 */
  borderWidth?: number | number[];
  /**
   * 逃生舱：直接写 @visactor/vtable 原生样式名（`textStick` / `marked` / `linkColor` 这类
   * 语义化字段没覆盖到的），与上面同义时以这里为准。
   *
   * 用它等于绕过类型检查 —— 写错键名依旧静默失效，且合并顺序上它是最后一道，
   * 调试时看到的效果未必来自你以为的那个字段。
   */
  native?: Record<string, unknown>;
}

/**
 * 语义化样式 -> @visactor/vtable 原生样式；无有效字段时返回 undefined。
 *
 * **样式不生效时先看这张映射**：textColor→color、backgroundColor→bgColor、
 * bold→fontWeight、align→textAlign、verticalAlign→textBaseline、
 * strikeThrough→lineThrough、borderWidth→borderLineWidth
 * （其余同名：fontSize / fontFamily / padding / lineHeight / cursor / borderColor）。
 */
export function toDataTableCellStyle(style: GridTableCellStyle): Record<string, unknown> | undefined {
  // 核心字段先落进镜像类型：键名与值类型在这一步就受 @visactor/vtable 契约约束
  // （镜像与真实 IStyleOption 的绑定见文件末尾的断言）。
  // native 是逃生舱，跳过这份检查、最后覆盖上去。
  const result: GridTableCellNativeStyle = {};
  if (style.textColor !== undefined) result.color = style.textColor;
  if (style.backgroundColor !== undefined) result.bgColor = style.backgroundColor;
  if (style.bold !== undefined) result.fontWeight = style.bold ? 'bold' : 'normal';
  if (style.italic !== undefined) result.fontStyle = style.italic ? 'italic' : 'normal';
  if (style.fontSize !== undefined) result.fontSize = style.fontSize;
  if (style.fontFamily !== undefined) result.fontFamily = style.fontFamily;
  if (style.align !== undefined) result.textAlign = style.align;
  if (style.verticalAlign !== undefined) result.textBaseline = style.verticalAlign;
  if (style.underline !== undefined) result.underline = style.underline;
  if (style.strikeThrough !== undefined) result.lineThrough = style.strikeThrough;
  if (style.padding !== undefined) result.padding = style.padding;
  if (style.lineHeight !== undefined) result.lineHeight = style.lineHeight;
  if (style.cursor !== undefined) result.cursor = style.cursor;
  if (style.borderColor !== undefined) result.borderColor = style.borderColor;
  if (style.borderWidth !== undefined) result.borderLineWidth = style.borderWidth;
  const merged = { ...result, ...style.native };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * @visactor/vtable 原生单元格样式的镜像类型（`IStyleOption` 的子集）。
 *
 * 为什么要手写一份：`IStyleOption` 没有从 @visactor/vtable 包根导出（package.json 的 exports
 * 只放开了 `.` 和 `./gantt-extensions`，深路径 import 会被拦），项目里 `StyleArgs`
 * 也是同样的处理方式。手写镜像的风险是「抄错一个字母就静默失效」，所以下面用断言把它钉住。
 */
interface GridTableCellNativeStyle {
  color?: string;
  bgColor?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  textBaseline?: 'top' | 'middle' | 'bottom';
  underline?: boolean;
  lineThrough?: boolean;
  padding?: number | number[];
  lineHeight?: number;
  cursor?: string;
  borderColor?: string | string[];
  borderLineWidth?: number | number[];
}

/** 断言辅助：`Expect<false>` 不满足 `T extends true` 约束，编译即失败 */
type Expect<T extends true> = T;

/** 镜像里存在、但 `IStyleOption` 不认识的键 —— 「抄错一个字母」就栽在这里 */
type KeysNotInNative = Exclude<keyof GridTableCellNativeStyle, keyof IStyleOption>;

/** 两者同名的键（值类型只在这个交集上比对，键存在性由上面负责） */
type SharedKeys = Extract<keyof GridTableCellNativeStyle, keyof IStyleOption>;

/**
 * 值类型不兼容的键：原生在这些键上收的是联合类型（如 `color` 还允许传函数、`padding` 还允许
 * 数组），镜像声明得比原生**更宽**时就会落到这里。方向是「镜像必须能赋给原生」——
 * 镜像写窄一点（少支持几种形态）是允许的，写宽了才是错。
 */
type ValueMismatchKeys = {
  [K in SharedKeys]: GridTableCellNativeStyle[K] extends IStyleOption[K] ? never : K;
}[SharedKeys];

/**
 * 契约：镜像的键必须是 `IStyleOption` 的真子集，且同名键的值类型兼容。
 * 报错 = 上面的字段名或值类型与当前 @visactor/vtable 版本对不上。
 *
 * 刻意不用 `GridTableCellNativeStyle extends IStyleOption` 一句了事：TS 是结构化类型，
 * 多出来的**可选**属性不影响赋值兼容，`bgcolor` 这种拼错的键能照样通过，等于没防住。
 * 升级 `@visactor/vtable` 后如果这里报错，先去看 @visactor/vtable 的 `es/ts-types/column/style.d.ts`
 * 是不是改了样式属性名，把镜像同步过来即可。
 */
export type NativeStyleMatchesDataTable = Expect<
  [KeysNotInNative, ValueMismatchKeys] extends [never, never] ? true : false
>;

// ─── 回调类型与 customCellStyle 插件访问 ──────────────────────────────────────

/** 自定义单元格样式的回调参数 */
export interface GridTableCellStyleInfo {
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
  /** 是否树形分组的组行（组行没有业务主键，只有 children 与汇总字段） */
  isGroupRow: boolean;
  /** 该行原始记录 */
  record?: Record<string, unknown>;
  /** 该单元格原始值 */
  dataValue?: unknown;
}

/**
 * 页面自定义单元格样式：返回的样式会合并到内置样式之上，
 * 适合「最近变更标绿」「超期标红」这类业务提醒。
 *
 * 只写要改的属性（语义化名，见 GridTableCellStyle）；**返回 undefined 或空对象都表示「不改」** ——
 * 累加式写法直接 `return style` 即可，不必再判 `Object.keys(style).length`：
 * 翻译层会把空对象变成 undefined，组件那边自然回退到原有样式。
 */
export type GridTableCellStyleHook = (info: GridTableCellStyleInfo) => GridTableCellStyle | undefined;

/**
 * 单元格悬停提示：返回文案就在该单元格上显示 tooltip，返回 undefined 不显示。
 *
 * 与 `cellStyle` 是配套的 —— `cellStyle` 负责「把格子标红」，它负责「告诉用户为什么红」，
 * 专治「只看到红底、看不到原因」：校验不通过时把服务层给的提示文案返回即可。
 *
 * 入参与 `cellStyle` 完全一致（同一个 GridTableCellStyleInfo），照抄 cellStyle 里那套
 * 行主键判断即可。实现上是在 `mouseenter_cell` 时调 @visactor/vtable 的 `table.showTooltip`；
 * 鼠标移出、滚动、选中别的格子时 @visactor/vtable 自己会收起，页面不用管。
 *
 * 文案是**纯文本**（@visactor/vtable 用 textContent 写入，不解析 HTML）。太长会自动折行，
 * 但有字数上限（`maxWidth`），别把整段说明塞进来 —— 一句话说清「哪里不对」即可。
 *
 * 提示配色是固定的「错误红白」（与编辑器里的校验提示条同色，`#fff2f0` / `#cf1322`），
 * 所以这个能力目前是给**校验错误**用的。将来若要别的语义（提醒、警告）再加配置。
 */
export type GridTableCellTooltipHook = (info: GridTableCellStyleInfo) => string | undefined;

/**
 * customCellStyle 插件的类型没有从包根导出，这里只声明实际用到的两个方法。
 * 该插件由 BaseTable 无条件创建（`options.customCellStyle` 默认是 `[]`），所以表建好后一定拿得到。
 *
 * 组件内部（选中行整行铺底色）与选择模块都要用它，所以从本文件导出。
 */
export interface CustomCellStylePluginLike {
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

/** 取表格实例上的 customCellStyle 插件（拿不到就返回 undefined，调用方自行兜底） */
export function getStylePlugin(table: ListTable): CustomCellStylePluginLike | undefined {
  return (table as unknown as { customCellStylePlugin?: CustomCellStylePluginLike })
    .customCellStylePlugin;
}
