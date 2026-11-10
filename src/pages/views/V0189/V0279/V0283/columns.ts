import type {YupaiOrder} from '@/api';
import type {AppColumnDef} from '@/components/grid-table';
import {formatDateTime} from '@/utils';

/**
 * 旧客户端 `MCSize1..MCSize17` 的列头，按 `V0283.Designer.cs` 原样保留。
 *
 * `MCSize18` 在设计器里 `Visible = false`，标题还标着「21/1904(无效)」，
 * 所以这里既不显示该列，也不把它放进表格列定义。
 */
const CANCEL_MACHINE_SIZE_HEADERS = [
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

const machineSizeColumns: AppColumnDef[] = CANCEL_MACHINE_SIZE_HEADERS.map((title, index) => {
    const field = `MCSize${index + 1}`;
    return {
        field,
        title,
        width: 82,
        dataType: 'int',
        fieldFormat: (record: YupaiOrder) => {
            const value = record[field];
            if (value === null || value === undefined || value === '') return '';
            return Number(value) > 0 ? value : '';
        },
    };
});

/**
 * V0189_V0279_V0283 预排取消列表。
 *
 * 列顺序照旧客户端 `VisibleIndex`。两处字段名按实际接口修正：
 * - 旧设计器写的是 `YWY`，HTTP 返回与现有预订单 DTO 都是 `Ywy`；
 * - 旧设计器写的是 `ProductName`，HTTP 返回字段是 `ProduceName`。
 */
export const YUPAI_CANCELLED_COLUMNS: AppColumnDef[] = [
    {field: 'WorkPlace', title: '产地', width: 90, filterType: 'enum'},
    {
        field: 'DelTime',
        title: '取消时间',
        width: 150,
        filterType: 'date',
        fieldFormat: (record: YupaiOrder) => formatDateTime(record.DelTime),
    },
    {field: 'YPDate', title: '预排日期', width: 100, dataType: 'date', sortable: true, filterType: 'date'},
    {field: 'Ywy', title: '业务员', width: 85, filterType: 'enum'},
    {field: 'OrderCode', title: '订单号', width: 110, filterType: 'text'},
    {field: 'Qty', title: '总数量', width: 90, dataType: 'int', sortable: true, filterType: 'number'},
    {field: 'Number', title: '款式数量', width: 85, dataType: 'int', sortable: true},
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
    ...machineSizeColumns,
    {field: 'DelUser', title: '取消人', width: 90, filterType: 'enum'},
];
