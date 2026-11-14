/**
 * V0326 织造明细弹窗（旧客户端 `Views/Dialog/V0326/ZZDetailForm.cs`）的列定义。
 * 列顺序照 Designer 的 VisibleIndex：机型 → 织造总数 → 机器工时 → 产出工时 → 机台效率 → 机台利用率。
 * 汇总：数量/工时求和，效率/利用率取平均（旧客户端 SummaryItem）。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import {buildSummaryFromColumns, trimmedDoubleFormat} from '../../productionShared';

/** 弹窗行：按机型（ExtendVal1）透视 SQL 长表得到 */
export type ZZDetailRow = {
    MSize: string;
    /** 隐藏主键（值 = 机型），避免统计行把 __summary__ 写进可见的 MSize 列 */
    _rowKey: string;
    MZZZTotalNum?: number;
    MZWorkHours?: number;
    MZMachineHours?: number;
    MZUtilizationRate?: number;
    MZEfficiency?: number;
};

/** SQL 长表里属于这张弹窗的指标字段（其余字段忽略，与旧客户端一致） */
export const ZZ_DETAIL_FIELDS: ReadonlyArray<keyof Omit<ZZDetailRow, 'MSize' | '_rowKey'>> = [
    'MZZZTotalNum',
    'MZWorkHours',
    'MZMachineHours',
    'MZUtilizationRate',
    'MZEfficiency',
];

export const ZZ_DETAIL_COLUMNS: AppColumnDef[] = [
    {field: 'MSize', title: '机型', width: 90, filterType: 'text'},
    {field: 'MZZZTotalNum', title: '织造总数', width: 110, dataType: 'double', aggregate: 'sum', filterType: 'number', fieldFormat: trimmedDoubleFormat('MZZZTotalNum')},
    {field: 'MZMachineHours', title: '机器工时', width: 110, dataType: 'double', aggregate: 'sum', filterType: 'number', fieldFormat: trimmedDoubleFormat('MZMachineHours')},
    {field: 'MZWorkHours', title: '产出工时', width: 110, dataType: 'double', aggregate: 'sum', filterType: 'number', fieldFormat: trimmedDoubleFormat('MZWorkHours')},
    {field: 'MZEfficiency', title: '机台效率', width: 110, dataType: 'double', aggregate: 'avg', filterType: 'number', fieldFormat: trimmedDoubleFormat('MZEfficiency')},
    {field: 'MZUtilizationRate', title: '机台利用率', width: 110, dataType: 'double', aggregate: 'avg', filterType: 'number', fieldFormat: trimmedDoubleFormat('MZUtilizationRate')},
];

/** 统计行：效率/利用率取平均且忽略缺值（旧客户端 SummaryItem 口径） */
export const ZZ_DETAIL_SUMMARY = buildSummaryFromColumns(ZZ_DETAIL_COLUMNS);
