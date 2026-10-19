import type {ColumnsDefine} from '@visactor/vtable';
import type {YupaiOrder} from '@/api';
import {YupaiMachineSizeHeader} from '@/api'
import type {FilterField} from '@/components/vtable';
import {type AppColumnDef, buildColumns} from '@/components/vtable/columnBuilder';
import {ORG_NAME} from "@/store/orgs.ts";

/** 可筛选的列：类型决定筛选控件（enum 多选 / date、number 区间 / text 包含） */
export const preorderFilterFields: FilterField[] = [
    {field: 'WorkPlace', title: '产地', type: 'enum'},
    {field: 'Ywy', title: '业务员', type: 'enum'},
    {field: 'YPDate', title: '预订日期', type: 'date'},
    {field: 'JHDate', title: '计划下单期', type: 'date'},
    {field: 'OrderCode', title: '订单号', type: 'text'},
    {field: 'StyleCode', title: '款号', type: 'text'},
    {field: 'Qty', title: '总数量', type: 'number'},
    {field: 'OrderZQ', title: '订单周期', type: 'number'},
    {field: 'ProduceName', title: '款式描述', type: 'enum'},
    {field: 'HDWorkName', title: '后道主工序', type: 'enum'},
    {field: 'XDRate', title: '下单把握度', type: 'enum'},
];

/** 列定义：dataType 决定渲染控件（text / number / date / boolean / tag） */
export const COLUMNS: AppColumnDef[] = [
    {field: 'WorkPlace', title: '产地', width: 90},
    {field: 'YPDate', title: '预订日期', width: 100, dataType: 'date', sortable: true},
    {
        field: 'KnitOrgID',
        title: '织造产地',
        width: 90,
        fieldFormat: (record: YupaiOrder) => ORG_NAME(record.KnitOrgID),
    },
    {field: 'Ywy', title: '业务员', width: 80},
    {field: 'OrderCode', title: '订单号', width: 110, sortable: true},
    {field: 'Qty', title: '总数量', width: 90, dataType: 'number', sortable: true},
    {field: 'Number', title: '款式数量', width: 80, dataType: 'number', sortable: true},
    {field: 'StyleCode', title: '款号', width: 110},
    {field: 'ProduceName', title: '款式描述', width: 150},
    {field: 'Color', title: '预估颜色', width: 170},
    {field: 'TSWorkName', title: '特殊工序', width: 130},
    {field: 'HDWorkName', title: '后道主工序', width: 100},
    {field: 'JHDate', title: '计划下单期', width: 100, dataType: 'date'},
    {field: 'QRDate', title: '确认下单期', width: 100, dataType: 'date'},
    {field: 'WCDate', title: '尾货期', width: 100, dataType: 'date'},
    {field: 'OrderZQ', title: '订单周期', width: 80, dataType: 'number', sortable: true},
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
    },
    {field: 'Memo', title: '备注', width: 190},
    {field: 'YLDate', title: '原料可下单期', width: 110, dataType: 'date'},
    {field: 'YLZLDate', title: '原料资料日期', width: 110, dataType: 'date'},
    {field: 'YLDHDate', title: '原料计划到货期', width: 110, dataType: 'date'},
    {field: 'FLDate', title: '辅料可下单期', width: 110, dataType: 'date'},
    {field: 'BZFLDate', title: '包装辅料提供期', width: 110, dataType: 'date'},
    {field: 'MWeight', title: '中码下机克重', width: 110, dataType: 'number'},
    {field: 'MCycle', title: '中码下机时间', width: 110, dataType: 'number'},
    {field: 'MSewWt', title: '缝制工时', width: 110, dataType: 'number'},
    ...YupaiMachineSizeHeader.map((title, index) => {
        const fieldName = `MCSize${index + 1}`;
        return {
            field: fieldName,
            title,
            width: 82,
            dataType: 'number' as const,
            // number 默认右对齐，这里只覆盖显示格式（0 与空值都当未填）
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
