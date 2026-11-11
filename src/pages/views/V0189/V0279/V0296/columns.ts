import type {AppColumnDef} from '@/components/grid-table';

/**
 * 已下单分期列定义。
 *
 * 顺序照旧客户端 V0296.Designer.cs 的 VisibleIndex；`Batch`、`ZHMonth`
 * 与旧模型一样是界面派生字段，接口只返回 BatchNum / BatchCount / ZHDate。
 */
export const DELIVER_PLAN_COLUMNS: AppColumnDef[] = [
    {field: 'WorkPlace', title: '产地', width: 90, sortable: true, filterType: 'enum'},
    {field: 'Ywy', title: '业务员', width: 90, sortable: true, filterType: 'enum'},
    {field: 'YPDate', title: '预排日期', width: 105, dataType: 'date', sortable: true, filterType: 'date'},
    {field: 'OrderCode', title: '订单号', width: 120, sortable: true, filterType: 'text'},
    {field: 'Batch', title: '批次', width: 90, sortable: true, filterType: 'text'},
    {field: 'JHDate', title: '预计下单期', width: 110, dataType: 'date', sortable: true, filterType: 'date'},
    {
        field: 'CompleteDate',
        title: '实际下单期',
        width: 110,
        dataType: 'date',
        sortable: true,
        filterType: 'date',
    },
    {field: 'ZHDate', title: '预计走货期', width: 110, dataType: 'date', sortable: true, filterType: 'date'},
    {field: 'Qty', title: '数量', width: 90, dataType: 'int', sortable: true, filterType: 'number', aggregate: 'sum'},
    {
        field: 'ZHMonth',
        title: '走货月份',
        width: 100,
        sortable: 'asc',
        filterType: 'enum',
        // 旧客户端 GroupCount = 1，固定按走货月份升序分组。
        group: true,
    },
];
