import {type AppColumnDef, buildColumns} from "@/components/vtable/columnBuilder.ts";
import type {ColumnsDefine} from "@visactor/vtable";
import type {FilterField} from "@/components/vtable";

/** 可筛选的列：类型决定筛选控件（enum 多选 / date、number 区间 / text 包含） */
export const yupaiOrderChangeListFilterFields: FilterField[] = [
    {field: 'WorkPlace', title: '产地', type: 'enum'},
    {field: 'OrderCode', title: '订单号', type: 'enum'},
    {field: 'StyleCode', title: '款号', type: 'enum'},
    {field: 'ProductName', title: '款式描述', type: 'enum'},
    {field: 'ActionName', title: '事件', type: 'enum'},
    {field: 'ChangeFieldName', title: '修改字段', type: 'enum'},
];

/** 列定义：dataType 决定渲染控件（text / number / date / boolean / tag） */
const COLUMNS: AppColumnDef[] = [
    {field: 'WorkPlace', title: '产地', width: 90},
    {field: 'ChangeDate', title: '修改日期', width: 100, dataType: 'date', sortable: true},
    {field: 'OrderCode', title: '订单号', width: 110, sortable: true},
    {field: 'StyleCode', title: '款号', width: 110},
    {field: 'ProductName', title: '款式描述', width: 150},
    {field: 'Number', title: '款式数量', width: 80, dataType: 'number', sortable: true},
    {field: 'QRDate', title: '确认日期', width: 100, dataType: 'date'},
    {field: 'ZHDate', title: '走货日期', width: 100, dataType: 'date'},
    {field: 'ActionName', title: '事件', width: 100},
    {field: 'ChangeFieldName', title: '修改字段', width: 100},
    {field: 'OldValue', title: '修改前', width: 170},
    {field: 'NewValue', title: '修改后', width: 170},
    {field: 'ChangeTime', title: '修改时间', width: 140, dataType: 'datetime'},
    {field: 'ChangeEmployee', title: '修改人', width: 120},
];

export function buildYupaiOrderChangeListColumns(): ColumnsDefine {
    return buildColumns(COLUMNS);
}
