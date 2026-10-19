import type { ColumnsDefine, TextColumnDefine, TYPES } from '@visactor/vtable';
import { formatDate, formatDateTime } from '@/utils';

/** 列的数据类型：决定渲染成什么控件以及对齐/格式 */
export type ColumnDataType =
  | 'text' // 普通文本
  | 'number' // 数值，右对齐，可指定小数位
  | 'date' // 日期，只显示到日（YYYY-MM-DD）
  | 'datetime' // 日期时间，显示到秒（YYYY-MM-DD HH:mm:ss）
  | 'boolean' // 1 / 0，渲染成只读复选框
  | 'tag'; // 枚举，按值映射文案与颜色

export interface ColumnTagItem {
  label: string;
  /** 文字颜色，不传则沿用单元格默认文字色（随主题，与底色自然一致） */
  color?: string;
}

/**
 * tag 映射项：
 * - 字符串简写：只给文案，不指定颜色 —— `{ 1: '苹果' }`
 * - 对象写法：需要指定颜色时用 —— `{ 1: { label: '苹果', color: '#d85a30' } }`
 */
export type ColumnTagItemLike = string | ColumnTagItem;

/** 单元格显示值：函数形式自定义，或 `{ get, set }`（VTable 的 FieldFormat） */
export type AppColumnFieldFormat = NonNullable<TextColumnDefine['fieldFormat']>;

/**
 * 单元格样式：既可传对象，也可传按行取值的函数（VTable 的 ColumnStyle）。
 * 额外带上复选框样式（`checkboxStyle`），这样 boolean 列也能直接配。
 */
export type AppColumnStyle =
  | NonNullable<TextColumnDefine['style']>
  | TYPES.CheckboxStyleOption
  | ((args: TYPES.StylePropertyFunctionArg) => TYPES.ITextStyleOption | TYPES.CheckboxStyleOption);

export interface AppColumnDef {
  field: string;
  title: string;
  width?: number;
  /** 数据类型，默认 text */
  dataType?: ColumnDataType;
  /** number：小数位 */
  precision?: number;
  /** tag：值 -> 文案（字符串简写）或 {label, color}（要指定颜色时） */
  tagMap?: Record<string, ColumnTagItemLike>;
  /** boolean：勾选框右侧的文字（选中 / 未选中），不传则只显示勾选框 */
  booleanText?: [string, string];
  /** 是否可排序 */
  sortable?: boolean;
  /** 显示格式：传了就用它，覆盖 dataType 推导出的默认格式（如 date 的 formatDate） */
  fieldFormat?: AppColumnFieldFormat;
  /**
   * 单元格样式：对象或函数，**与 dataType 推导出的默认样式合并**而不是整份替换
   * （给 number 列传 `{ bgColor }` 不会丢掉右对齐），同名字段以这里为准。
   */
  style?: AppColumnStyle;
  /** 透传给 VTable 的其它列配置（会覆盖上面的默认值，包括 fieldFormat / style） */
  columnProps?: Record<string, unknown>;
}

/** 只读复选框的样式：看起来和普通勾选框一致，但用户点不动 */
const READONLY_CHECKBOX = {
  disableFill: '#ffffff',
  disableStroke: '#d9d9d9',
  disableCheckedFill: '#1677ff',
  disableCheckedStroke: '#1677ff',
};

type StyleResolver = (args: TYPES.StylePropertyFunctionArg) => TYPES.ITextStyleOption;

/** 把「对象 / 函数」两种写法统一成函数 */
function toStyleResolver(style: AppColumnStyle): StyleResolver {
  return typeof style === 'function'
    ? (args) => style(args) as TYPES.ITextStyleOption
    : () => style;
}

/**
 * 默认样式打底、自定义样式覆盖：
 * - 都是对象 -> 浅合并
 * - 有一边是函数 -> 包成函数，先算默认再叠自定义（tag 列的按值上色不会被一行 style 顶掉）
 */
