import type {AppColumnDef} from '@/components/grid-table';

const CENTER = {textAlign: 'center'} as const;
const BLUE = {color: '#1677ff', textAlign: 'center'} as const;

export const SCHEDULE_COLUMNS: AppColumnDef[] = [
    {field: 'OpeCode', title: '挡车工编号', width: 100, filterType: 'text', style: CENTER},
    {field: 'OpeName', title: '挡车工名称', width: 100, filterType: 'text', style: CENTER},
    {field: 'PlantCode', title: '厂别', width: 76, filterType: 'enum', style: CENTER},
    {field: 'OpeCode4', title: '机修工编号', width: 92, filterType: 'text', style: CENTER},
    {field: 'OpeName4', title: '机修工名称', width: 92, filterType: 'text', style: CENTER},
    {field: 'GroupCode', title: '班组', width: 76, filterType: 'enum', style: CENTER},
    {field: 'MachineID', title: '机台号', width: 72, dataType: 'int', sortable: true, filterType: 'number', style: BLUE},
    {field: 'Shift', title: '班次', width: 76, filterType: 'enum', style: CENTER},
    {field: 'OpeCode2', title: '踩毛边工编号', width: 100, filterType: 'text', style: CENTER},
    {field: 'OpeName2', title: '踩毛边工名称', width: 100, filterType: 'text', style: CENTER},
    {field: 'OpeCode3', title: '毛坯全检工编号', width: 108, filterType: 'text', style: CENTER},
    {field: 'OpeName3', title: '毛坯全检工名称', width: 108, filterType: 'text', style: CENTER},
    {field: 'StartTime', title: '开始日期', width: 127, dataType: 'date', filterType: 'date', style: CENTER},
    {field: 'EndTime', title: '结束日期', width: 127, dataType: 'date', filterType: 'date', style: CENTER},
    {field: 'RecordBy', title: '操作人', width: 84, filterType: 'text', style: CENTER},
    {field: 'RecordDate', title: '最后更新时间', width: 127, dataType: 'datetime', filterType: 'date', style: CENTER},
];
