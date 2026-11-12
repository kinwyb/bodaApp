import type {AppColumnDef} from '@/components/grid-table';

export const SALARY_GROUP_COLUMNS: AppColumnDef[] = [
    {field: 'RoomCode', title: '厂别', width: 110, sortable: true, filterType: 'enum'},
    {field: 'OpeCode', title: '员工编号', width: 110, sortable: true, filterType: 'text'},
    {field: 'OpeName', title: '员工姓名', width: 110, sortable: true, filterType: 'text'},
    {field: 'Pieces', title: '正品数', width: 100, dataType: 'int', sortable: true, filterType: 'number'},
    {field: 'Discards', title: '废品数', width: 100, dataType: 'double', sortable: true, filterType: 'number'},
    {field: 'CpQty', title: '次品数', width: 100, dataType: 'double', sortable: true, filterType: 'number'},
    {field: 'Salary', title: '计件工资', width: 120, dataType: 'double', precision: 4, sortable: true, filterType: 'number', aggregate: 'sum'},
];
