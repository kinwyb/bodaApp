import {type AppColumnDef, buildColumns} from "@/components/grid-table/columnBuilder.ts";
import type {ColumnsDefine} from "@visactor/vtable";

/**
 * 列定义：dataType 决定渲染控件（text / int / double / date / boolean / tag），
 * filterType 决定这一列进不进筛选面板（不配 = 不参与筛选）。
 */
const COLUMNS: AppColumnDef[] = [
    {field: 'WorkPlace', title: '产地', width: 90, filterType: 'enum'},
    {field: 'ChangeDate', title: '修改日期', width: 100, dataType: 'date', sortable: true},
    {field: 'OrderCode', title: '订单号', width: 110, sortable: true, filterType: 'enum'},
    {field: 'StyleCode', title: '款号', width: 110, filterType: 'enum'},
    {field: 'ProductName', title: '款式描述', width: 150, filterType: 'enum'},
    {field: 'Number', title: '款式数量', width: 80, dataType: 'int', sortable: true},
    {field: 'QRDate', title: '确认日期', width: 100, dataType: 'date'},
    {field: 'ZHDate', title: '走货日期', width: 100, dataType: 'date'},
    {field: 'ActionName', title: '事件', width: 100, filterType: 'enum'},
    {field: 'ChangeFieldName', title: '修改字段', width: 100, filterType: 'enum'},
    {field: 'OldValue', title: '修改前', width: 170},
    {field: 'NewValue', title: '修改后', width: 170},
    {field: 'ChangeTime', title: '修改时间', width: 140, dataType: 'datetime'},
    {field: 'ChangeEmployee', title: '修改人', width: 120},
];

export function buildYupaiOrderChangeListColumns(): ColumnsDefine {
    return buildColumns(COLUMNS);
}
