/**
 * V0372 织造明细弹窗（旧客户端 `Views/Dialog/V0372/ZZDetailForm.cs`）的列定义。
 * 数据来自存储过程 `Query_BJZZMachineTypeData`，列顺序照 Designer 的 VisibleIndex：
 * 开始日期 → 结束日期 → 机型 → 机器数量 → 机台工时 → 织造产量 → 织造次品数量 →
 * 织造次品率 → 产出工时 → 产出效率 → 机台利用率。
 * 汇总：数量/工时求和，次品率/效率/利用率取平均（旧客户端 SummaryItem，格式 {0:0.##}）。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import {buildSummaryFromColumns, trimmedDoubleFormat} from '../../productionShared';

/** 存储过程返回的一行（字段名与过程结果列一致） */
export type ZZMonthDetailRow = {
    WorkStartDate: string;
    WorkEndDate: string;
    MC_SIZE: string;
    MachineCount: number;
    MachineHours: number;
    ZZTotalNum: number;
    ZZCPNum: number;
    CPRate: number;
    WorkHours: number;
    Efficiency: number;
    UtilizationRate: number;
    /** 界面主键：过程结果没有自然主键，按行序生成 */
    _rowKey: string;
};

export const ZZ_MONTH_DETAIL_COLUMNS: AppColumnDef[] = [
    {field: 'WorkStartDate', title: '开始日期', width: 110, dataType: 'date', filterType: 'date'},
    {field: 'WorkEndDate', title: '结束日期', width: 110, dataType: 'date', filterType: 'date'},
    {field: 'MC_SIZE', title: '机型', width: 90, filterType: 'text'},
    {field: 'MachineCount', title: '机器数量', width: 100, dataType: 'int', aggregate: 'sum', filterType: 'number'},
    {field: 'MachineHours', title: '机台工时', width: 100, dataType: 'double', aggregate: 'sum', filterType: 'number', fieldFormat: trimmedDoubleFormat('MachineHours')},
    {field: 'ZZTotalNum', title: '织造产量', width: 100, dataType: 'double', aggregate: 'sum', filterType: 'number', fieldFormat: trimmedDoubleFormat('ZZTotalNum')},
    {field: 'ZZCPNum', title: '织造次品数量', width: 110, dataType: 'int', aggregate: 'sum', filterType: 'number'},
    {field: 'CPRate', title: '织造次品率', width: 100, dataType: 'double', aggregate: 'avg', filterType: 'number', fieldFormat: trimmedDoubleFormat('CPRate')},
    {field: 'WorkHours', title: '产出工时', width: 100, dataType: 'double', aggregate: 'sum', filterType: 'number', fieldFormat: trimmedDoubleFormat('WorkHours')},
    {field: 'Efficiency', title: '产出效率', width: 100, dataType: 'double', aggregate: 'avg', filterType: 'number', fieldFormat: trimmedDoubleFormat('Efficiency')},
    {field: 'UtilizationRate', title: '机台利用率', width: 110, dataType: 'double', aggregate: 'avg', filterType: 'number', fieldFormat: trimmedDoubleFormat('UtilizationRate')},
];

/** 统计行：次品率/效率/利用率取平均且忽略缺值（旧客户端 SummaryItem 口径） */
export const ZZ_MONTH_DETAIL_SUMMARY = buildSummaryFromColumns(ZZ_MONTH_DETAIL_COLUMNS);