function mergeStyle(base: AppColumnStyle | undefined, override: AppColumnStyle): AppColumnStyle {
  if (!base) return override;
  if (typeof base === 'object' && typeof override === 'object') {
    return { ...base, ...override };
  }
  const resolveBase = toStyleResolver(base);
  const resolveOverride = toStyleResolver(override);
  return (args) => ({ ...resolveBase(args), ...resolveOverride(args) });
}

/** 把带数据类型的列定义转成 VTable 的列配置 */
export function buildColumns(defs: AppColumnDef[]): ColumnsDefine {
  return defs.map((def) => {
    const base: Record<string, unknown> = {
      field: def.field,
      title: def.title,
      ...(def.width ? { width: def.width } : {}),
      ...(def.sortable ? { sort: true } : {}),
    };

    // dataType 推导出的默认格式/样式，最后与 def.fieldFormat / def.style 合并
    let typeFieldFormat: AppColumnFieldFormat | undefined;
    let typeStyle: AppColumnStyle | undefined;

    switch (def.dataType ?? 'text') {
      case 'number':
        typeStyle = { textAlign: 'right' };
        if (def.precision !== undefined) {
          typeFieldFormat = (record: Record<string, unknown>) => {
            const value = Number(record[def.field]);
            return Number.isFinite(value) ? value.toFixed(def.precision) : '';
          };
        }
        break;

      case 'date':
        typeFieldFormat = (record: Record<string, unknown>) => formatDate(record[def.field]);
        break;

      case 'datetime':
        typeFieldFormat = (record: Record<string, unknown>) => formatDateTime(record[def.field]);
        break;

      case 'boolean': {
        const labels = def.booleanText;
        base.cellType = 'checkbox';
        base.checked = (args: { dataValue?: unknown }) => Number(args.dataValue) === 1;
        // 展示用：禁用交互，避免用户误以为能改
        base.disable = () => true;
        // 可以根据内容配置不同样式
        // typeStyle = (args: { dataValue?: unknown }) => ({
        //   textAlign: 'center' as const,
        //   bgColor: Number(args.dataValue) ? '#f6ffed' : '#ffffff',
        //   checkboxStyle: { ...READONLY_CHECKBOX },
        // });
        typeStyle = () => ({
          textAlign: 'center' as const,
          bgColor: '#ffffff',
          checkboxStyle: { ...READONLY_CHECKBOX },
        });
        // 必须返回布尔值，否则复选框旁边会跟出原始值（0 / 1）
        typeFieldFormat = (record: Record<string, unknown>) => {
          const checked = Number(record[def.field]) === 1;
          return labels ? { checked, disable: true, text: checked ? labels[0] : labels[1] } : checked;
        };
        break;
      }

      case 'tag': {
        const map = def.tagMap ?? {};
        // 字符串简写等价于「只有文案、不指定颜色」
        const itemOf = (value: unknown): ColumnTagItem | undefined => {
          const raw = map[String(value ?? '')];
          if (raw === undefined || raw === null) return undefined;
          return typeof raw === 'string' ? { label: raw } : raw;
        };
        typeFieldFormat = (record: Record<string, unknown>) => {
          const value = String(record[def.field] ?? '');
          return itemOf(value)?.label ?? value;
        };
        // 没配颜色的项不返回 color，文字沿用默认色（与底色一致，跟随主题）
        typeStyle = (args: { dataValue?: unknown }) => {
          const color = itemOf(args.dataValue)?.color;
          return color ? { color } : {};
        };
        break;
      }

      default:
        break;
    }

    const fieldFormat = def.fieldFormat ?? typeFieldFormat;
    const style = def.style ? mergeStyle(typeStyle, def.style) : typeStyle;

    return {
      ...base,
      ...(fieldFormat ? { fieldFormat } : {}),
      ...(style ? { style } : {}),
      // 兜底口子放最后：写在 columnProps 里的同名配置整体覆盖（不与默认值合并）
      ...(def.columnProps ?? {}),
    } as ColumnsDefine[number];
  }) as ColumnsDefine;
}
