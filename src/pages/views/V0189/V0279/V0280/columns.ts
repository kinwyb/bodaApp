import type {ColumnsDefine} from '@visactor/vtable';
import type {YupaiOrder} from '@/api';
import {YupaiMachineSizeHeader} from '@/api'
import type {FilterField} from '@/components/TableFilter';
import {buildColumns, type AppColumnDef} from '@/components/columnBuilder';

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

/** 组织机构 id -> 工厂名 */
const ORG_LABEL: Record<string, string> = {
    '0001E610000000KO20VW': '义乌工厂',
    '0001E610000000KWHO9D': '越南工厂',
};

const orgLabel = (id: unknown): string => ORG_LABEL[String(id ?? '')] ?? String(id ?? '');

/** 列定义：dataType 决定渲染控件（text / number / date / boolean / tag） */
const COLUMNS: AppColumnDef[] = [
    {field: 'WorkPlace', title: '产地', width: 90},
    {field: 'YPDate', title: '预订日期', width: 100, dataType: 'date', sortable: true},
    {
        field: 'KnitOrgID',
        title: '织造产地',
        width: 90,
        columnProps: {
            fieldFormat: (record: YupaiOrder) => orgLabel(record.KnitOrgID),
        },
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
        columnProps: {style: {textAlign: 'right'}},
    },
    {field: 'Memo', title: '备注', width: 190},
    {field: 'YLDate', title: '原料可下单期', width: 110, dataType: 'date'},
    {field: 'YLZLDate', title: '原料资料日期', width: 110, dataType: 'date'},
    ...YupaiMachineSizeHeader.map((title, index) => {
        const fieldName = `MCSize${index + 1}`;
        return {
            field: fieldName,
            title,
            width: 82,
            dataType: 'number' as const,
            columnProps: {
                style: {textAlign: 'right'},
                fieldFormat: (record: YupaiOrder) => {
                  const value = record[fieldName];
                  if (value === null || value === undefined || value === '') return '';
                  // 你的判断逻辑
                  if (Number(value) > 0) {
                    return  value;
                  }else{
                    return '';
                  }
                },
            },
        }
    }),
];

export function buildPreorderColumns(): ColumnsDefine {
    return buildColumns(COLUMNS);
}
