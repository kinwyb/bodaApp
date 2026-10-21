import {type AppColumnDef, buildColumns} from "@/components/grid-table/columnBuilder.ts";
import type {ColumnsDefine} from "@visactor/vtable";

/**
 * 列定义：dataType 决定渲染控件（text / int / double / date / boolean / tag），
 * filterType 决定这一列进不进筛选面板（不配 = 不参与筛选）。
 */
const COLUMNS: AppColumnDef[] = [
    {field: 'WorkMonth', title: '生产月份', width: 100, group: true, sortable: true},
    {field: 'WorkPlace', title: '产地', width: 100, filterType: 'enum'},
    {field: 'TpName', title: '订单类型', width: 70},
    {field: 'OrderPrefix', title: '客户', width: 100},
    {field: 'OrderCode', title: '订单号', width: 110, filterType: 'enum'},
    {field: 'POCount', title: '批次数', width: 100, dataType: 'int'},
    {field: 'StyleCode', title: '款号', width: 110, filterType: 'enum'},
    {field: 'ProductName', title: '款式名称', width: 150, filterType: 'enum'},
    {field: 'SewGroup', title: '缝制大类', width: 100},
    {field: 'StyleQty', title: '款式数量', width: 80, dataType: 'int', aggregate: 'sum'},
    {field: 'KnitSumWt', title: '织造总工时(h)', width: 80, dataType: 'double', aggregate: 'sum'},
    {field: 'DyeSumWg', title: '染色总重量(kg)', width: 80, dataType: 'double', aggregate: 'sum'},
    {field: 'SewSumWt', title: '缝制总工时(h)', width: 80, dataType: 'double', aggregate: 'sum'},
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
