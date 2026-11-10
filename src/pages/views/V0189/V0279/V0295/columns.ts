import type {YupaiOrderCompleteGroup} from '@/api';
import type {AppColumnDef} from '@/components/grid-table';
import {toNumberOrZero} from '@/utils';

/** 旧客户端只对这几个数值列的 `0` 做空白显示 */
function blankWhenZero(value: unknown): unknown {
    return toNumberOrZero(value) === 0 ? '' : value;
}

/** 已下单汇总主表 */
export const YUPAI_COMPLETE_GROUP_COLUMNS: AppColumnDef[] = [
    {field: 'OrderCode', title: '订单号', width: 110, filterType: 'enum'},
    {field: 'CompleteDate', title: '下单日期', width: 109, dataType: 'date', filterType: 'date'},
    {field: 'BillNo', title: 'NC合同编号', width: 120, filterType: 'text'},
    {
        field: 'CompleteMonth',
        title: '下单月份',
        width: 100,
        group: true,
        sortable: 'asc',
        filterType: 'enum',
    },
    {field: 'BillDate', title: 'NC合同日期', width: 105, dataType: 'date', filterType: 'date'},
    {field: 'JHTotalNum', title: '计划下单数', width: 100, dataType: 'int'},
    {
        field: 'BillTotalNum',
        title: 'NC合同下单数',
        width: 105,
        dataType: 'int',
        aggregate: 'sum',
    },
    {field: 'Currency', title: '货币', width: 79, filterType: 'enum'},
    {
        field: 'USDMoney',
        title: '美元',
        width: 100,
        dataType: 'double',
        aggregate: 'sum',
        fieldFormat: (record: YupaiOrderCompleteGroup) => blankWhenZero(record.USDMoney),
    },
    {
        field: 'CNYMoney',
        title: '人民币',
        width: 100,
        dataType: 'double',
        aggregate: 'sum',
        fieldFormat: (record: YupaiOrderCompleteGroup) => blankWhenZero(record.CNYMoney),
    },
    {
        field: 'OutNum',
        title: '出库数',
        width: 90,
        dataType: 'int',
        fieldFormat: (record: YupaiOrderCompleteGroup) => blankWhenZero(record.OutNum),
    },
    {
        field: 'SendNum',
        title: '发货数',
        width: 90,
        dataType: 'int',
        fieldFormat: (record: YupaiOrderCompleteGroup) => blankWhenZero(record.SendNum),
    },
    {
        field: 'NoSendNum',
        title: '欠发货数',
        width: 95,
        dataType: 'int',
        fieldFormat: (record: YupaiOrderCompleteGroup) => blankWhenZero(record.NoSendNum),
    },
    {field: 'DSendDate', title: '出货期', width: 100, dataType: 'date'},
];

