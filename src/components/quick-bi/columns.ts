/**
 * QuickBI 共用层的列定义。
 *
 * 主表与明细表的列都由存储过程动态返回（C# `SQLResult.DataTable()` 按 ColumnTypes 推断），
 * 所以这里不是常量列表，而是「SQLResult → AppColumnDef[]」的生成器 —— 页面与界面桥共用同一份。
 *
 * 与 C# 逐项对应：
 * - 主表：`业务单元` / `指标` 之外的列右对齐（buildDataTable 里 HAlignment.Far）；
 *   int / double 列加合计（SummaryItemType.Sum）；这两列纵向合并（MergeExt(unClickColumn)）。
 * - 明细：所有列右对齐；double 显示 N 格式（两位小数）；列名以「日期」结尾的只显示日期部分
 *   （Detail_CustomColumnDisplayText 去掉 00:00:00）；再叠 detailProfile 的强化
 *   （doubleFields / sumFields / percentFields，对应 detailColumnType / sumColumn / P2 格式）。
 */
import type {SQLResult} from '@/api';
import type {AppColumnDef, MergeGroupConfig} from '@/components/grid-table';
import {isBlank, toNumberOrZero} from '@/utils';
import type {KpiRecord, QuickBIDetailProfile} from './types';

/** 行主键：存储过程没有稳定主键，用行下标派生（与 V0372 同法） */
export const KPI_ROW_KEY = '_rowKey';

/** 不可点击（不触发明细）的两列，也是主表的合并列（C# unClickColumn，六页都未重写） */
export const UNCLICK_COLUMNS: readonly string[] = ['业务单元', '指标'];

/** 主表合并：业务单元 → 指标 层级，对应 C# dataView1.MergeExt(unClickColumn) */
export const MAIN_MERGE_GROUPS: MergeGroupConfig = {mergeColumnSort: ['业务单元', '指标']};

/** 主表列：按后端声明的列类型挑 dataType；数值列自动合计（aggregate: 'sum'） */
export function buildMainColumns(result: SQLResult): AppColumnDef[] {
    return result.Headers.map((field): AppColumnDef => {
        if (UNCLICK_COLUMNS.includes(field)) {
            return {field, title: field, minWidth: 110, filterType: 'text'};
        }
        const base = {field, title: field, minWidth: 80};
        const type = result.getColumnType(field);
        if (type === 'INT') {
            return {...base, dataType: 'int', aggregate: 'sum', filterType: 'number'};
        }
        if (type === 'DECIMAL' || type === 'FLOAT' || type === 'DOUBLE') {
            return {...base, dataType: 'double', aggregate: 'sum', filterType: 'number'};
        }
        if (type === 'DATE' || type === 'DATETIME') {
            return {...base, dataType: 'date', style: {textAlign: 'right'}};
        }
        // STRING 列也可能是「95.5%」这类数值文本：原样显示，只右对齐
        return {...base, style: {textAlign: 'right'}};
    });
}

/**
 * 明细列：全部右对齐；double 两位小数（C# "N"）；「日期」结尾列只留日期；再叠指标档案。
 * mode='text' 对应 C# 重写 detailColumnType 的页面：未列名的列一律原样文本，不按 SQL 类型推断。
 */
export function buildDetailColumns(
    result: SQLResult,
    profile?: QuickBIDetailProfile,
    mode: 'sql' | 'text' = 'sql',
): AppColumnDef[] {
    return result.Headers.map((field): AppColumnDef => {
        const base = {field, title: field, minWidth: 80, style: {textAlign: 'right' as const}};
        const aggregate = profile?.sumFields?.includes(field) ? 'sum' as const : undefined;
        // 百分比列（C# DisplayFormat "P2"）：原值是小数比率，×100 保留两位小数
        if (profile?.percentFields?.includes(field)) {
            return {
                ...base,
                fieldFormat: (record: KpiRecord) => {
                    const value = record[field];
                    return isBlank(value) ? '' : `${(toNumberOrZero(value) * 100).toFixed(2)}%`;
                },
                aggregate,
            };
        }
        if (profile?.doubleFields?.includes(field)) {
            return {...base, dataType: 'double', aggregate};
        }
        if (field.endsWith('日期')) {
            return {...base, dataType: 'date'};
        }
        if (mode === 'text') {
            return {...base, aggregate};
        }
        const type = result.getColumnType(field);
        if (type === 'INT') {
            return {...base, dataType: 'int', aggregate};
        }
        if (type === 'DECIMAL' || type === 'FLOAT' || type === 'DOUBLE') {
            return {...base, dataType: 'double', aggregate};
        }
        if (type === 'DATE' || type === 'DATETIME') {
            return {...base, dataType: 'date'};
        }
        return {...base, aggregate};
    });
}

/** 指标档案 → 明细合并配置（C# mergeExt(gridView) 按 detailMergeColumnSort 层级合并） */
export function detailMergeGroups(profile?: QuickBIDetailProfile): MergeGroupConfig | undefined {
    const sort = profile?.mergeColumnSort;
    if (!sort || sort.length === 0) return undefined;
    return {mergeColumnSort: sort};
}

/** SQLResult → 表格 records：按列类型转值（toDataTable），补行主键 */
export function resultRecords(result: SQLResult): KpiRecord[] {
    const table = result.toDataTable();
    return table.rows.map((vals, index) => {
        const record: KpiRecord = {[KPI_ROW_KEY]: String(index)};
        table.columns.forEach((column, i) => {
            record[column.columnName] = vals[i];
        });
        return record;
    });
}
