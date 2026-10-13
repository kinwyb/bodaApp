import type {ColumnsDefine} from '@visactor/vtable';
import {buildColumns, type AppColumnDef} from '@/components/columnBuilder';
import {
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
    DataVersion: number;

    /** 尺码分布，字段名 MCSize1 ~ MCSize9，对应下面 SIZE_HEADERS 的顺序（未填为 null） */
    [key: string]: unknown;
}

// ─── 编辑器：字段 → 控件类型（唯一判定处） ──────────────────────────────────

const hdWorkNames = [
    '拷边', '缝杯', '粘合', '包边', '人字车', '带刀款', '生理裤', '密拉',
    '拉花边', '短裤拉花边', '拉皮双针', '四针六线', '空卷', '上拉链',
];

/** 后道主工序的候选值：工序名本身就是值和文案 */
const HD_WORK_OPTIONS = hdWorkNames.map((name) => ({value: name, label: name}));

/** 这些数值列允许小数，其余数值列按整数处理 */
const DECIMAL_FIELDS = new Set(['MWeight', 'MCycle', 'MSewWt']);

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

// ─── 单字段校验规则 ──────────────────────────────────────────────────────────

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

/**
 * 给详情表的每个字段注册**它自己的**具名编辑器，返回编辑器名。
 *
 * **控件类型只在这一处判定**（列定义 → 控件），单字段校验只是往同一个编辑器上挂一个 validator。
 *
 * ⚠️ 曾经不是这样，于是坏了：以前是「公共名的编辑器 + 带校验的字段再注册一个」两套，
 * 取名字时用 `带校验的 ?? 公共的` 兜底 —— 后道主工序明明注册了 Select，
 * 但它同时是 DETAIL_FIELD_RULES 里的字段（「不能为空」），名字被「带校验的 Input」顶掉，
 * 实际编辑时是输入框；那个 Select 注册成了永远没人引用的死代码。
 * 校验和控件分两处判定，迟早会对不上。
 *
 * 名字里带字段名是必须的：VTable 的编辑器注册表是全局的、同名幂等且**先注册者生效**
 * （见 register.ts 的 registerOnce），每个字段各占一个名字才不会发生看不见的覆盖。
 */
function registerDetailEditor(column: AppColumnDef): string {
    const {field, dataType} = column;
    const name = `preorder-detail-${field}`;
    // 规则取自 services 的 DETAIL_FIELD_RULES，与保存前的整表校验是同一份，
    // 保证不会出现「编辑器放行了、保存时又被拦下」
    const rule = DETAIL_FIELD_RULES[field];
    const options = rule ? {validator: (value: unknown) => rule(value)} : {};

    if (field === 'StyleCode') {
        // 款号是特例：除了自己的规则，还要按订单号查重、并带出款式描述与默认值
        registerAntdInputEditor(name, {}, {
            validator: async (value, row) => {
                const err = DETAIL_FIELD_RULES.StyleCode(value);
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
        return name;
    }

    if (field === 'HDWorkName') {
        // 后道主工序是枚举，用下拉（选项固定，工序名本身就是值和文案）
        registerAntdSelectEditor(name, {options: HD_WORK_OPTIONS}, options);
        return name;
    }

    if (dataType === 'number') {
        registerAntdNumberEditor(
            name,
            {min: 0, ...(DECIMAL_FIELDS.has(field) ? {} : {precision: 0})},
            options,
        );
        return name;
    }

    registerAntdInputEditor(name, {}, options);
    return name;
}

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
        // 控件类型与单字段校验一起在这里决定（见 registerDetailEditor）
        return [column.field, registerDetailEditor(column)];
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
        DataVersion: 0,
    } as yupaiOrderDetailRow;
    YupaiMachineSizeHeader.forEach((_, index) => {
        row[`MCSize${index + 1}`] = null;
    });
    return row;
}
