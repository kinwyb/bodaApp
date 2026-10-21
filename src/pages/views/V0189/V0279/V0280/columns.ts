import type {ColumnsDefine} from '@visactor/vtable';
import type {YupaiOrder} from '@/api';
import {YupaiMachineSizeHeader} from '@/api'
import {type AppColumnDef, buildColumns} from '@/components/grid-table/columnBuilder';
import {ORG_NAME} from "@/store/orgs.ts";

/**
 * 列定义：dataType 决定渲染控件（text / int / double / date / boolean / tag），
 * filterType 决定这一列进不进筛选面板（不配 = 不参与筛选，不用再单独配 FilterField）。
 */
export const COLUMNS: AppColumnDef[] = [
    {field: 'WorkPlace', title: '产地', width: 90, filterType: 'enum'},
    {field: 'YPDate', title: '预订日期', width: 100, dataType: 'date', sortable: true, filterType: 'date'},
    {
        field: 'KnitOrgID',
        title: '织造产地',
        width: 90,
        fieldFormat: (record: YupaiOrder) => ORG_NAME(record.KnitOrgID),
    },
    {field: 'Ywy', title: '业务员', width: 80, filterType: 'enum'},
    {field: 'OrderCode', title: '订单号', width: 110, sortable: true, filterType: 'text'},
    {field: 'Qty', title: '总数量', width: 90, dataType: 'int', sortable: true, filterType: 'number'},
    {field: 'Number', title: '款式数量', width: 80, dataType: 'int', sortable: true},
    {field: 'StyleCode', title: '款号', width: 110, filterType: 'text'},
    {field: 'ProduceName', title: '款式描述', width: 150, filterType: 'enum'},
    {field: 'Color', title: '预估颜色', width: 170},
    {field: 'TSWorkName', title: '特殊工序', width: 130},
    {field: 'HDWorkName', title: '后道主工序', width: 100, filterType: 'enum'},
    {field: 'JHDate', title: '计划下单期', width: 100, dataType: 'date', filterType: 'date'},
    {field: 'QRDate', title: '确认下单期', width: 100, dataType: 'date'},
    {field: 'WCDate', title: '尾货期', width: 100, dataType: 'date'},
    {field: 'OrderZQ', title: '订单周期', width: 80, dataType: 'int', sortable: true, filterType: 'number'},
    {field: 'ZHDate', title: '走货期', width: 100, dataType: 'date'},
    // 阶段列：1 选中 / 0 未选中，渲染成复选框
    {field: 'SSStep', title: '产能阶段', width: 100, dataType: 'boolean'},
    {field: 'QMStep', title: '全码样阶段', width: 100, dataType: 'boolean'},
    {field: 'WaitCustStep', title: '待客户反馈阶段', width: 120, dataType: 'boolean'},
    {field: 'WaitOrderStep', title: '待订单阶段', width: 110, dataType: 'boolean'},
    {field: 'OtherStep', title: '其它阶段', width: 100, dataType: 'boolean'},
    {field: 'ZQCheckDate', title: '中期验货日期', width: 110, dataType: 'date'},
    {field: 'ZQCheckMemo', title: '中期验货要求', width: 120},
    {
        field: 'XDRate',
        title: '下单把握度',
        width: 95,
        style: {textAlign: 'right'},
        filterType: 'enum',
    },
    {field: 'Memo', title: '备注', width: 190},
    {field: 'YLDate', title: '原料可下单期', width: 110, dataType: 'date'},
    {field: 'YLZLDate', title: '原料资料日期', width: 110, dataType: 'date'},
    {field: 'YLDHDate', title: '原料计划到货期', width: 110, dataType: 'date'},
    {field: 'FLDate', title: '辅料可下单期', width: 110, dataType: 'date'},
    {field: 'BZFLDate', title: '包装辅料提供期', width: 110, dataType: 'date'},
    {field: 'MWeight', title: '中码下机克重', width: 110, dataType: 'double'},
    {field: 'MCycle', title: '中码下机时间', width: 110, dataType: 'double'},
    {field: 'MSewWt', title: '缝制工时', width: 110, dataType: 'double'},
    ...YupaiMachineSizeHeader.map((title, index) => {
        const fieldName = `MCSize${index + 1}`;
        return {
            field: fieldName,
            title,
            width: 82,
            dataType: 'int' as const,
            // int 默认右对齐、只显示整数，这里只覆盖显示格式（0 与空值都当未填）
            fieldFormat: (record: YupaiOrder) => {
                const value = record[fieldName];
                if (value === null || value === undefined || value === '') return '';
                if (Number(value) > 0) {
                    return value;
                } else {
                    return '';
                }
            },
        }
    }),
];

export function buildPreorderColumns(): ColumnsDefine {
    return buildColumns(COLUMNS);
}
