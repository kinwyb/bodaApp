import type {AppColumnDef} from '@/components/grid-table';

export const OUT_STORE_BILL_COLUMNS: AppColumnDef[] = [
    {field: 'BillCode', title: '单据号', width: 150, filterType: 'text'},
    {field: 'BillDate', title: '单据日期', width: 110, dataType: 'date', filterType: 'date'},
    {field: 'CreateUser', title: '制单人', width: 100, filterType: 'text'},
    {field: 'CreateTime', title: '制单时间', width: 150, dataType: 'datetime'},
];

export const OUT_STORE_DETAIL_COLUMNS: AppColumnDef[] = [
    {field: 'OrderCode', title: '订单号', width: 115, filterType: 'text'},
    {field: 'ProductCode', title: '物料号', width: 110, filterType: 'text'},
    {field: 'ProductName', title: '物料名称', width: 150, filterType: 'text'},
    {field: 'Color', title: '颜色', width: 90, filterType: 'text'},
    {field: 'Size', title: '尺码', width: 70, filterType: 'enum'},
    {field: 'DispatchNo', title: '派工单号', width: 125, filterType: 'text'},
    {field: 'DataShiftStart', title: '班次时间', width: 150, filterType: 'text'},
    {field: 'MachCode', title: '机台号', width: 90, dataType: 'int', filterType: 'number'},
    {field: 'Qty', title: '数量', width: 90, dataType: 'int', aggregate: 'sum', filterType: 'number'},
];
