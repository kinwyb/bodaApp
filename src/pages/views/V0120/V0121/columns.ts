import type {AppColumnDef} from '@/components/grid-table';

const CENTER = {textAlign: 'center'} as const;
const BLUE = {textAlign: 'center', color: '#1677ff'} as const;
const RED = {textAlign: 'center', color: '#cf1322'} as const;

export const ORDER_INFO_COLUMNS: AppColumnDef[] = [
    {field: 'DateRec', title: '记录时间', width: 131, minWidth: 131, dataType: 'datetime', sortable: true, filterType: 'date', style: CENTER},
    {field: 'RoomCode', title: '厂别', width: 80, minWidth: 80, sortable: true, filterType: 'enum', style: CENTER},
    {field: 'GroupCode', title: '车间', width: 68, minWidth: 68, sortable: true, filterType: 'enum', style: CENTER},
    {field: 'MachCode', title: '机台号', width: 80, minWidth: 80, dataType: 'int', sortable: 'asc', filterType: 'number', style: BLUE},
    {field: 'ShiftName', title: '班次', width: 80, minWidth: 80, sortable: true, filterType: 'enum', style: CENTER},
    {field: 'GroupCode2', title: '班组', width: 80, minWidth: 80, sortable: true, filterType: 'enum', style: CENTER},
    {field: 'OpeCode', title: '员工编号', width: 90, minWidth: 90, sortable: true, filterType: 'text', style: CENTER},
    {field: 'OpeName', title: '员工名称', width: 90, minWidth: 90, sortable: true, filterType: 'text', style: CENTER},
    {field: 'StLot', title: '派工单号', width: 145, minWidth: 145, sortable: true, filterType: 'text', style: CENTER},
    {field: 'OrderCode', title: '订单号', width: 103, minWidth: 103, sortable: true, filterType: 'text', style: CENTER},
    {field: 'OrderDescription', title: '订单信息', width: 223, minWidth: 223, sortable: true, filterType: 'text', style: CENTER},
    {field: 'StyleCode', title: '款号', width: 92, minWidth: 92, sortable: true, filterType: 'text', style: CENTER},
    {field: 'StColor', title: '颜色', width: 82, minWidth: 82, sortable: true, filterType: 'text', style: CENTER},
    {field: 'StSize', title: '尺码', width: 70, minWidth: 70, sortable: true, filterType: 'text', style: CENTER},
    {field: 'Cycle', title: '下机时间', width: 88, minWidth: 88, dataType: 'double', sortable: true, filterType: 'number', style: CENTER},
    {field: 'CycleTime', title: '标准下机时间', width: 80, minWidth: 80, dataType: 'double', sortable: true, filterType: 'number', style: CENTER},
    {field: 'OrderTarget', title: '计划数', width: 68, minWidth: 68, dataType: 'int', sortable: true, filterType: 'number', style: BLUE},
    {field: 'Pieces', title: '正品数量', width: 62, minWidth: 62, dataType: 'int', sortable: true, filterType: 'number', style: CENTER},
    {field: 'Discards', title: '废品数', width: 56, minWidth: 56, dataType: 'int', sortable: true, filterType: 'number', style: RED},
    {field: 'DateStartShift', title: '开始时间', width: 144, minWidth: 144, dataType: 'datetime', sortable: true, filterType: 'date', style: CENTER},
    {field: 'Reason', title: '原因', width: 66, minWidth: 66, dataType: 'int', sortable: true, filterType: 'number', style: CENTER},
    {field: 'FlagString', title: '是否审核', width: 76, minWidth: 76, sortable: true, filterType: 'enum', style: RED},
    {field: 'ChkBy', title: '审核人', width: 80, minWidth: 80, sortable: true, filterType: 'text', style: CENTER},
    {field: 'ChkDate', title: '审核日期', width: 126, minWidth: 126, dataType: 'datetime', sortable: true, filterType: 'date', style: CENTER},
];
