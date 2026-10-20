import {type AppColumnDef, buildColumns} from "@/components/vtable/columnBuilder.ts";
import type {ColumnsDefine} from "@visactor/vtable";
import type {FilterField} from "@/components/vtable";

/** 可筛选的列：类型决定筛选控件（enum 多选 / date、number 区间 / text 包含） */
export const yupaiOrderAllGroupFilterFields: FilterField[] = [
    {field: 'WorkPlace', title: '产地', type: 'enum'},
    {field: 'OrderCode', title: '订单号', type: 'enum'},
    {field: 'StyleCode', title: '款号', type: 'enum'},
    {field: 'ProductName', title: '款式描述', type: 'enum'},
    {field: 'ActionName', title: '事件', type: 'enum'},
    {field: 'ChangeFieldName', title: '修改字段', type: 'enum'},
];

/** 列定义：dataType 决定渲染控件（text / number / date / boolean / tag） */
const COLUMNS: AppColumnDef[] = [
    {field: 'WorkMonth', title: '生产月份', width: 100, group: true, sortable: true},
    {field: 'WorkPlace', title: '产地', width: 100},
    {field: 'TpName', title: '订单类型', width: 70},
    {field: 'OrderPrefix', title: '客户', width: 100},
    {field: 'OrderCode', title: '订单号', width: 110},
    {field: 'POCount', title: '批次数', width: 100, dataType: 'number'},
    {field: 'StyleCode', title: '款号', width: 110},
    {field: 'ProductName', title: '款式名称', width: 150},
    {field: 'SewGroup', title: '缝制大类', width: 100},
    {field: 'StyleQty', title: '款式数量', width: 80, dataType: 'number', aggregate: 'sum'},
    {field: 'KnitSumWt', title: '织造总工时(h)', width: 80, dataType: 'number', aggregate: 'sum'},
    {field: 'DyeSumWg', title: '染色总重量(kg)', width: 80, dataType: 'number', aggregate: 'sum'},
    {field: 'SewSumWt', title: '缝制总工时(h)', width: 80, dataType: 'number', aggregate: 'sum'},
    {field: 'Ywz', title: '业务组', width: 100},
    {field: 'Ywy', title: '业务员', width: 100},
    {field: 'YPDate', title: '预排日期', width: 100, dataType: 'date'},
    {field: 'JHDate', title: '计划下单期', width: 100, dataType: 'date'},
    {field: 'QRDate', title: '确认下单期', width: 100, dataType: 'date'},
    {field: 'CompleteDate', title: '实际下单期', width: 100, dataType: 'date'},
    {field: 'ZHDate', title: '走货期', width: 100, dataType: 'date'},
    {field: 'ZHMonth', title: '走货月份', width: 100},
    {field: 'WorkDate', title: '生产期', width: 100, dataType: 'date'},
];

export function buildYupaiOrderAllGroupColumns(): ColumnsDefine {
    return buildColumns(COLUMNS);
}
