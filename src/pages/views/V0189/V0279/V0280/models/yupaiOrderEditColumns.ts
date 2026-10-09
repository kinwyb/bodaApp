import type {ColumnsDefine} from '@visactor/vtable';
import {buildColumns, type AppColumnDef} from '@/components/columnBuilder';
import {
    ANTD_INPUT_EDITOR,
    registerAntdInputEditor,
    registerAntdNumberEditor,
} from '@/components/vtable-editors/register';
import {YupaiMachineSizeHeader} from '@/api/modules/yupai';

/** 详情表格的一行：当前一单一款式，编辑时由预订单记录映射而来 */
export interface yupaiOrderDetailRow {
    YupaiOrderID: string;
    /** 款号 */
    StyleCode: string;
    /** 款式数量 */
    Number: number;
    /** 款式描述 */
    ProduceName: string;
    /** 预估颜色 */
    Color: string;
    /** 特殊工序 */
    TSWorkName: string;
    /** 后道主工序 */
    HDWorkName: string;
    /** 中码下机克重 */
    ZZMWeight: number;
    /** 中码下机时间 */
    ZZMTime: number;
    /** 缝制工时 */
    MSewWt: number;

    /** 尺码分布，字段名 MCSize1 ~ MCSize9，对应下面 SIZE_HEADERS 的顺序 */
    [key: string]: unknown;
}

// ─── 编辑器：按字段类型注册 antd 控件 ────────────────────────────────────────

/** 整数值（款式数量、尺码件数）：0 起步，不允许小数 */
const DETAIL_INT_EDITOR = 'preorder-detail-int';
/** 小数值（克重、下机时间、缝制工时）：0 起步，允许小数 */
const DETAIL_DECIMAL_EDITOR = 'preorder-detail-decimal';

// VTable 只认「已注册的编辑器名」，先注册再挂到列上
registerAntdInputEditor(ANTD_INPUT_EDITOR);
registerAntdNumberEditor(DETAIL_INT_EDITOR, {min: 0, precision: 0});
registerAntdNumberEditor(DETAIL_DECIMAL_EDITOR, {min: 0});

/** 这些数值列允许小数，其余数值列按整数处理 */
const DECIMAL_FIELDS = new Set(['ZZMWeight', 'ZZMTime', 'MSewWt']);

/** 按列的数据类型挑编辑器：数值列用 InputNumber，其余用 Input */
function editorOf(column: AppColumnDef): string {
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

/** 新建一行空白明细，供用户直接在表格里输入 */
export function createDetailRow(id: string): yupaiOrderDetailRow {
    const row = {
        YupaiOrderID: id,
        StyleCode: '',
        Number: 0,
        ProduceName: '',
        Color: '',
        TSWorkName: '',
        HDWorkName: '',
        ZZMWeight: 0,
        ZZMTime: 0,
        MSewWt: 0,
    } as yupaiOrderDetailRow;
    YupaiMachineSizeHeader.forEach((_, index) => {
        row[`MCSize${index + 1}`] = 0;
    });
    return row;
}
