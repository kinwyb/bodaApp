/**
 * 单元格样式的「语义化层」：页面写的字段名（`textColor` / `backgroundColor`…）在这里
 * 翻译成 VTable 的原生样式名（`color` / `bgColor`…）。**不含任何运行时代码依赖**，
 * 可以脱离 React 与 DOM 单独验证。
 *
 * 为什么要这层：原生 `cellStyle` 的返回值是 `Record<string, unknown>`，用户得自己记住
 * 「字体颜色叫 color、背景色叫 bgColor」，**而且写错了不报错、只是样式静默不生效**
 * （与 `rowKey` 漏传同类问题）。语义化之后，字段名对齐 CSS 直觉，写错就是编译错误。
 */
import type { IStyleOption } from '../../node_modules/@visactor/vtable/es/ts-types/column/style';

/**
 * 页面自定义单元格样式（语义化写法）。
 *
 * 键名刻意对齐 CSS 直觉，不用记 VTable 的原生样式名。**只写要改的属性**，
 * 其余沿用列配置与主题。返回空对象 / 全 undefined 等同于「不改」（翻译层会给出 undefined），
 * 别为了「这一格没变更」另造一份完整配色 —— 那会把列上配好的样式一并盖掉。
 */
export interface VTableCellStyle {
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
   * 逃生舱：直接写 VTable 原生样式名（`textStick` / `marked` / `linkColor` 这类
   * 语义化字段没覆盖到的），与上面同义时以这里为准。
   *
   * 用它等于绕过类型检查 —— 写错键名依旧静默失效，且合并顺序上它是最后一道，
   * 调试时看到的效果未必来自你以为的那个字段。
   */
  native?: Record<string, unknown>;
}

/**
 * 语义化样式 -> VTable 原生样式；无有效字段时返回 undefined。
 *
 * **样式不生效时先看这张映射**：textColor→color、backgroundColor→bgColor、
 * bold→fontWeight、align→textAlign、verticalAlign→textBaseline、
 * strikeThrough→lineThrough、borderWidth→borderLineWidth
 * （其余同名：fontSize / fontFamily / padding / lineHeight / cursor / borderColor）。
 */
export function toVTableCellStyle(style: VTableCellStyle): Record<string, unknown> | undefined {
  // 核心字段先落进镜像类型：键名与值类型在这一步就受 VTable 契约约束
  // （镜像与真实 IStyleOption 的绑定见文件末尾的断言）。
  // native 是逃生舱，跳过这份检查、最后覆盖上去。
  const result: VTableCellNativeStyle = {};
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
 * VTable 原生单元格样式的镜像类型（`IStyleOption` 的子集）。
 *
 * 为什么要手写一份：`IStyleOption` 没有从 VTable 包根导出（package.json 的 exports
 * 只放开了 `.` 和 `./gantt-extensions`，深路径 import 会被拦），项目里 `StyleArgs`
 * 也是同样的处理方式。手写镜像的风险是「抄错一个字母就静默失效」，所以下面用断言把它钉住。
 */
interface VTableCellNativeStyle {
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
type KeysNotInNative = Exclude<keyof VTableCellNativeStyle, keyof IStyleOption>;

/** 两者同名的键（值类型只在这个交集上比对，键存在性由上面负责） */
type SharedKeys = Extract<keyof VTableCellNativeStyle, keyof IStyleOption>;

/**
 * 值类型不兼容的键：原生在这些键上收的是联合类型（如 `color` 还允许传函数、`padding` 还允许
 * 数组），镜像声明得比原生**更宽**时就会落到这里。方向是「镜像必须能赋给原生」——
 * 镜像写窄一点（少支持几种形态）是允许的，写宽了才是错。
 */
type ValueMismatchKeys = {
  [K in SharedKeys]: VTableCellNativeStyle[K] extends IStyleOption[K] ? never : K;
}[SharedKeys];

/**
 * 契约：镜像的键必须是 `IStyleOption` 的真子集，且同名键的值类型兼容。
 * 报错 = 上面的字段名或值类型与当前 VTable 版本对不上。
 *
 * 刻意不用 `VTableCellNativeStyle extends IStyleOption` 一句了事：TS 是结构化类型，
 * 多出来的**可选**属性不影响赋值兼容，`bgcolor` 这种拼错的键能照样通过，等于没防住。
 * 升级 `@visactor/vtable` 后如果这里报错，先去看 VTable 的 `es/ts-types/column/style.d.ts`
 * 是不是改了样式属性名，把镜像同步过来即可。
 */
export type NativeStyleMatchesVTable = Expect<
  [KeysNotInNative, ValueMismatchKeys] extends [never, never] ? true : false
>;
