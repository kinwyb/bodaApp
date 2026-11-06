/**
 * 工艺路线矩阵的列定义。
 *
 * 放在 `.ts` 里而不是 `.tsx` 里：
 * - `.tsx` 只导出组件（导出普通值会打断 Fast Refresh 边界，见 `@/components/grid-table` 的说明）；
 * - 界面桥要**同一份列定义**（agent 认识一张表全靠它），视图与桥各写一份必然漂移。
 *
 * 与包装 BOM 矩阵的区别：这里**没有随数据变的列**（那三张表的配色/配码列是按颜色、尺码
 * 动态铺出来的），所以列是常量，不必写成函数。
 *
 * 发布情况表（`pushRules`）不在这里：它整张复用 `components/nc/matrixPushView`，
 * 列定义跟着那个组件走（两套矩阵只有版本列不同，由 props 给）。
 */

import type {AppColumnDef} from '@/components/grid-table';
import {ProcessMoveTypeLabel} from './common.ts';

/**
 * 工序明细：一行一道工序，是这份矩阵的主数据（也是唯一可编辑的一张表）。
 *
 * 行标识是 `ProcessRouteMatrixDetailID`。列序按「先认工序、再看属性、最后是数值与审计」
 * 排：左边几列用来认行，右边一堆数值用来横向比较。
 */
export const PROCESS_ITEM_COLUMNS: AppColumnDef[] = [
    {field: 'VRowNo', title: '行号', width: 70, style: {textAlign: 'center'}},
    {field: 'CrcCode', title: '工序编码', minWidth: 120},
    {field: 'CrcName', title: '工序名称', minWidth: 120},
    {field: 'MainProcess', title: '主工序', dataType: 'boolean', width: 80},
    {field: 'CraftNote', title: '操作要求', minWidth: 150},
    /*
     * 审核三列只读：审核是后端流程，界面上给个入口让人勾一下、结果什么都不发生，
     * 比只读更误导（同 PushView 里「是否发布」的处理）。
     */
    {
        field: 'VDef5',
        title: '审核',
        dataType: 'boolean',
        width: 90,
    },
    {field: 'VDef6', title: '审核人', minWidth: 90},
    {field: 'VDef7', title: '审核时间', dataType: 'datetime', minWidth: 150},
    {field: 'MixDeliverNum', title: '浮余系数', dataType: 'double', minWidth: 90},
    {field: 'VDef12', title: '小时工资', dataType: 'double', minWidth: 90},
    {field: 'VDef9', title: '标准时间', dataType: 'double', minWidth: 90, precision: 4},
    {field: 'VDef11', title: '工序工价', dataType: 'double', minWidth: 90, precision: 4},
    {field: 'WorkTime', title: 'BM时间', dataType: 'double', minWidth: 90},
    {field: 'AllowAdd', title: '允许添加', dataType: 'boolean', width: 90},
    {
        field: 'ProcessMoveType',
        title: '转移方式',
        minWidth: 100,
        fieldFormat: (record: Record<string, unknown>) => ProcessMoveTypeLabel(record.ProcessMoveType),
    },
    {field: 'OutProcess', title: '委外', dataType: 'boolean', width: 70},
    {field: 'CheckPoint', title: '检测点', dataType: 'boolean', width: 80},
    {field: 'CountPoint', title: '报告点', dataType: 'boolean', width: 80},
    {field: 'EffectDate', title: '生效日期', dataType: 'date', minWidth: 110},
    {field: 'InvalidDate', title: '失效日期', dataType: 'date', minWidth: 110},
];
