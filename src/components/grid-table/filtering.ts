/**
 * 筛选条件（`FilterModel`）的判定与执行。
 *
 * 为什么单独成文件：过滤这件事有三处需要**同一份口径** ——
 *
 * 1. FilterTable 内部（面板改完条件后过滤 records）；
 * 2. 页面自己算「用户现在看到的是哪些行」（受控 `filters` 时，渲染期就要用）；
 * 3. 界面桥 / 命令拼快照（只能给可见数据，给全量会答非所问）。
 *
 * 三处各写一套，迟早会在「空条件算不算筛选」「日期按字符串还是按时间比」这类细节上分叉。
 *
 * 工具函数走子路径导入（模块入口只导出组件，见 `index.ts` 顶部说明）：
 * ```ts
 * import { filterRecords } from '@/components/grid-table/filtering';
 * ```
 */
import type {ColumnsDefine} from '@visactor/vtable';
import type {FilterCondition, FilterField, FilterModel} from './TableFilter';
import {type AppColumnDef, collectFilterFields} from './columnBuilder';

/**
 * 条件是否为空 —— 「这个字段实际上没在筛」。
 *
 * 空 = 没有任何选中值、没有区间上下限、没有关键字。
 * 面板拿它决定要不要显示条件标签，过滤时拿它跳过这个字段。
 * **两处必须是同一个判定**，否则会出现「标签上写着筛了、数据却没变」。
 */
export function isEmptyFilterCondition(condition?: FilterCondition): boolean {
    if (!condition) return true;
    const noValues = !condition.values?.length;
    const noMin = condition.min === undefined || condition.min === '';
    const noMax = condition.max === undefined || condition.max === '';
    const noText = !condition.text;
    return noValues && noMin && noMax && noText;
}

/**
 * 按筛选条件过滤 records，返回「用户看到的那批行」。
 *
 * - `fields` 决定每个字段怎么比：`enum` 精确匹配、`text` 包含、`date` / `number` 区间；
 *   不在 `fields` 里的字段（列上没配 `filterType`）条件被忽略。
 * - 字段之间是「且」，同字段内的条件按上面的类型各自判定。
 * - **不改入参**：没有生效条件时原样返回同一个数组引用，页面的 `useMemo` 依赖才稳。
 * - 日期按 `YYYY-MM-DD` 字符串比较（与列上显示 / 面板回填的格式一致）。
 */
export function filterRecords(
    records: Array<Record<string, unknown>>,
    filters: FilterModel,
    fields: FilterField[],
): Array<Record<string, unknown>> {
    const activeFilters = Object.entries(filters).filter(([, condition]) => !isEmptyFilterCondition(condition));
    if (activeFilters.length === 0 || fields.length === 0) return records;

    const fieldMap = new Map(fields.map((field) => [field.field, field.type]));
    return records.filter((record) =>
        activeFilters.every(([field, condition]) => {
            const type = fieldMap.get(field);
            const value = record[field];
            if (type === 'enum') {
                if (!condition.values?.length) return true;
                return condition.values.includes(String(value));
            }
            if (type === 'text') {
                if (!condition.text) return true;
                return value != null && String(value).toLowerCase().includes(condition.text.toLowerCase());
            }
            // 没配 filterType 的字段、以及认识不了的类型：条件不参与过滤
            if (type !== 'date' && type !== 'number') return true;
            if (condition.min !== undefined && value != null) {
                if (type === 'date') {
                    if (String(value) < String(condition.min)) return false;
                } else if (Number(value) < Number(condition.min)) return false;
            }
            if (condition.max !== undefined && value != null) {
                if (type === 'date') {
                    if (String(value) > String(condition.max)) return false;
                } else if (Number(value) > Number(condition.max)) return false;
            }
            return true;
        }),
    );
}

/**
 * 同上，但直接吃列定义 —— 页面手上通常只有 `columns`，没有 `FilterField[]`。
 * 筛选字段（列上的 `filterType`）由 `collectFilterFields` 现场收集，两种列写法都认。
 */
export function filterRecordsByColumns(
    records: Array<Record<string, unknown>>,
    filters: FilterModel,
    columns: ColumnsDefine | AppColumnDef[],
): Array<Record<string, unknown>> {
    return filterRecords(records, filters, collectFilterFields(columns));
}
