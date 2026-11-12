import type {AppColumnDef} from '@/components/grid-table';

export function createProduceDataColumns(isVietnam: boolean): AppColumnDef[] {
    const columns: AppColumnDef[] = [
        {field: 'Status', title: '状态', width: 90, filterType: 'enum'},
        {field: 'RoomCode', title: '厂别', width: 80, filterType: 'enum'},
        {field: 'DateShiftStart', title: '数据日期', width: 105, dataType: 'date', filterType: 'date'},
        {field: 'ShiftName', title: '班次', width: 75, filterType: 'enum'},
        {field: 'MachCode', title: '机台号', width: 80, dataType: 'int', filterType: 'number'},
        {field: 'ShiftOpeCode', title: '排班挡车工号', width: 110, filterType: 'text'},
        {field: 'ShiftOpeName', title: '排班挡车名称', width: 110, filterType: 'text'},
        {field: 'Employee', title: '挡车工工号', width: 100, filterType: 'text'},
        {field: 'EmployeeName', title: '挡车工', width: 90, filterType: 'text'},
        {field: 'OrderCode', title: '订单号', width: 115, filterType: 'text'},
        {field: 'DispatchNo', title: '派工单号', width: 125, filterType: 'text'},
        {field: 'ProductName', title: '物料名称', width: 150, filterType: 'text'},
        {field: 'ProductNo', title: '物料编码', width: 110, filterType: 'text'},
        {field: 'Color', title: '颜色', width: 80, filterType: 'text'},
        {field: 'Size', title: '尺码', width: 65, filterType: 'enum'},
    ];

    if (isVietnam) {
        columns.push(
            {field: 'OutStoreBillCode', title: '出库单号', width: 125, filterType: 'text'},
            {field: 'BPJJScanTime', title: '白坯出库时间', width: 150, dataType: 'datetime', filterType: 'date'},
        );
    }

    columns.push(
        {
            field: 'CheckDown',
            title: isVietnam ? '是否入库' : '是否检验完成',
            width: 105,
            dataType: 'boolean',
            filterType: 'enum',
        },
        {field: 'CheckEmployeeNo', title: isVietnam ? '入库员工号' : '检验员工号', width: 110, filterType: 'text'},
        {field: 'CheckEmployee', title: isVietnam ? '入库员' : '检验员', width: 95, filterType: 'text'},
        {field: 'CheckDownTime', title: isVietnam ? '入库时间' : '检验完成时间', width: 150, dataType: 'datetime', filterType: 'date'},
    );

    if (isVietnam) {
        columns.push(
            {field: 'CMBEmployee', title: '踩毛边人员', width: 100, filterType: 'text'},
            {field: 'CMBScanTime', title: '踩毛边扫描时间', width: 150, dataType: 'datetime', filterType: 'date'},
        );
    }

    columns.push(
        {field: 'Qty', title: '挡车产量', width: 95, dataType: 'int', aggregate: 'sum', filterType: 'number'},
        {field: 'CheckQty', title: isVietnam ? '入库数量' : '检验数量', width: 95, dataType: 'int', aggregate: 'sum', filterType: 'number'},
        {field: 'DateShiftStart', title: '班次开始时间', width: 150, dataType: 'datetime', filterType: 'date'},
        {field: 'DateShiftEnd', title: '班次结束时间', width: 150, dataType: 'datetime', filterType: 'date'},
        {field: 'InputTime', title: '挡车提交时间', width: 150, dataType: 'datetime', filterType: 'date'},
    );

    if (isVietnam) {
        columns.push(
            {field: 'Barcode', title: '条码号', width: 150, filterType: 'text'},
        );
    }
    return columns;
}
