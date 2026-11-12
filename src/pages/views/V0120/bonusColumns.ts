import type {AppColumnDef} from '@/components/grid-table';

export const BONUS_SUMMARY_COLUMNS: AppColumnDef[] = [
    {field: 'Month', title: '月份', width: 100, sortable: true, filterType: 'text'},
    {field: 'EmployeeNo', title: '员工号', width: 100, sortable: true, filterType: 'text'},
    {field: 'Employee', title: '员工', width: 100, sortable: true, filterType: 'text'},
    {field: 'Bonus', title: '奖金', width: 110, dataType: 'double', sortable: true, filterType: 'number', aggregate: 'sum'},
];

export const BONUS_DETAIL_COLUMNS: AppColumnDef[] = [
    {field: 'WorkDate', title: '日期', width: 110, dataType: 'date', sortable: true, filterType: 'date'},
    {field: 'EmployeeNo', title: '员工号', width: 100, sortable: true, filterType: 'text'},
    {field: 'Employee', title: '员工', width: 100, sortable: true, filterType: 'text'},
    {field: 'Qty', title: '产量', width: 90, dataType: 'int', sortable: true, filterType: 'number', aggregate: 'sum'},
    {field: 'Bonus', title: '奖金', width: 110, dataType: 'double', sortable: true, filterType: 'number', aggregate: 'sum'},
];
