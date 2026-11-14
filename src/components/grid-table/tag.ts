/**
 * tag 列的值解析与配色。
 *
 * 这里只做纯数据变换，不依赖 VTable / DOM，方便单测；
 * 真正的图元布局在 ./tagLayout.ts。
 */

export interface ColumnTagItem {
  label: string;
  /** 文字颜色，不传则沿用单元格默认文字色 */
  color?: string;
  /** 标签底色，不传则按文字色自动生成浅色底 */
  bgColor?: string;
  /** 标签边框色，不传则按文字色自动生成浅色边框 */
  borderColor?: string;
}

/**
 * tag 映射项：
 * - 字符串简写：只给文案，不指定颜色 —— `{ 1: '苹果' }`
 * - 对象写法：需要指定颜色时用 —— `{ 1: { label: '苹果', color: '#d85a30' } }`
 */
export type ColumnTagItemLike = string | ColumnTagItem;

const DEFAULT_BACKGROUND = '#fafafa';
const DEFAULT_BORDER = '#d9d9d9';
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 按英文 / 中文逗号拆分；trim 后丢弃空段。数组值会先摊平再逐段拆。 */
export function splitTagValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitTagValue(item));
  return String(value ?? '')
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeTagItem(raw: ColumnTagItemLike | null | undefined): ColumnTagItem | undefined {
  if (raw === undefined || raw === null) return undefined;
  return typeof raw === 'string' ? { label: raw } : raw;
}

/** 把原始值拆成多个标签项；未命中 tagMap 的段原样显示，不丢值。 */
export function resolveTagItems(
  value: unknown,
  map: Record<string, ColumnTagItemLike>,
): ColumnTagItem[] {
  return splitTagValue(value).map((token) => {
    const item = normalizeTagItem(map[token]);
    const label = item?.label.trim() ? item.label : token;
    return item ? { ...item, label } : { label };
  });
}

/** 展示 / 复制 / 导出用的文本：多个标签用英文逗号连接。 */
export function formatTagValue(value: unknown, map: Record<string, ColumnTagItemLike>): string {
  return resolveTagItems(value, map)
    .map((item) => item.label)
    .join(',');
}

function withAlpha(color: string, alpha: number): string | undefined {
  const match = HEX_COLOR.exec(color.trim());
  if (!match) return undefined;
  let hex = match[0].slice(1);
  if (hex.length === 3) hex = hex.split('').map((char) => char + char).join('');
  const value = Number.parseInt(hex, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export interface TagPalette {
  text: string;
  background: string;
  border: string;
}

/** 显式 bgColor / borderColor 优先；否则从文字色派生浅色底与边框。 */
export function resolveTagPalette(item: ColumnTagItem, fallbackText: string): TagPalette {
  const text = item.color ?? fallbackText;
  return {
    text,
    background: item.bgColor ?? withAlpha(text, 0.08) ?? DEFAULT_BACKGROUND,
    border: item.borderColor ?? withAlpha(text, 0.35) ?? DEFAULT_BORDER,
  };
}
