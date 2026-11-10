import type {YupaiOrder} from '@/api';
import type {AppColumnDef} from '@/components/grid-table';
import {formatDate} from '@/utils';

/**
 * `MCSize1..MCSize17` 的列头，按 `V0288.Designer.cs` 原样保留。
 *
 * `MCSize18` 在设计器里 `Visible = false`，标题标着「21/1904(无效)」，
 * 所以不显示该列，也不把无效机型的数量算进汇总。
 */
const COMPLETED_MACHINE_SIZE_HEADERS = [
    '12/960',
    '12/1056',
    '13/1152',
    '14/1248',
    '15/1344',
    '16/1440',
    '17/1536',
    '18/1632',
    '19/1728',
    '20/1824',
    '13/1296',
    '14/1392',
    '15/1488',
    '16/1584',
    '17/1680',
    '18/1766',
    '21/1904',
] as const;

const machineSizeColumns: AppColumnDef[] = COMPLETED_MACHINE_SIZE_HEADERS.map((title, index) => ({
    field: `MCSize${index + 1}`,
    title,
    width: 82,
    dataType: 'int',
    aggregate: 'sum',
}));

/**
 * V0189_V0279_V0288 已下单列表。
 *
 * 列顺序照旧客户端 `VisibleIndex`。两个字段名按实际 HTTP 契约修正：
 * `YWY` → `Ywy`、`ProductName` → `ProduceName`。
 */
export const YUPAI_COMPLETED_COLUMNS: AppColumnDef[] = [
    {field: 'WorkPlace', title: '产地', width: 120, filterType: 'enum'},
    {
        field: 'CompleteDate',
        title: '下单日期',
        width: 88,
        filterType: 'date',
        fieldFormat: (record: YupaiOrder) => formatDate(record.CompleteDate),
    },
    {field: 'YPDate', title: '预排日期', width: 100, dataType: 'date', filterType: 'date'},
    {field: 'Ywy', title: '业务员', width: 85, filterType: 'enum'},
    {field: 'OrderCode', title: '订单号', width: 110, filterType: 'enum'},
    {field: 'YPMonth', title: '出货月份', width: 100, group: true, sortable: 'asc'},
    {field: 'Qty', title: '总数量', width: 90, dataType: 'int', sortable: true, filterType: 'number'},
    {field: 'Number', title: '款式数量', width: 85, dataType: 'int', sortable: true, aggregate: 'sum'},
    {field: 'TotalNum', title: 'NC下单总数', width: 105, dataType: 'int'},
    {field: 'Num', title: 'NC下单款式数', width: 115, dataType: 'int'},
    {field: 'StyleCode', title: '款号', width: 110, filterType: 'text'},
    {field: 'ProduceName', title: '款式描述', width: 150, filterType: 'enum'},
    {field: 'HDWorkName', title: '后道主工序', width: 100, filterType: 'enum'},
    {field: 'JHDate', title: '计划下单期', width: 105, dataType: 'date', filterType: 'date'},
    {field: 'QRDate', title: '确认下单期', width: 105, dataType: 'date', filterType: 'date'},
    {field: 'WCDate', title: '尾查期', width: 100, dataType: 'date', filterType: 'date'},
    {field: 'ZHDate', title: '走货期', width: 100, dataType: 'date', filterType: 'date'},
    {field: 'XDRate', title: '下单把握率', width: 100, style: {textAlign: 'right'}, filterType: 'enum'},
    {field: 'Memo', title: '备注', width: 180},
    {field: 'YLDate', title: '原料可下单期', width: 115, dataType: 'date'},
    {field: 'FLDate', title: '辅料可下单期', width: 115, dataType: 'date'},
    {field: 'MWeight', title: '中码下机克重', width: 115, dataType: 'double'},
    {field: 'MCycle', title: '中码下机时间', width: 115, dataType: 'double'},
    {field: 'MSewWt', title: '缝制工时', width: 95, dataType: 'double'},
    ...machineSizeColumns,
    {field: 'CreateTime', title: '创建时间', width: 150, dataType: 'datetime'},
    {field: 'CreateUser', title: '创建人', width: 90, filterType: 'enum'},
    {field: 'UpdateTime', title: '最后修改时间', width: 150, dataType: 'datetime'},
    {field: 'UpdateUser', title: '最后修改人', width: 100, filterType: 'enum'},
];
