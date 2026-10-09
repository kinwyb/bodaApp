import type {ColumnsDefine} from '@visactor/vtable';
import {buildColumns, type AppColumnDef} from '@/components/columnBuilder';
import {
    ANTD_INPUT_EDITOR,
    registerAntdInputEditor,
    registerAntdNumberEditor, registerAntdSelectEditor,
} from '@/components/vtable-editors/register';
import {YupaiMachineSizeHeader} from '@/api/modules/yupai';

/**
 * 详情表格的一行：当前一单一款式，编辑时由预订单记录映射而来。
 *
 * 数值字段的「未填」一律是 **null，不是 0** —— 这样 isBlank / isBlankExcept
 * 就能直接判出「整行没填」，不用再另写一套「数值 <= 0 算空」的值语义判空；
 * 提交给后端时再折回 0（见页面 handleSave 的 payload）。
 */
export interface yupaiOrderDetailRow {
    YupaiOrderID: string;
    /** 款号 */
    StyleCode: string;
    /** 款式数量（未填为 null） */
    Number: number | null;
    /** 款式描述 */
    ProduceName: string;
    /** 预估颜色 */
    Color: string;
    /** 特殊工序 */
    TSWorkName: string;
    /** 后道主工序 */
    HDWorkName: string;
    /** 中码下机克重（未填为 null） */
    ZZMWeight: number | null;
    /** 中码下机时间（未填为 null） */
    ZZMTime: number | null;
    /** 缝制工时（未填为 null） */
    MSewWt: number | null;

    /** 尺码分布，字段名 MCSize1 ~ MCSize9，对应下面 SIZE_HEADERS 的顺序（未填为 null） */
    [key: string]: unknown;
}

// ─── 编辑器：按字段类型注册 antd 控件 ────────────────────────────────────────

/** 整数值（款式数量、尺码件数）：0 起步，不允许小数 */
const DETAIL_INT_EDITOR = 'preorder-detail-int';
/** 小数值（克重、下机时间、缝制工时）：0 起步，允许小数 */
const DETAIL_DECIMAL_EDITOR = 'preorder-detail-decimal';
const DETAIL_HDWORK_EDITOR = 'preorder-detail-hdwork';
const hdWorkNames = [
    '拷边', '缝杯', '粘合', '包边', '人字车', '带刀款', '生理裤', '密拉',
    '拉花边', '短裤拉花边', '拉皮双针', '四针六线', '空卷', '上拉链',
];

// VTable 只认「已注册的编辑器名」，先注册再挂到列上
registerAntdInputEditor(ANTD_INPUT_EDITOR);
registerAntdNumberEditor(DETAIL_INT_EDITOR, {min: 0, precision: 0});
registerAntdNumberEditor(DETAIL_DECIMAL_EDITOR, {min: 0});
registerAntdSelectEditor(DETAIL_HDWORK_EDITOR, {
    // 工序名本身就是值和文案，转成 options 用 map 即可
    options: hdWorkNames.map((name) => ({value: name, label: name})),
});

/** 这些数值列允许小数，其余数值列按整数处理 */
const DECIMAL_FIELDS = new Set(['ZZMWeight', 'ZZMTime', 'MSewWt']);

/** 按列的数据类型挑编辑器：数值列用 InputNumber，其余用 Input */
function editorOf(column: AppColumnDef): string {
    if (column.field === 'HDWorkName') return DETAIL_HDWORK_EDITOR;
    if (column.dataType !== 'number') return ANTD_INPUT_EDITOR;
    return DECIMAL_FIELDS.has(column.field) ? DETAIL_DECIMAL_EDITOR : DETAIL_INT_EDITOR;
}

const DETAIL_COLUMNS: AppColumnDef[] = [
    {field: 'StyleCode', title: '款号', width: 96},
    {field: 'Number', title: '款式数量', width: 76, dataType: 'number'},
    {field: 'ProduceName', title: '款式描述', width: 130},
    {field: 'Color', title: '预估颜色', width: 140},
    {field: 'TSWorkName', title: '特殊工序', width: 110},
    {field: 'HDWorkName', title: '后道主工序', width: 100},
    {field: 'ZZMWeight', title: '中码下机克重', width: 108, dataType: 'number'},
    {field: 'ZZMTime', title: '中码下机时间', width: 108, dataType: 'number'},
    {field: 'MSewWt', title: '缝制工时', width: 88, dataType: 'number'},
    ...YupaiMachineSizeHeader.map((title, index) => ({
        field: `MCSize${index + 1}`,
        title,
        width: 82,
        dataType: 'number' as const,
    })),
];

/** 详情表格可编辑字段 -> 编辑器名，交给 VTable 的 editableFields */
export const DETAIL_EDITOR_FIELDS: Record<string, string> = Object.fromEntries(
    DETAIL_COLUMNS.map((column) => {
        if (column.dataType === 'number') {
            column.columnProps = {
                ...column.columnProps, fieldFormat: (record: yupaiOrderDetailRow) => {
                    const value = record[column.field];
                    if (value === null || value === undefined || value === '') return '';
                    // 你的判断逻辑
                    if (Number(value) > 0) {
                        return value;
                    } else {
                        return '';
                    }
                }
            }
        }
        return [column.field, editorOf(column)];
    }),
);

/**
 * 构建详情表格列定义
 *
 * 只声明「展示成什么」，编辑器由 VTable 通过 editableFields 统一注入，
 * 所以这里不区分只读/可编辑：只读就是不传 editableFields。
 */
export function buildPreorderDetailColumns(): ColumnsDefine {
    return buildColumns(DETAIL_COLUMNS);
}

/** 新建一行空白明细，供用户直接在表格里输入。数值字段的空 = null（不是 0） */
export function createDetailRow(id: string): yupaiOrderDetailRow {
    const row = {
        YupaiOrderID: id,
        StyleCode: '',
        Number: null,
        ProduceName: '',
        Color: '',
        TSWorkName: '',
        HDWorkName: '',
        ZZMWeight: null,
        ZZMTime: null,
        MSewWt: null,
    } as yupaiOrderDetailRow;
    YupaiMachineSizeHeader.forEach((_, index) => {
        row[`MCSize${index + 1}`] = null;
    });
    return row;
}
