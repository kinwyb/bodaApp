import type { ColumnsDefine } from '@visactor/vtable';

/** 列的数据类型：决定渲染成什么控件以及对齐/格式 */
export type ColumnDataType =
  | 'text' // 普通文本
  | 'number' // 数值，右对齐，可指定小数位
  | 'date' // 日期，空日期（0001-01-01）显示为空
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
  /** 透传给 VTable 的其它列配置（会覆盖上面的默认值） */
  columnProps?: Record<string, unknown>;
}

/** 后端用 0001-01-01 表示空日期 */
const cleanDate = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return text.startsWith('0001-01-01') ? '' : text;
};

/** 只读复选框的样式：看起来和普通勾选框一致，但用户点不动 */
const READONLY_CHECKBOX = {
  disableFill: '#ffffff',
  disableStroke: '#d9d9d9',
  disableCheckedFill: '#1677ff',
  disableCheckedStroke: '#1677ff',
};

/** 把带数据类型的列定义转成 VTable 的列配置 */
export function buildColumns(defs: AppColumnDef[]): ColumnsDefine {
  return defs.map((def) => {
    const base: Record<string, unknown> = {
      field: def.field,
      title: def.title,
      ...(def.width ? { width: def.width } : {}),
      ...(def.sortable ? { sort: true } : {}),
    };

    switch (def.dataType ?? 'text') {
      case 'number':
        base.style = { textAlign: 'right' };
        if (def.precision !== undefined) {
          base.fieldFormat = (record: Record<string, unknown>) => {
            const value = Number(record[def.field]);
            return Number.isFinite(value) ? value.toFixed(def.precision) : '';
          };
        }
        break;

      case 'date':
        base.fieldFormat = (record: Record<string, unknown>) => cleanDate(record[def.field]);
        break;

      case 'boolean': {
        const labels = def.booleanText;
        base.cellType = 'checkbox';
        base.checked = (args: { dataValue?: unknown }) => Number(args.dataValue) === 1;
        // 展示用：禁用交互，避免用户误以为能改
        base.disable = () => true;
        // 可以根据内容配置不同样式
        // base.style = (args: { dataValue?: unknown }) => ({
        //   textAlign: 'center' as const,
        //   bgColor: Number(args.dataValue) ? '#f6ffed' : '#ffffff',
        //   checkboxStyle: { ...READONLY_CHECKBOX },
        // });
        base.style = () => ({
          textAlign: 'center' as const,
          bgColor: '#ffffff',
          checkboxStyle: { ...READONLY_CHECKBOX },
        });
        // 必须返回布尔值，否则复选框旁边会跟出原始值（0 / 1）
        base.fieldFormat = (record: Record<string, unknown>) => {
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
        base.fieldFormat = (record: Record<string, unknown>) => {
          const value = String(record[def.field] ?? '');
          return itemOf(value)?.label ?? value;
        };
        // 没配颜色的项不返回 color，文字沿用默认色（与底色一致，跟随主题）
        base.style = (args: { dataValue?: unknown }) => {
          const color = itemOf(args.dataValue)?.color;
          return color ? { color } : {};
        };
        break;
      }

      default:
        break;
    }

    return { ...base, ...(def.columnProps ?? {}) } as ColumnsDefine[number];
  }) as ColumnsDefine;
}
