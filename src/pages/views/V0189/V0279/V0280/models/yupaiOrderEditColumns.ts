import type {ColumnsDefine} from '@visactor/vtable';
import {buildColumns, type AppColumnDef} from '@/components/columnBuilder';
import {
    ANTD_INPUT_EDITOR,
    registerAntdInputEditor,
    registerAntdNumberEditor, registerAntdSelectEditor,
} from '@/components/vtable-editors/register';
import {yupaiApi, YupaiMachineSizeHeader} from '@/api/modules/yupai';
import {DETAIL_FIELD_RULES, yupaiService} from '@/services/yupai';
import {isBlank, toStringOrEmpty} from "@/utils";

/**
 * 详情表格的一行：当前一单一款式，编辑时由预订单记录映射而来。
 *
 * 数值字段的「未填」一律是 **null，不是 0** —— 这样 isBlank / isBlankExcept
 * 就能直接判出「整行没填」，不用再另写一套「数值 <= 0 算空」的值语义判空；
 * 提交给后端时再折回 0（见页面 handleSave 的 payload）。
 */
export interface yupaiOrderDetailRow {
    _id: string; //数据唯一ID
    // 预订单数据ID
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
    MWeight: number | null;
    /** 中码下机时间（未填为 null） */
    MCycle: number | null;
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
const DECIMAL_FIELDS = new Set(['MWeight', 'MCycle', 'MSewWt']);

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
    {field: 'MWeight', title: '中码下机克重', width: 108, dataType: 'number'},
    {field: 'MCycle', title: '中码下机时间', width: 108, dataType: 'number'},
    {field: 'MSewWt', title: '缝制工时', width: 88, dataType: 'number'},
    ...YupaiMachineSizeHeader.map((title, index) => ({
        field: `MCSize${index + 1}`,
        title,
        width: 82,
        dataType: 'number' as const,
    })),
];

// ─── 单字段校验规则对应的编辑器 ──────────────────────────────────────────────

/**
 * 有单字段校验规则的字段，各自注册一个**具名**编辑器。
 *
 * 为什么不复用上面的通用名：VTable 的编辑器注册表是全局的，而且同名「先注册者生效」
 * （见 register.ts 的 registerOnce）—— 共用 `preorder-detail-int` 的话同名只注册一次，
 * 「哪个字段配哪条规则」就区分不出来了，所以有规则的字段各自占一个名字。
 *
 * 规则取自 services 的 DETAIL_FIELD_RULES，和保存前的整表校验是同一份，
 * 保证不会出现「编辑器放行了、保存时又被拦下」。
 */
/**
 * 当前弹窗里的订单号 —— 给编辑器的 validator 读。
 *
 * 为什么需要它：编辑器是在**模块级**注册的，validator 的闭包里拿不到页面的 form；
 * 而「款号在同一订单内不能重复」这条规则要按订单号限定查询范围。页面在三个时机同步它
 * （打开弹窗 / 点检测 / 用户改动订单号，见 yupaiOrderEdit.tsx），关闭弹窗时置空。
 *
 * 同一时刻只会有一个预订单弹窗，所以模块级变量够用 —— 页面靠 `<Form onFieldsChange>` 同步它
 * （用户手动改订单号、检测时 setFieldsValue 覆盖、打开弹窗预填，三种情况都能收到），
 * 关弹窗时置空。**明细行上不用再放订单号**：那是整单级的信息，行级冗余还得额外维护同步。
 */
let currentOrderCode = '';

/** 页面同步「当前订单号」（详情行的款号查重按它限定范围） */
export const setCurrentOrderCode = (orderCode: string): void => {
    currentOrderCode = orderCode;
};

const RULED_FIELD_EDITORS: Record<string, string> = {};
Object.entries(DETAIL_FIELD_RULES).forEach(([field, rule]) => {
    const column = DETAIL_COLUMNS.find((item) => item.field === field);
    // 规则字段不在表里就跳过（字段名写错时的典型症状），下面会退回到通用编辑器
    if (!column) return;
    const name = `preorder-detail-rule-${field}`;
    if (column.dataType === 'number') {
        registerAntdNumberEditor(
            name,
            {min: 0, ...(DECIMAL_FIELDS.has(field) ? {} : {precision: 0})},
            {validator: (value) => rule(value)},
        );
    } else if (field === 'StyleCode') {
        registerAntdInputEditor(name, {}, {
            validator: async (value, row) => {
                const err = rule(value);
                if (!isBlank(err)) {
                    return err;
                }
                const dataRow = row.record as yupaiOrderDetailRow | undefined;
                // 订单号从页面同步进来（见上面的 currentOrderCode）。值先取到局部变量：
                // 下面要 await，模块级变量期间可能被别处改写。
                const orderCode = currentOrderCode;
                if (orderCode) {
                    const selfId = toStringOrEmpty(dataRow?.YupaiOrderID);
                    const res = await yupaiService.queryOrder(orderCode, value);
                    // 排除自己那一行：同一订单里**别的**款式用了这个款号才算重复
                    if (res.data?.some((item) => String(item.ID) !== selfId)) {
                        return "该订单下款号已存在";
                    }
                }
                // 款式基础数据获取
                const styleName = await yupaiApi.styleName(value);
                if (styleName.data) {
                    row.setField("ProduceName", styleName.data);
                }
                const styleDefaultValue = await yupaiApi.styleDefaultValue(value);
                if (styleDefaultValue.data) {
                    row.setFields({
                        MCycle:styleDefaultValue.data.MCycle,
                        MWeight:styleDefaultValue.data.MWeight,
                        HDWorkName:styleDefaultValue.data.HDWorkName,
                    })
                }
                return undefined;
            }
        });
    } else {
        registerAntdInputEditor(name, {}, {validator: (value) => rule(value)});
    }
    RULED_FIELD_EDITORS[field] = name;
});

/** 详情表格可编辑字段 -> 编辑器名，交给 VTable 的 editableFields */
export const DETAIL_EDITOR_FIELDS: Record<string, string> = Object.fromEntries(
    DETAIL_COLUMNS.map((column) => {
        if (column.dataType === 'number') {
            column.columnProps = {
                ...column.columnProps, fieldFormat: (record: yupaiOrderDetailRow) => {
                    const value = record[column.field];
                    if (value === null || value === undefined || value === '') return '';
                    // 未填在数据里就是 null（见 createDetailRow）；0 也一并当未填显示
                    if (Number(value) > 0) {
                        return value;
                    } else {
                        return '';
                    }
                }
            }
        }
        // 配了单字段规则的字段走它自己的具名编辑器（带提交前拦截），其余按类型取通用编辑器
        return [column.field, RULED_FIELD_EDITORS[column.field] ?? editorOf(column)];
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
        _id: id,
        StyleCode: '',
        Number: null,
        ProduceName: '',
        Color: '',
        TSWorkName: '',
        HDWorkName: '',
        MWeight: null,
        MCycle: null,
        MSewWt: null,
    } as yupaiOrderDetailRow;
    YupaiMachineSizeHeader.forEach((_, index) => {
        row[`MCSize${index + 1}`] = null;
    });
    return row;
}
