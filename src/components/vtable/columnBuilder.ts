import type { ColumnsDefine, TextColumnDefine, TYPES } from '@visactor/vtable';
import { formatDate, formatDateTime } from '@/utils';
import type { GroupAggregate, GroupAggregateType } from './group';

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
  /**
   * 合并单元格（只作用于表头以下，纵向）：VTable 原生语义。
   * - `true`：本列显示值相同就合并
   * - 回调：完全自定义判断
   *
   * **只做「是否合并」的简单判断**。要按「门槛列 + 顺序列」分组合并，用表格的 `mergeGroups`
   * 属性（见 ./mergeGroup.ts）——那条路预扫描建索引，不会让每格都重扫整列。
   */
  mergeCell?: TYPES.MergeCellOption;
  /**
   * 默认汇总方式（`sum` / `count` / `distinct` / `avg` / `max` / `min` / `first`）。
   *
   * 配了它就有两个效果，页面都不用自己写计算代码：
   * 1. **底部统计行**：没传 `<VTable summary>` 时，自动按这些列拼一行；
   * 2. **树形分组的组行**：`group.aggregates` 没传时，自动继承这些列。
   *
   * 显式配置优先：传了 `summary` 就用页面的那行，传了 `group.aggregates` 就只算那些字段。
   */
  aggregate?: GroupAggregateType;
  /** 透传给 VTable 的其它列配置（会覆盖上面的默认值，包括 fieldFormat / style / mergeCell） */
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
      // false 也是有效值（明确不合并），所以只跳过 undefined
      ...(def.mergeCell !== undefined ? { mergeCell: def.mergeCell } : {}),
      // 默认汇总方式：VTable 不认识这个字段，单纯挂在列定义上供组件读取，不会渲染出来
      ...(def.aggregate ? { aggregate: def.aggregate } : {}),
      // 兜底口子放最后：写在 columnProps 里的同名配置整体覆盖（不与默认值合并）
      ...(def.columnProps ?? {}),
    } as ColumnsDefine[number];
  }) as ColumnsDefine;
}

/**
 * 从列定义里收集「配了 `aggregate` 的列」，返回顺序与 columns 一致。
 *
 * 分组表头（列里再嵌套 columns）会递归进去；字符串形式的列（只给字段名）跳过。
 * 同一个字段配了多次只取第一次 —— 汇总结果写在同名字段上，重复配置没有意义。
 */
export function collectColumnAggregates(columns: ColumnsDefine): GroupAggregate[] {
  const result: GroupAggregate[] = [];
  const seen = new Set<string>();

  const walk = (cols: ColumnsDefine) => {
    for (const col of cols) {
      if (typeof col === 'string') continue;
      const cell = col as { columns?: ColumnsDefine; field?: unknown; aggregate?: unknown };
      if (cell.columns) {
        walk(cell.columns);
        continue;
      }
      if (typeof cell.field !== 'string' || !cell.aggregate) continue;
      if (seen.has(cell.field)) continue;
      seen.add(cell.field);
      result.push({ field: cell.field, type: cell.aggregate as GroupAggregateType });
    }
  };

  walk(columns);
  return result;
}

/**
 * 从列定义里推导「可以拿来分组」的列（给 FilterTable 的分组面板用）。
 *
 * 规则：递归展开分组表头，只取**有 `field` 的叶子列**；`title` 是函数就先调一次拿文本；
 * 同一个字段只保留第一次出现。顺序与 columns 一致，面板里就按这个顺序列出来。
 */
export function collectGroupableColumns(
  columns: ColumnsDefine,
): Array<{ field: string; title: string }> {
  const result: Array<{ field: string; title: string }> = [];
  const seen = new Set<string>();

  const walk = (cols: ColumnsDefine) => {
    for (const col of cols) {
      if (typeof col === 'string') {
        if (!seen.has(col)) {
          seen.add(col);
          result.push({ field: col, title: col });
        }
        continue;
      }
      const cell = col as { columns?: ColumnsDefine; field?: unknown; title?: unknown };
      if (cell.columns) {
        walk(cell.columns);
        continue;
      }
      if (typeof cell.field !== 'string' || seen.has(cell.field)) continue;
      seen.add(cell.field);
      const rawTitle = cell.title;
      const title =
        typeof rawTitle === 'function'
          ? String((rawTitle as () => string)())
          : String(rawTitle ?? cell.field);
      result.push({ field: cell.field, title });
    }
  };

  walk(columns);
  return result;
}
