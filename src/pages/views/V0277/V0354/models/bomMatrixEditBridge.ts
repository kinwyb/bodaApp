/**
 * 包装 BOM 矩阵编辑弹窗的界面桥声明（页面 V0277_V0354 的 form 那一层）。
 *
 * 弹窗一打开，它顶掉页面的工具栏动作 / 查询条件 / 列表数据，成为 agent 此刻的视野；
 * 关闭后自动让位 —— 覆盖规则由桥统一实现（见 ui-bridge/handler.ts 的 composeSnapshot），
 * 这里只回答「这个弹窗有哪些字段、怎么填、提交意味着什么」，以及「下面三张矩阵表怎么读」。
 *
 * 四条约束都是**照着界面上的真实限制**来的，不是另发明一套：
 * - **保存 / 生成 / 复制都还没接后端**：`form.submit` 如实回「接口没接」，绝不假装成功 ——
 *   假装成功模型会当成已入库，接着去核对一份根本不存在的记录；
 * - 产成品的物料决定下方三张表能不能编（弹窗里的 `canEditMatrix`），配色 / 配码的列也由它决定；
 * - 物料编码与单位**不能只是塞一个字符串**：编码要查库带出整组属性、单位要从这个物料的换算单位里取，
 *   所以它们是**顺序字段**（写完带出关联值），与用户在界面上选物料的路径完全同一条；
 * - 三张矩阵表只给 `matrix.get` 读，**不给写入口**：这一份保存都没接，改了也留不下来。
 *
 * 三条写法约束（与项目里其他 bridged 文件一致）：
 * - 只放常量与纯函数，不导出组件、不调 hook：弹窗把「怎么取当前状态」以取值函数传进来；
 * - 字段表 `PACK_FIELDS` / `SEW_FIELDS` **同时被弹窗的 JSX 与本文件使用**（弹窗从这里 import），
 *   所以界面上少一个字段、agent 那儿也少一条，不会出现平行维护的两份；
 * - **通用的那套别抄在这里**：批量解析、锁判断、类型转换、回执拼装都在
 *   `@/pages/agent/ui-bridge/form`（`createFormWriter`）。本文件只给字段表、锁规则与三个顺序字段。
 */

import type {FormInstance} from 'antd';
import {ncBaseApi} from '@/api/modules/nc/base.ts';
import {ncMaterialApi} from '@/api/modules/nc/material.ts';
import type {NCMaterial, NCMaterialConvert} from '@/api/schemas/nc/NCMaterial.ts';
import type {NCProductor} from '@/api/schemas/nc/NCBase.ts';
import type {PackBomMatrix} from '@/api/schemas/nc/bomMatrix.ts';
import {ensureConverts} from '@/components/nc/convertCache.ts';
import {buildColorColumns, buildSizeColumns, ITEM_COLUMNS} from '@/components/nc/bomMatrix/columns.ts';
import type {BomMatrixGridApi} from '@/components/nc/bomMatrix/gridApi.ts';
import {colorCells, createItemRow, rowKeyOf, sizeCells} from '@/components/nc/bomMatrix/rows.ts';
import {nextRowNo} from '@/components/nc/bomMatrix/rowNo.ts';
import {
    BOM_MATRIX_SECTIONS,
    bomMatrixSectionLabel,
    type BomMatrixSection,
    DEFAULT_BOM_MATRIX_SECTION,
    isBomMatrixSection,
} from '@/components/nc/bomMatrix/sections.ts';
import type {UIAction, UIField, UIFieldType, UIForm, UIGuide} from '@/pages/agent/protocol';
import {
    createFormWriteHandlers,
    createFormWriter,
    type FieldOutcome,
    type FormFieldSpec,
    toAgentValue,
    type UIDialogHost,
} from '@/pages/agent/ui-bridge';
import {toDayjs, toNumberOrZero, toStringOrEmpty} from '@/utils';
import type {FormMode} from '../command';

/** 表单里两组字段：包装成品（4 开头物料）与产成品（3 开头物料） */
export type BomMatrixFieldGroup = 'pack' | 'sew';

const GROUP_LABEL: Record<BomMatrixFieldGroup, string> = {
    pack: '包装成品',
    sew: '产成品',
};

/** 只读字段的统一原因：它们全是物料的属性，手填会出现自相矛盾的数据 */
const DERIVED_BY_MATERIAL = '由物料编码带出（名称 / 版本 / 规格 / 型号 / 主单位 / 换算率），手改会出现「编码是 A、名称却是 B」';

/**
 * 一个表单字段。
 *
 * `label` 是界面上的短名（分组标题已经说明了它属于谁），`agentLabel` 是给 agent 看的全名 ——
 * 两组都有「物料编码 / 单位」，短名重复。桥按 label 认字段（见 `resolveFieldEntries`），
 * 不分开就会出现「设产成品的单位，写进了包装成品那一组」。
 */
export type BomMatrixFormField = {
    /** 字段 id，就是 Form.Item 的 name */
    id: string;
    /** 界面上的标签 */
    label: string;
    /** 给 agent 看的全名：两个分组的短名重复，靠它区分 */
    agentLabel: string;
    group: BomMatrixFieldGroup;
    type: UIFieldType;
    readOnly?: boolean;
    readOnlyReason?: string;
    /** 物料编码：界面上是 MaterialSelect（输码查库），写入要先查库再回填整组 */
    material?: BomMatrixFieldGroup;
    /** 单位：界面上是 ConvertSelect（候选来自这个物料的换算单位） */
    convert?: BomMatrixFieldGroup;
};

/**
 * 包装成品那一组（界面上的第一组）。
 *
 * 弹窗的 JSX 直接用它渲染，所以这里少写一个字段，界面上也就少一个 —— 不会与 agent 看到的对不上。
 */
export const PACK_FIELDS: BomMatrixFormField[] = [
    {id: 'PackMaterialCode', label: '物料编码', agentLabel: '包装物料编码', group: 'pack', type: 'text', material: 'pack'},
    {
        id: 'PackMaterialName',
        label: '物料名称',
        agentLabel: '包装物料名称',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'PackMaterialVersion',
        label: '物料版本',
        agentLabel: '包装物料版本',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'PackMaterialSpec',
        label: '物料规格',
        agentLabel: '包装物料规格',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'PackMaterialModel',
        label: '物料型号',
        agentLabel: '包装物料型号',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'CMeasure',
        label: '主单位',
        agentLabel: '包装主单位',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'VChangerate',
        label: '转换率',
        agentLabel: '包装转换率',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: '随「单位」一起带出（后端按「单位 + 换算率」还原数量），不能单独改',
    },
    {id: 'Cassmeasure', label: '单位', agentLabel: '包装单位', group: 'pack', type: 'text', convert: 'pack'},
    {id: 'PackMethod', label: '包装方法', agentLabel: '包装方法', group: 'pack', type: 'text'},
    {id: 'PackNum', label: '包装数量', agentLabel: '包装数量', group: 'pack', type: 'text'},
    {id: 'ProjectCode', label: '项目', agentLabel: '项目编码', group: 'pack', type: 'text'},
];

/**
 * 产成品那一组（界面上的第二组）。
 *
 * 「物料编码」是这一组唯一的编辑入口 —— **它决定下面三张表能不能编**
 * （弹窗里的 `hasSewMaterial`）。`SewMaterialVID` 是隐藏的关联键，不入表：
 * 让 agent 单独填 VID 只会填出脏数据。
 */
export const SEW_FIELDS: BomMatrixFormField[] = [
    {id: 'SewMaterialCode', label: '物料编码', agentLabel: '产成品物料编码', group: 'sew', type: 'text', material: 'sew'},
    {
        id: 'SewMaterialName',
        label: '物料名称',
        agentLabel: '产成品物料名称',
        group: 'sew',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'SewMaterialVersion',
        label: '物料版本',
        agentLabel: '产成品物料版本',
        group: 'sew',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'SewMaterialSpec',
        label: '物料规格',
        agentLabel: '产成品物料规格',
        group: 'sew',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'SewMaterialModel',
        label: '物料型号',
        agentLabel: '产成品物料型号',
        group: 'sew',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'SewCMeasure',
        label: '主单位',
        agentLabel: '产成品主单位',
        group: 'sew',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'SewVChangerate',
        label: '转换率',
        agentLabel: '产成品转换率',
        group: 'sew',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: '随「单位」一起带出（后端按「单位 + 换算率」还原数量），不能单独改',
    },
    {id: 'SewCassmeasure', label: '单位', agentLabel: '产成品单位', group: 'sew', type: 'text', convert: 'sew'},
];

/** 表单里全部字段（界面顺序：包装成品 → 产成品） */
export const BOM_MATRIX_FORM_FIELDS: BomMatrixFormField[] = [...PACK_FIELDS, ...SEW_FIELDS];

/** 字段 id → 字段描述：顺序字段要按 id 找它自己的说明与分组 */
const FIELD_BY_ID = new Map(BOM_MATRIX_FORM_FIELDS.map((field) => [field.id, field]));

/** 交给写入引擎的字段表：label 换成 agent 全名（两组短名重复，靠它区分） */
const WRITER_FIELDS: FormFieldSpec[] = BOM_MATRIX_FORM_FIELDS.map((field) => ({
    id: field.id,
    label: field.agentLabel,
    type: field.type,
    readOnly: field.readOnly,
    readOnlyReason: field.readOnlyReason,
}));

/**
 * 弹窗打开时给 agent 的操作说明，会覆盖页面的 guide。
 *
 * 顺序不是建议而是**界面的硬约束**：不先定产成品，下面三张表整块禁用（界面上蒙着一层）。
 * 写在这里是为了让模型一次做对，而不是每一步撞一次锁再读报错。
 */
const FORM_GUIDE: UIGuide = {
    summary: '包装 BOM 矩阵表单弹窗：上半是包装成品 / 产成品的物料信息，下半是子项物料、配色、配码三张表',
    steps: [
        '**先定产成品的物料**（SewMaterialCode）：它决定下面三张表能不能编，配色 / 配码的列也按它的颜色（vfree6）、尺码（vfree7）生成',
        '要改多个字段就用 form.setMany 传一整张 {字段id: 新值}；只改一处用 form.set。字段 id 见 form.fields[].id',
        '物料编码与单位可以直接写：写编码会先按编码查库、把名称 / 版本 / 规格 / 型号 / 主单位一起带出；' +
            '写单位会从这个物料的换算单位里取，并带出换算率',
        '要核对手上的矩阵数据用 matrix.get（默认读当前标签页）；换一张表先 matrix.tab',
        '改矩阵用 matrix.update 传 rowId + {字段: 新值}；加行用 matrix.add（只加在子项物料里，配色 / 配码会自动补同一行）；' +
            '删行用 matrix.remove（行号 10 那行不能删）',
        '**保存 / 生成 / 复制都还没接后端**：form.submit 只会如实回「接口没接」。矩阵改动只在界面上看得见，别当成已入库',
        '不打算继续就 form.cancel 关掉弹窗',
    ],
    terms: {
        包装成品: '上半第一组：被包装的物料（编码 4 开头），它的名称 / 规格 / 单位都来自物料档案',
        产成品: '上半第二组：缝制物料（编码 3 开头），决定子项明细能不能编，也决定配色 / 配码有哪些列',
        包装方法: 'PackMethod，包装方式的文字说明',
        包装数量: 'PackNum，一份包装里的数量（接口里是字符串）',
        子项物料: '下半第一张表 items：一行一个物料，行号 10 那一行就是产成品本身',
        配色: '下半第二张表 colors：每列一个缝制颜色，格子里是该颜色下这个物料的色号',
        配码: '下半第三张表 sizes：每个尺码三列（损耗数量 / 尺码系数 / 尺码用量）',
        标签页: '三张表同一时刻只渲染一张，key 分别是 items / colors / sizes；当前是哪一张见 form.fields 里的「当前矩阵标签页」',
    },
    cautions: [
        '保存 / 生成 / 复制都还没接后端：form.submit 一定不会成功。矩阵改动（matrix.update / add / remove）' +
            '界面上立刻看得到，但**不会入库**，关掉弹窗就没了 —— 别把它们当成「数据已经改好」',
        '两组的「物料编码 / 单位」短名重复：form.setMany 一律用字段 id（PackMaterialCode / SewMaterialCode / Cassmeasure / SewCassmeasure），不要用中文名',
        '物料编码写的是**编码**，不是名称也不是 VID；编码查不到、或匹配到多个版本时会被如实拒绝，交给用户在界面上选',
        '产成品那一组只认 3 开头的物料，包装成品只认 4 开头的',
        '产成品没设之前下方三张表是禁用的（界面上整块蒙住）：此时 matrix.update / add / remove 一律拒绝',
        '子项物料里「物料名称 / 版本 / 规格 / 主单位」这些列不可写（由物料带出）：要换就换 MaterialCode，整组会一起换',
        '行号 10 是产成品那一行：它的物料只能通过 form.set SewMaterialCode 换，matrix.remove 也删不掉它',
        '配色 / 配码写的是**名称**（红 / 260），编码（{列名}_val）由字典自动补；名称不在字典里会被拒绝并列出可选值',
        '配色 / 配码的列随产成品变（有几个颜色 / 尺码就有几列），换产成品后列目录会整份换掉 —— 读之前重新 matrix.get',
    ],
};

/**
 * 改字段的两条命令。
 *
 * 不用 `createFormWriteActions`：它内置的示例是别的表单（预订单）的字段名，抄给模型只会让它
 * 照着不存在的字段写。handler 仍然走 `createFormWriteHandlers`，参数解析与写入判锁都在那一层。
 */
const FORM_WRITE_ACTIONS: UIAction[] = [
    {
        id: 'form.setMany',
        label: '一次性设置多个字段',
        group: 'form',
        params: [
            {
                name: 'values',
                type: 'object',
                required: true,
                hint:
                    '字段 id → 新值的对象（也接受它的 JSON 字符串），例如 ' +
                    '{"SewMaterialCode":"3001","PackMethod":"纸箱"}。字段 id 见 form.fields[].id。' +
                    '**一次传齐，不要一个字段调一次**；物料编码与单位会先查库 / 取换算单位，其余字段随后一次写入',
            },
        ],
    },
    {
        id: 'form.set',
        label: '设置单个字段',
        group: 'form',
        params: [
            {
                name: 'field',
                type: 'text',
                required: true,
                hint: '字段 id（见 form.fields[].id），例如 SewMaterialCode —— 别用「物料编码」这种短名，两组的短名重复',
            },
            {name: 'value', type: 'text', hint: '新值；物料编码填编码本身'},
        ],
    },
];

/** 弹窗打开时的动作表：改字段 / 切矩阵标签页 / 读矩阵行 / 保存 / 关闭 */
function formActions(): UIAction[] {
    return [
        ...FORM_WRITE_ACTIONS,
        {
            id: 'matrix.tab',
            label: '切换矩阵标签页',
            group: 'form',
            params: [
                {
                    name: 'key',
                    type: 'select',
                    required: true,
                    options: BOM_MATRIX_SECTIONS.map((item) => item.key),
                    hint: `要读哪张表：${BOM_MATRIX_SECTIONS.map((item) => `${item.key}=${item.label}`).join('、')}`,
                },
            ],
        },
        {
            // 纯读：回执立刻发（不用等弹窗落定），也不推 rev
            id: 'matrix.get',
            label: '读取矩阵明细行',
            group: 'form',
            returns: 'result',
            params: [
                {
                    name: 'section',
                    type: 'select',
                    options: BOM_MATRIX_SECTIONS.map((item) => item.key),
                    hint: '读哪张表，不给 = 当前标签页（见 form.fields 里那条只读的「当前矩阵标签页」）',
                },
                {
                    name: 'limit',
                    type: 'number',
                    hint: '最多返回多少行，默认 20、上限 200；只要几行就传几行，别习惯性取满',
                },
            ],
        },
        {
            id: 'matrix.update',
            label: '改矩阵行的若干格',
            group: 'form',
            params: [
                {
                    name: 'rowId',
                    type: 'text',
                    required: true,
                    hint: '行的 rowId（matrix.get 返回的那个），**不是行号**',
                },
                {
                    name: 'values',
                    type: 'object',
                    required: true,
                    hint:
                        '字段 → 新值（对象或它的 JSON 字符串）。字段见 matrix.get 的 fields：' +
                        '子项物料可写 ' + ITEM_WRITABLE_FIELDS.join(' / ') + '；' +
                        '配色写颜色名（色号编码自动补）；配码写 Sunhao{尺码} / S{尺码} / N{尺码}',
                },
                {
                    name: 'section',
                    type: 'select',
                    options: BOM_MATRIX_SECTIONS.map((item) => item.key),
                    hint: '改哪张表，不给 = 当前标签页',
                },
            ],
        },
        {
            id: 'matrix.add',
            label: '在子项物料里插入一行',
            group: 'form',
            params: [
                {
                    name: 'values',
                    type: 'object',
                    hint:
                        '新行的字段（可只给 MaterialCode，名称 / 版本 / 单位会按编码带出；行号不给就自动算）。' +
                        '可写字段同 matrix.update',
                },
                {
                    name: 'afterRowId',
                    type: 'text',
                    hint: '插在这一行后面；不给就插在最后一行有物料的后面（末尾那行是待输入的空行）',
                },
            ],
        },
        {
            id: 'matrix.remove',
            label: '删除子项物料的一行',
            group: 'form',
            params: [
                {
                    name: 'rowId',
                    type: 'text',
                    required: true,
                    hint: '要删的行 rowId；行号 10（产成品那一行）不能删',
                },
            ],
        },
        {id: 'form.submit', label: '保存', group: 'form'},
        {id: 'form.cancel', label: '取消（关闭弹窗）', group: 'form'},
    ];
}

/**
 * 默认插入点：最后一个**有物料**的行的 rowId。
 *
 * 子项物料表在编辑态末尾永远留一行等待输入的空行（见 itemView 的 `ensureBlankAfter`），
 * 直接追加到末尾会排在那行空行后面 —— 看起来像是「加了一行却没出现」。
 */
function lastMaterialRowKey(rows: Array<Record<string, unknown>>): string {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (toStringOrEmpty(rows[index].MaterialVID) !== '') return rowKeyOf(rows[index]);
    }
    return '';
}

/** 当前标签页（弹窗 state 是 string，认不出就退回默认页） */
function currentSection(ctx: BomMatrixEditBridgeContext): BomMatrixSection {
    return isBomMatrixSection(ctx.activeKey) ? ctx.activeKey : DEFAULT_BOM_MATRIX_SECTION;
}

/** 字段此刻的样子：取值、锁、报错、界面位置提示 */
function currentFields(
    form: FormInstance<Record<string, unknown>>,
    fieldLock: (fieldId: string) => string | null,
): UIField[] {
    const values = form.getFieldsValue();
    const errorMap = new Map<string, string[]>();
    form.getFieldsError().forEach((item) => {
        if (item.errors.length === 0) return;
        errorMap.set(String(item.name), item.errors);
    });
    return BOM_MATRIX_FORM_FIELDS.map((field) => {
        const spec: UIField = {
            id: field.id,
            label: field.agentLabel,
            type: field.type,
            value: toAgentValue(values[field.id]),
            // 界面上锁住的字段，快照里也如实标成只读 —— 让它一眼看出「现在还不能改」，
            // 而不是设一次被拒一次
            readOnly: field.readOnly || fieldLock(field.id) !== null,
            errors: errorMap.get(field.id),
        };
        if (field.readOnly) spec.hint = field.readOnlyReason;
        else if (field.material) spec.hint = `界面上的「${field.label}」（${GROUP_LABEL[field.group]}那一组）：填编码会先查库，带出整组物料属性`;
        else if (field.convert) spec.hint = `界面上的「${field.label}」：只能从这个物料的换算单位里选，写进去会带出换算率`;
        else spec.hint = `界面上的「${field.label}」（${GROUP_LABEL[field.group]}那一组）`;
        return spec;
    });
}

/**
 * 当前矩阵标签页，作为一条**只读字段**放进 form 段。
 *
 * 弹窗层的快照只有 form 段（没有 tables），标签页状态不放这儿，模型就没有任何地方能看到
 * 「用户此刻在看哪张表」—— 它会拿 matrix.get 的默认页当答案，也就是猜。
 */
function sectionField(ctx: BomMatrixEditBridgeContext): UIField {
    const key = currentSection(ctx);
    return {
        id: 'MatrixSection',
        label: '当前矩阵标签页',
        type: 'readonly',
        value: `${bomMatrixSectionLabel(key)}（${key}）`,
        readOnly: true,
        hint: '下方三张表同一时刻只渲染一张：matrix.get 默认读它，要读别的先 matrix.tab 切过去',
    };
}

/** 编码前缀：产成品是 3 开头的缝制物料，包装成品是 4 开头的包装物料（与 MaterialSelect 的 filter 一致） */
function codePrefix(group: BomMatrixFieldGroup): string {
    return group === 'sew' ? '3' : '4';
}

/**
 * 物料编码：写完**按编码查库**，把整组属性带出来（等价于用户在界面上用物料选择器选中）。
 *
 * 三种情况只有一条能过：正好命中一条同前缀的物料。零条 / 多条都请用户手动选 ——
 * 替它挑一条等于赌运气，赌错了要等到保存才发现，更难查。
 */
async function setMaterialField(
    ctx: BomMatrixEditBridgeContext,
    field: BomMatrixFormField,
    value: unknown,
): Promise<FieldOutcome> {
    const code = toStringOrEmpty(value).trim();
    if (!code) {
        return {
            ok: false,
            message: `未设置「${field.agentLabel}」：清空物料请让用户在界面上点输入框的 ×（相关联字段要一起清）`,
        };
    }
    const group = field.material ?? field.group;
    const prefix = codePrefix(group);
    let materials: NCMaterial[] = [];
    try {
        materials = (await ncMaterialApi.query({code})).data ?? [];
    } catch {
        return {ok: false, message: `未设置「${field.agentLabel}」= ${code}：按编码查物料失败了（网络 / 后端），稍后重试`};
    }
    const matched = materials.filter((item) => toStringOrEmpty(item.code).startsWith(prefix));
    if (matched.length === 0) {
        return {
            ok: false,
            message:
                `未设置「${field.agentLabel}」= ${code}：查不到 ${prefix} 开头的${GROUP_LABEL[group]}物料` +
                '（这一组只认这个前缀的编码），请让用户在界面上选',
        };
    }
    if (matched.length > 1) {
        return {
            ok: false,
            message:
                `未设置「${field.agentLabel}」= ${code}：匹配到 ${matched.length} 个版本，` +
                '请让用户在界面上用物料选择器挑一个（替它选一条等于赌运气）',
        };
    }
    const material = matched[0];
    /*
     * 回填交给弹窗的 apply（那是界面自己的规则：一组字段怎么带、产成品还要重铺第一行、
     * 按新物料重取颜色 / 尺码列）。桥再抄一份必然与界面漂移。
     */
    ctx.applyMaterial(group, material);
    return {
        ok: true,
        message: `已设置「${field.agentLabel}」= ${code}（${toStringOrEmpty(material.name)}），名称 / 版本 / 规格 / 单位已一起带出`,
    };
}

/**
 * 单位：只从这个物料的换算单位里取（后端按「单位 + 换算率」还原数量，手写一个不存在的单位
 * 保存时才算不出来）。写进去时换算率一起带出，与界面上选单位的行为一致。
 */
async function setConvertField(
    ctx: BomMatrixEditBridgeContext,
    field: BomMatrixFormField,
    value: unknown,
): Promise<FieldOutcome> {
    const unit = toStringOrEmpty(value).trim();
    if (!unit) {
        return {ok: false, message: `未设置「${field.agentLabel}」：单位不能清空，请让用户在界面上选一个`};
    }
    const group = field.convert ?? field.group;
    const materialVID = toStringOrEmpty(
        ctx.form.getFieldValue(group === 'sew' ? 'SewMaterialVID' : 'PackMaterialVID'),
    );
    if (!materialVID) {
        return {
            ok: false,
            message: `未设置「${field.agentLabel}」= ${unit}：先设置${GROUP_LABEL[group]}的物料编码，才有可选单位`,
        };
    }
    let converts: NCMaterialConvert[] = [];
    try {
        converts = (await ensureConverts(materialVID)) ?? [];
    } catch {
        return {
            ok: false,
            message: `未设置「${field.agentLabel}」= ${unit}：取这个物料的换算单位失败了，稍后重试`,
        };
    }
    const hit = converts.find((item) => toStringOrEmpty(item.measdoc) === unit);
    if (!hit) {
        const options = converts
            .map((item) => `${toStringOrEmpty(item.measdoc)}（换算率 ${toStringOrEmpty(item.measrate)}）`)
            .join('、');
        return {
            ok: false,
            message:
                `未设置「${field.agentLabel}」= ${unit}：这个物料的换算单位里没有它` +
                (options ? `，可选 ${options}` : '（物料档案里没维护换算单位）'),
        };
    }
    ctx.applyConvert(group, hit);
    return {
        ok: true,
        message: `已设置「${field.agentLabel}」= ${toStringOrEmpty(hit.measdoc)}（换算率 ${toStringOrEmpty(hit.measrate)} 一并带出）`,
    };
}

/** 列定义里可能出现的形状（原生列与项目列定义都覆盖） */
type ColumnLike = {
    field?: unknown;
    title?: unknown;
    children?: unknown;
    columns?: unknown;
};

/** 列定义 → 叶子列（field + 列头）：分组表头本身不是一列，配色 / 配码还有分组嵌套 */
function flattenColumns(columns: unknown[]): Array<{field: string; title: string}> {
    const result: Array<{field: string; title: string}> = [];
    const seen = new Set<string>();
    const walk = (list: unknown) => {
        if (!Array.isArray(list)) return;
        list.forEach((raw) => {
            if (!raw || typeof raw !== 'object') return;
            const column = raw as ColumnLike;
            const nested = Array.isArray(column.children)
                ? column.children
                : Array.isArray(column.columns)
                    ? column.columns
                    : null;
            if (nested) {
                walk(nested);
                return;
            }
            const field = toStringOrEmpty(column.field);
            if (!field || seen.has(field)) return;
            seen.add(field);
            const rawTitle = column.title;
            const title = typeof rawTitle === 'function'
                ? String((rawTitle as () => string)())
                : String(rawTitle ?? field);
            result.push({field, title});
        });
    };
    walk(columns);
    return result;
}

/** 某张表的列定义（与视图共用同一份，见 components/nc/bomMatrix/columns.ts） */
function sectionColumns(section: BomMatrixSection, matrix: PackBomMatrix): unknown[] {
    if (section === 'colors') return buildColorColumns(matrix);
    if (section === 'sizes') return buildSizeColumns(matrix);
    return ITEM_COLUMNS;
}

/**
 * 某张表里 `matrix.update` 可写的字段 —— 与 `buildItemPatch` / `buildColorPatch` /
 * `buildSizePatch` 里的白名单是**同一套**（都从这几份常量与矩阵数据推导）。
 * 放进 `matrix.get` 的返回里，模型就不用拿只读列去试错。
 */
function writableFieldsOf(section: BomMatrixSection, matrix: PackBomMatrix): string[] {
    if (section === 'items') return ITEM_WRITABLE_FIELDS;
    if (section === 'colors') {
        return (matrix.ColorSort ?? []).filter((color): color is string => !!color);
    }
    return (matrix.SizeSort ?? []).flatMap((size) => {
        if (!size) return [];
        const cells = sizeCells(size);
        return [cells.sunhao, cells.name, cells.number];
    });
}

/** 一行只留非空的列：几十列里通常一半以上是空的，键名往往比值还贵 */
function pickCells(
    row: Record<string, unknown>,
    fields: Array<{field: string; title: string}>,
): Record<string, unknown> {
    const cells: Record<string, unknown> = {
        // 三张表共用明细主键做行标识：跨表对行直接拿它（见 guide）
        rowId: toStringOrEmpty(row.PackBomMatrixDetailID),
    };
    fields.forEach(({field}) => {
        const value = row[field];
        if (value === null || value === undefined || value === '') return;
        cells[field] = value;
    });
    return cells;
}

/** 取整并夹到区间内（模型给 1e9 或 -5 都不该让弹窗去算半天） */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Math.floor(toNumberOrZero(value));
    if (num < min) return min;
    if (num > max) return max;
    return num;
}

/** 弹窗交给桥的东西：只有状态与能力，没有桥的结构 */
export type BomMatrixEditBridgeContext = {
    /** 弹窗标题（按模式变：新增 / 编辑 / 复制 / 查看） */
    title: string;
    mode: FormMode;
    /** 正在编辑的矩阵主键；新增时为 null */
    recordId: string | null;
    /** antd 表单实例：取值与校验报错都向它要，弹窗不另存一份 */
    form: FormInstance<Record<string, unknown>>;
    /**
     * 详情落地没有。
     *
     * 编辑 / 复制 / 查看都要先拉一次详情：那之前字段是空的、下方表格也没渲染 ——
     * 不当作就绪的话，模型会以为「这份矩阵本来就这么空」。
     */
    isReady: () => boolean;
    /**
     * 这个字段此刻为什么改不了（null = 可以改）。
     *
     * 锁定规则只写在弹窗里一处，界面上的 `disabled` 与桥共用它 ——
     * 桥再推一遍「查看模式 / 详情没到就只读」必然与界面漂移。
     */
    fieldLock: (fieldId: string) => string | null;
    /** 按物料把整组字段带出来（与界面上选中物料同一条路） */
    applyMaterial: (group: BomMatrixFieldGroup, material: NCMaterial) => void;
    /** 按换算单位把「单位 + 换算率」一起写进去（与界面上选单位同一条路） */
    applyConvert: (group: BomMatrixFieldGroup, convert: NCMaterialConvert) => void;
    /** 下方三张矩阵表渲染出来没有（详情没到 / 加载失败时是 false） */
    matrixReadable: () => boolean;
    /** 当前矩阵（弹窗派生后的那份）：配色 / 配码的列跟着它走 */
    matrix: PackBomMatrix;
    /** 当前标签页（受控在弹窗里，控件自己不存） */
    activeKey: string;
    setActiveKey: (key: string) => void;
    /**
     * 某张表的当前行（含未保存的编辑）。
     *
     * 面板没挂载过时控件会按「当前明细 + 接口数据」现算，与它第一次打开时看到的等价 ——
     * 所以这里不必区分「挂没挂载」。**但写不行**，写要用 `readGrid`（见下）。
     */
    readRows: (section: BomMatrixSection) => Array<Record<string, unknown>>;
    /**
     * 某张表的**行级写能力**（`addRow` / `removeRow` / `updateRow` / `getRows`）。
     *
     * 面板没渲染过时是 null（懒挂载）—— 写必须落到真实的表上，
     * 往现算出来的临时数组里写，屏幕上什么都不会变。
     */
    readGrid: (section: BomMatrixSection) => BomMatrixGridApi | null;
    /**
     * 下方三张表此刻为什么不能编（null = 能编）。
     *
     * 与界面上那层蒙层同一条判据（弹窗的 `canEditMatrix`）：查看模式恒只读；
     * 其余模式要求先选产成品。桥不自己另算，否则会出现「界面蒙着、agent 却能改」。
     */
    matrixEditLock: () => string | null;
    /**
     * 色号 / 尺码系数的字典（名称 → 编码）。
     *
     * 这两列在表里可编辑的是**名称**（`红` / `260`），而保存时 `ColorMatch.VFree6`、
     * `SizeMatch.VFree7` 要**编码**（存在 `{列名}_val`）。agent 只知道名称，
     * 桥靠这份字典把编码一起写进去。
     */
    readValueOptions: (kind: 'color' | 'size') => Array<{name: string, id: string}>;
    /** 表单级提示（详情加载失败这类不属于任何字段的） */
    formErrors: () => string[];
    /**
     * 保存。`ok=false` 时 `message` 是**可修复的原因**。
     *
     * 这一份的保存接口还没接，所以它恒为 false 并说明原因 —— 弹窗**不假装成功**：
     * 假装成功模型会当成已入库，接着去核对一份根本不存在的记录。
     */
    submit: () => Promise<{ok: boolean; message: string}>;
    close: () => void;
};

/* ===================== 下方三张矩阵表的写入口 ===================== */

/**
 * 子项物料里 agent 能改的列 —— 与界面上可编辑的格子是同一批
 * （见 `components/nc/bomMatrix/itemView.tsx` 的 `editableFields`）。
 *
 * 刻意**不含** `MaterialName` / `MaterialVersion` / `CMeasure` 这些「由物料带出」的列：
 * 要换物料就换 `MaterialCode`，桥会按编码把整组一起换掉 ——
 * 只改名称等于造一份「编码是 A、名称是 B」的数据。
 */
const ITEM_WRITABLE_FIELDS = [
    'VRowNo', 'MaterialCode', 'Ndissipationum', 'Nitemnum', 'Ibasenum', 'Cassmeasure',
    'Fitemsource', 'Fbackflushtype', 'Bdeliver', 'Bupint', 'ProjectMaterial', 'Productor',
    'VFree1Name', 'VFree4Name', 'VFree5Name', 'VFree8Name', 'VFree9Name', 'BeginDate', 'EndDate',
];

/** 日期列：行里存的是 Dayjs（schema 的 transform 做的），写字符串进去表格认不出来 */
const ITEM_DATE_FIELDS = new Set(['BeginDate', 'EndDate']);
/** 布尔列（vtable 按 boolean 渲染，写字符串 'false' 会被当成 true） */
const ITEM_BOOLEAN_FIELDS = new Set(['ProjectMaterial', 'Bdeliver', 'Bupint']);
/**
 * 数字列：接口 schema 里就是 number 的那三个（`Fitemsource` / `Fbackflushtype` / `Ibasenum`）。
 * 其余的数值（损耗系数、子项数量、尺码用量）接口里是字符串，保持字符串 —— 界面写回的也是字符串。
 */
const ITEM_NUMBER_FIELDS = new Set(['Fitemsource', 'Fbackflushtype', 'Ibasenum']);

/**
 * 换物料要一起换的那组字段。
 *
 * 与 `itemView.tsx` 的 `applyMaterial` 是**同一张字段表**（那边走编辑器的 `setFields`，
 * 这边走 `updateRow`）：少写一个就会出现「编码是新的、名称还是旧的」这种半截数据。
 */
function itemMaterialFields(material: NCMaterial): Record<string, unknown> {
    const convert = material.materialconvert?.[0];
    return {
        MaterialVID: material.pk_material,
        MaterialCode: material.code,
        MaterialName: material.name,
        MaterialVersion: material.version,
        MaterialSpec: material.materialspec,
        MaterialType: material.materialtype,
        CMeasureid: material.pk_measdoc,
        CMeasure: material.measdoc,
        Cassmeasure: convert?.measdoc ?? material.measdoc,
        Cassmeasureid: convert?.pk_measdoc ?? material.pk_measdoc,
        VChangerate: convert?.measrate ?? '1/1',
    };
}

/** 把 agent 给的值转成这一列该有的形态（日期 Dayjs / 布尔 / 数字 / 字符串） */
function coerceItemValue(
    field: string,
    value: unknown,
): {ok: true; value: unknown} | {ok: false; reason: string} {
    if (ITEM_DATE_FIELDS.has(field)) {
        const date = toDayjs(value);
        return date ? {ok: true, value: date} : {ok: false, reason: '不是日期，格式要 YYYY-MM-DD'};
    }
    if (ITEM_BOOLEAN_FIELDS.has(field)) {
        if (typeof value === 'boolean') return {ok: true, value};
        const text = toStringOrEmpty(value).trim().toLowerCase();
        return {ok: true, value: text === 'true' || text === '1' || text === '是'};
    }
    if (ITEM_NUMBER_FIELDS.has(field)) {
        const num = Number(value);
        return Number.isNaN(num) ? {ok: false, reason: '不是数字'} : {ok: true, value: num};
    }
    return {ok: true, value: toStringOrEmpty(value)};
}

/** 解析 `{字段: 新值}`：对象，或它的 JSON 字符串（模型常把结构化数据序列化后再传） */
function parseValues(input: unknown): Record<string, unknown> | null {
    let source = input;
    if (typeof source === 'string') {
        try {
            source = JSON.parse(source) as unknown;
        } catch {
            return null;
        }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    return source as Record<string, unknown>;
}

/** 字典的可选值提示：列全了反而淹没重点，截断前 20 个 */
function describeOptions(names: string[]): string {
    if (names.length === 0) return '（字典为空：产成品物料的辅助属性没维护，或还没按它取过）';
    return names.length <= 20 ? names.join(' / ') : `${names.slice(0, 20).join(' / ')} 等 ${names.length} 个`;
}

/**
 * 子项物料行上的辅助属性列 → 字典的 fieldName（`VFree1Name` ↔ `vfree1`）。
 *
 * 这几列在界面上是「辅助属性弹窗」选的：选中后**名称与编码两列一起写**
 * （`VFree1Name` / `VFree1`）。agent 只知道名称，编码得由这里按该行物料的字典补，
 * 否则保存时编码列是空的。
 */
const ITEM_VFREE_FIELDS: Record<string, string> = {
    VFree1Name: 'vfree1',
    VFree4Name: 'vfree4',
    VFree5Name: 'vfree5',
    VFree8Name: 'vfree8',
    VFree9Name: 'vfree9',
};

/**
 * 单位：单位名 / 单位ID / 换算率是**一组**（保存时后端按「单位 + 换算率」还原数量）。
 *
 * 只写 `Cassmeasure` 会留下上一个单位的主键与比率 —— 与界面上的 `applyConvert` 同一口径。
 */
async function resolveItemConvert(
    row: Record<string, unknown>,
    value: unknown,
): Promise<Record<string, unknown>> {
    const unit = toStringOrEmpty(value).trim();
    if (!unit) throw new Error('单位不能是空串：这一行先有物料，再从它的换算单位里选');
    const materialVID = toStringOrEmpty(row.MaterialVID);
    if (!materialVID) throw new Error('这一行还没有物料：先写 MaterialCode（或让用户在界面上选），再写单位');
    const converts = (await ensureConverts(materialVID)) ?? [];
    const hit = converts.find((item) => toStringOrEmpty(item.measdoc).trim() === unit);
    if (!hit) {
        const options = converts.map((item) => `${toStringOrEmpty(item.measdoc)}（换算率 ${toStringOrEmpty(item.measrate)}）`);
        throw new Error(`这个物料的换算单位里没有「${unit}」：可选 ${options.join('、') || '（物料档案没维护换算单位）'}`);
    }
    return {
        Cassmeasure: toStringOrEmpty(hit.measdoc),
        Cassmeasureid: toStringOrEmpty(hit.pk_measdoc),
        VChangerate: toStringOrEmpty(hit.measrate),
    };
}

/** 辅助属性：按这一行物料的字典把名称换成「名称 + 编码」两列 */
async function resolveItemVFree(
    row: Record<string, unknown>,
    field: string,
    value: unknown,
): Promise<Record<string, unknown>> {
    const vfreeField = ITEM_VFREE_FIELDS[field];
    const codeField = field.replace(/Name$/, '');
    const name = toStringOrEmpty(value).trim();
    if (!name) return {[field]: '', [codeField]: ''};
    const materialVID = toStringOrEmpty(row.MaterialVID);
    if (!materialVID) throw new Error(`「${field}」要先有物料：这一行还没有物料，先写 MaterialCode`);
    const items = (await ncMaterialApi.vfree({fieldName: vfreeField, pkMaterial: materialVID})).data ?? [];
    const hit = items.find((item) => toStringOrEmpty(item.name).trim() === name);
    if (!hit) {
        const names = items.map((item) => toStringOrEmpty(item.name).trim()).filter(Boolean);
        throw new Error(`「${name}」不在这个物料的 ${vfreeField} 字典里：可选 ${describeOptions(names)}`);
    }
    return {[field]: name, [codeField]: toStringOrEmpty(hit.pk_defdoc)};
}

/** 生产厂商：名称 + 基础档案主键一起写（只写名称的话保存时厂商主键还是上一家） */
async function resolveItemProductor(value: unknown): Promise<Record<string, unknown>> {
    const keyword = toStringOrEmpty(value).trim();
    if (!keyword) return {Productor: '', ProductorID: ''};
    let list: NCProductor[] = [];
    try {
        list = (await ncBaseApi.productor()).data ?? [];
    } catch {
        throw new Error(`生产厂商「${keyword}」查库失败（网络 / 后端），稍后重试`);
    }
    const hit = list.find(
        (item) => toStringOrEmpty(item.code).trim() === keyword || toStringOrEmpty(item.name).trim() === keyword,
    );
    if (!hit) {
        throw new Error(
            `查不到生产厂商「${keyword}」：可选 ${describeOptions(
                list.slice(0, 20).map((item) => toStringOrEmpty(item.name)),
            )}`,
        );
    }
    return {Productor: toStringOrEmpty(hit.name), ProductorID: toStringOrEmpty(hit.pk_defdoc)};
}

/**
 * 子项物料的一批改动 → 真正要写进这一行的字段。
 *
 * 界面会做的事这里都要替它做（否则行里会留下界面不可能出现的数据形态）：
 * 认列、换物料查库补齐整组、单位 / 辅助属性 / 厂商按字典补编码、按类型转换。
 *
 * @param row 目标行（`matrix.add` 时是刚造好的新行）：行号 10 属于产成品，它的物料不在这儿改
 */
async function buildItemPatch(
    values: Record<string, unknown>,
    row: Record<string, unknown>,
): Promise<{fields: Record<string, unknown>; notes: string[]}> {
    const fields: Record<string, unknown> = {};
    const notes: string[] = [];
    const rowNo = toStringOrEmpty(row.VRowNo);
    /** 同一批里既换物料又改单位 / 辅助属性时，后者要按**新的**物料查字典 */
    const effective = () => ({...row, ...fields});
    /*
     * **物料先写**：单位、辅助属性、厂商的候选都挂在这一行的物料上。
     * 不排序的话，`{Cassmeasure: "件", MaterialCode: "4001"}` 会拿旧物料的换算单位去匹配，
     * 结果要么被拒、要么写进上一个物料的单位 —— 而模型的入参顺序是随机的。
     */
    const ordered = [
        ...Object.entries(values).filter(([field]) => field === 'MaterialCode'),
        ...Object.entries(values).filter(([field]) => field !== 'MaterialCode'),
    ];

    for (const [field, raw] of ordered) {
        if (!ITEM_WRITABLE_FIELDS.includes(field)) {
            throw new Error(
                `子项物料里没有可编辑的列「${field}」。可写：${ITEM_WRITABLE_FIELDS.join(' / ')}` +
                '（物料名称 / 版本 / 规格 / 主单位这些由物料带出，换 MaterialCode 就会一起换）',
            );
        }
        if (field === 'MaterialCode') {
            const code = toStringOrEmpty(raw).trim();
            if (!code) throw new Error('物料编码不能是空串：要清空这一行的物料，请让用户在界面上操作');
            /*
             * 行号 10 是产成品本身（3 开头的缝制物料）：界面上这一格也是禁止编辑的
             * （见 itemView 的 canCellEdit）—— 换它要走上方的「产成品」那一组，
             * 那边还会重铺这一行、按新物料重取颜色 / 尺码列。
             */
            if (rowNo === '10' && toStringOrEmpty(row.MaterialCode).startsWith('3')) {
                throw new Error(
                    '行号 10 是产成品那一行：它的物料由上方「产成品」那一组决定，' +
                    '请用 form.set SewMaterialCode（会一并重铺这一行）',
                );
            }
            let materials: NCMaterial[] = [];
            try {
                materials = (await ncMaterialApi.query({code})).data ?? [];
            } catch {
                throw new Error(`物料编码「${code}」查库失败（网络 / 后端），稍后重试`);
            }
            const material = materials.find((item) => toStringOrEmpty(item.code) === code) ?? materials[0];
            if (!material) throw new Error(`查不到物料编码「${code}」：确认编码是否正确，或让用户在界面上选`);
            Object.assign(fields, itemMaterialFields(material));
            notes.push(`物料换成 ${code}（${toStringOrEmpty(material.name)}），名称 / 版本 / 单位一并带出`);
            continue;
        }
        if (field === 'Cassmeasure') {
            Object.assign(fields, await resolveItemConvert(effective(), raw));
            notes.push('单位与换算率一起换了');
            continue;
        }
        if (ITEM_VFREE_FIELDS[field]) {
            Object.assign(fields, await resolveItemVFree(effective(), field, raw));
            continue;
        }
        if (field === 'Productor') {
            Object.assign(fields, await resolveItemProductor(raw));
            continue;
        }
        const coerced = coerceItemValue(field, raw);
        if (!coerced.ok) throw new Error(`「${field}」${coerced.reason}`);
        fields[field] = coerced.value;
        if (field === 'VRowNo') notes.push('行号改了：配色 / 配码按同一行同步');
    }
    return {fields, notes};
}

/** 配色表的一批改动 → 要写的字段（写名称列时按字典补上编码列） */
function buildColorPatch(
    ctx: BomMatrixEditBridgeContext,
    values: Record<string, unknown>,
): Record<string, unknown> {
    const colors = (ctx.matrix.ColorSort ?? []).filter((color): color is string => !!color);
    const dict = new Map(ctx.readValueOptions('color').map((item) => [item.name, item.id]));
    const fields: Record<string, unknown> = {};
    Object.entries(values).forEach(([field, raw]) => {
        if (!colors.includes(field)) {
            throw new Error(
                `配色表里没有可编辑的列「${field}」。可写：${colors.join(' / ') || '（当前没有颜色列：先设产成品物料）'}`,
            );
        }
        const cells = colorCells(field);
        const name = toStringOrEmpty(raw).trim();
        if (!name) {
            // 清空色号：名字与编码一起清，只清一半保存时会留下孤儿编码
            fields[cells.name] = '';
            fields[cells.value] = '';
            return;
        }
        const id = dict.get(name);
        if (id === undefined) {
            throw new Error(`色号「${name}」不在这个产成品的颜色字典里：可选 ${describeOptions([...dict.keys()])}`);
        }
        fields[cells.name] = name;
        fields[cells.value] = id;
    });
    return fields;
}

/** 配码表的一批改动 → 要写的字段（尺码系数是「名 + 编码」两列，其余是数值） */
function buildSizePatch(
    ctx: BomMatrixEditBridgeContext,
    values: Record<string, unknown>,
): Record<string, unknown> {
    const sizes = (ctx.matrix.SizeSort ?? []).filter((size): size is string => !!size);
    const dict = new Map(ctx.readValueOptions('size').map((item) => [item.name, item.id]));
    const writable = sizes.map((size) => sizeCells(size));
    const fields: Record<string, unknown> = {};
    Object.entries(values).forEach(([field, raw]) => {
        const cells = writable.find(
            (item) => field === item.sunhao || field === item.name || field === item.number,
        );
        if (!cells) {
            throw new Error(
                `配码表里没有可编辑的列「${field}」。可写：` +
                (writable.length > 0
                    ? writable.map((item) => `${item.sunhao} / ${item.name} / ${item.number}`).join('、')
                    : '（当前没有尺码列：先设产成品物料）'),
            );
        }
        if (field === cells.name) {
            const name = toStringOrEmpty(raw).trim();
            if (!name) {
                fields[cells.name] = '';
                fields[cells.value] = '';
                return;
            }
            const id = dict.get(name);
            if (id === undefined) {
                throw new Error(`尺码系数「${name}」不在这个产成品的尺码字典里：可选 ${describeOptions([...dict.keys()])}`);
            }
            fields[cells.name] = name;
            fields[cells.value] = id;
            return;
        }
        // 损耗数量 / 尺码用量：数值以文本存（与界面写回一致），空串 = 未填
        fields[field] = toStringOrEmpty(raw);
    });
    return fields;
}

/** 要写哪张表：不给就用当前标签页，给了但不认识就报错（别静默落到默认页） */
function resolveSection(ctx: BomMatrixEditBridgeContext, wanted: unknown): BomMatrixSection {
    if (wanted === undefined || wanted === null || wanted === '') return currentSection(ctx);
    if (!isBomMatrixSection(wanted)) {
        throw new Error(
            `未知的矩阵标签页：${String(wanted)}。可选 ${BOM_MATRIX_SECTIONS.map((item) => item.key).join(' / ')}`,
        );
    }
    return wanted;
}

/** 写操作前的统一闸：能编 + 详情已到 + 这张表真的渲染了 */
function writableGrid(ctx: BomMatrixEditBridgeContext, section: BomMatrixSection): BomMatrixGridApi {
    const lock = ctx.matrixEditLock();
    if (lock) throw new Error(`下方矩阵表当前不可编辑：${lock}`);
    if (!ctx.matrixReadable()) {
        throw new Error('下方矩阵表还没渲染出来：详情还在加载，或加载失败（失败时让用户点弹窗里的「重试」）');
    }
    const grid = ctx.readGrid(section);
    if (!grid) {
        throw new Error(
            `「${bomMatrixSectionLabel(section)}」这张表还没渲染：标签页是懒挂载的，` +
            `先用 matrix.tab 把 key 设为 ${section}`,
        );
    }
    return grid;
}

/** 按 rowId 找行；找不到就把「有哪些行」说清楚（模型常把行号当 rowId 传） */
function requireRow(
    grid: BomMatrixGridApi,
    rowId: unknown,
): {rowKey: string; row: Record<string, unknown>; rows: Array<Record<string, unknown>>} {
    const rows = grid.getRows();
    const key = toStringOrEmpty(rowId).trim();
    if (!key) throw new Error('需要 rowId（matrix.get 返回的 rowId，不是行号）');
    const row = rows.find((item) => rowKeyOf(item) === key);
    if (!row) {
        const sample = rows
            .slice(0, 8)
            .map((item) => `${rowKeyOf(item)}（行号 ${toStringOrEmpty(item.VRowNo) || '空'}）`)
            .join('、');
        throw new Error(
            `这张表里没有 rowId=${key} 的行。现有行：${sample || '（这张表一行都没有）'}` +
            '。rowId 请用 matrix.get 返回的那个，不要用行号',
        );
    }
    return {rowKey: key, row, rows};
}

/** 字段 → 顺序字段的处理：物料编码查库带出整组，单位取换算单位带出换算率 */
async function setManySpecial(
    ctx: BomMatrixEditBridgeContext,
    fieldId: string,
    value: unknown,
): Promise<FieldOutcome> {
    const field = FIELD_BY_ID.get(fieldId);
    if (!field) return {ok: false, message: `表单没有字段「${fieldId}」`};
    return field.material
        ? await setMaterialField(ctx, field, value)
        : await setConvertField(ctx, field, value);
}

/** 顺序字段里「成功后其余字段才解锁」的那几个：物料编码换掉产成品，下面才可编 */
const UNLOCKS_OTHERS = new Set(['PackMaterialCode', 'SewMaterialCode']);

/**
 * 装配弹窗的界面桥宿主。
 *
 * 吃的是**取值函数**而不是 ctx 对象本身：字段表、动作表、就绪状态都在被调用的那一刻才读，
 * 所以宿主对象不必跟着每次渲染重建，读到的也永远是最新的表单内容。
 */
export function createBomMatrixEditBridge(read: () => BomMatrixEditBridgeContext): UIDialogHost {
    /*
     * 写入引擎：批量解析、锁判断、类型转换、回执都在 `@/pages/agent/ui-bridge/form`。
     * 这里只交出本表单的字段表、锁规则，以及三个「写完还有后续动作」的字段。
     */
    const writer = createFormWriter({
        fields: () => WRITER_FIELDS,
        fieldLock: (fieldId) => read().fieldLock(fieldId),
        write: (patch) => read().form.setFieldsValue(patch),
        /*
         * 顺序字段：物料编码与单位。它们在界面上都不是「随便填一个字符串」——
         * 编码要查库带出整组属性、单位要取这个物料的换算单位，所以走各自的 run。
         */
        sequenced: BOM_MATRIX_FORM_FIELDS.filter((field) => field.material || field.convert).map((field) => ({
            id: field.id,
            // 换掉产成品才解除「下方三张表不可编」，所以它「解锁别人」
            unlocksOthers: UNLOCKS_OTHERS.has(field.id),
            run: (value: unknown): Promise<FieldOutcome> => setManySpecial(read(), field.id, value),
        })),
    });

    return {
        snapshot: (): UIForm => {
            const ctx = read();
            return {
                id: 'packBomMatrixEdit',
                title: ctx.title,
                mode: ctx.mode,
                recordId: ctx.recordId,
                // 字段表与 writer 读的是同一份描述（id / label / type / 锁），不会一处有一处无
                fields: [...currentFields(ctx.form, ctx.fieldLock), sectionField(ctx)],
                // 详情加载失败这类不属于任何字段：界面只在表格位置画一行提示，模型看不到
                errors: ctx.formErrors(),
            };
        },
        actions: () => formActions(),
        handlers: {
            // 改字段的两条由桥的通用实现接管：参数解析、锁判断、回执都在那一层
            ...createFormWriteHandlers(writer),
            'matrix.tab': (params) => {
                const key = params.key;
                if (!isBomMatrixSection(key)) {
                    throw new Error(
                        `未知的矩阵标签页：${String(key)}。可选 ${BOM_MATRIX_SECTIONS.map((item) => item.key).join(' / ')}`,
                    );
                }
                const ctx = read();
                if (currentSection(ctx) === key) {
                    return `已经在「${bomMatrixSectionLabel(key)}」这一页：用 matrix.get 读它的行`;
                }
                ctx.setActiveKey(key);
                return `已切到「${bomMatrixSectionLabel(key)}」：用 matrix.get 读它的行`;
            },
            'matrix.get': (params) => {
                const ctx = read();
                if (!ctx.matrixReadable()) {
                    throw new Error(
                        '下方矩阵表还没渲染出来：详情还在加载，或加载失败（失败时让用户点弹窗里的「重试」）',
                    );
                }
                const wanted = params.section;
                if (wanted !== undefined && wanted !== '' && !isBomMatrixSection(wanted)) {
                    throw new Error(
                        `未知的矩阵标签页：${String(wanted)}。可选 ${BOM_MATRIX_SECTIONS.map((item) => item.key).join(' / ')}`,
                    );
                }
                const section = isBomMatrixSection(wanted) ? wanted : currentSection(ctx);
                const fields = flattenColumns(sectionColumns(section, ctx.matrix));
                const rows = ctx.readRows(section);
                const limit = clampInt(params.limit, 20, 1, 200);
                const picked = rows.slice(0, limit).map((row) => pickCells(row, fields));
                return {
                    section,
                    label: bomMatrixSectionLabel(section),
                    sections: BOM_MATRIX_SECTIONS.map((item) => item.key),
                    total: rows.length,
                    count: picked.length,
                    hasMore: picked.length < rows.length,
                    fields,
                    // matrix.update 的 values 只认这些字段（其余列由物料 / 字典带出，不可直写）
                    writableFields: writableFieldsOf(section, ctx.matrix),
                    rows: picked,
                    note:
                        '空值不出现（省略即未填，不是 0）；rowId 是明细主键，三张表按它对应同一行；' +
                        'VRowNo 是业务行号（行号 10 = 产成品那一行）。改动用 matrix.update / add / remove，' +
                        '**但保存接口还没接** —— 改完只在界面上，不会入库',
                };
            },
            'matrix.update': async (params) => {
                const ctx = read();
                const section = resolveSection(ctx, params.section);
                const grid = writableGrid(ctx, section);
                const {rowKey, row} = requireRow(grid, params.rowId);
                const values = parseValues(params.values);
                if (!values) {
                    throw new Error(
                        '需要 values：{字段: 新值}（对象或它的 JSON 字符串），字段见 matrix.get 返回的 fields',
                    );
                }
                if (Object.keys(values).length === 0) throw new Error('values 是空的，没有要改的格子');

                /*
                 * 三张表的「写」不是一回事，分开算：
                 * - 子项物料：换物料要查库补齐整组、日期要转 Dayjs、行号 10 的物料不许在这儿改；
                 * - 配色 / 配码：写的是**名称列**，编码列（`{列名}_val`）由字典一起补 ——
                 *   只写名称的话，保存时 `ColorMatch.VFree6` / `SizeMatch.VFree7` 是空的。
                 */
                let fields: Record<string, unknown>;
                let notes: string[] = [];
                if (section === 'items') {
                    const patched = await buildItemPatch(values, row);
                    fields = patched.fields;
                    notes = patched.notes;
                } else if (section === 'colors') {
                    fields = buildColorPatch(ctx, values);
                } else {
                    fields = buildSizePatch(ctx, values);
                }
                if (Object.keys(fields).length === 0) return '没有要改的格子';

                // 走控件的行级命令：子项物料的行事件就在这里发出，配色 / 配码会自动跟上
                grid.updateRow(rowKey, fields);

                const rowNo = toStringOrEmpty(row.VRowNo);
                const lines = [
                    `已改「${bomMatrixSectionLabel(section)}」${rowNo ? `行号 ${rowNo} ` : ''}` +
                    `(rowId ${rowKey}) 共 ${Object.keys(fields).length} 个字段`,
                    ...notes,
                ];
                if (section === 'items') lines.push('配色 / 配码已按同一行同步');
                lines.push('改动只活在弹窗里：保存接口还没接，不会入库');
                return lines.join('；');
            },
            'matrix.add': async (params) => {
                const ctx = read();
                // 加行只对子项物料有意义：配色 / 配码是它的投影，加一行却对不上任何明细
                const grid = writableGrid(ctx, 'items');
                const rows = grid.getRows();
                const afterRowId = toStringOrEmpty(params.afterRowId).trim();
                const anchorKey = afterRowId || lastMaterialRowKey(rows);
                const anchorIndex = anchorKey
                    ? rows.findIndex((row) => rowKeyOf(row) === anchorKey)
                    : -1;
                if (afterRowId && anchorIndex < 0) {
                    throw new Error(`afterRowId=${afterRowId} 这一行不存在：先用 matrix.get 取行，确认 rowId`);
                }
                const above = anchorIndex >= 0 ? rows[anchorIndex] : undefined;
                const below = anchorIndex >= 0 ? rows[anchorIndex + 1] : undefined;
                /*
                 * 行号必须**挤进现有行号之间**（配色 / 配码靠它对齐行）：
                 * 追加取下一个 10 的倍数，插在中间取上下平均值。推不出来（上下行号相同 / 倒挂）
                 * 就如实报错，别硬塞一个重复行号。
                 */
                const rowNo = nextRowNo(above?.VRowNo, below?.VRowNo);
                if (rowNo === null) {
                    throw new Error('算不出新行号：插入位置上下两行的行号相同或顺序不对，请让用户先调整行号');
                }

                const row = createItemRow(rowNo) as Record<string, unknown>;
                const values = parseValues(params.values) ?? {};
                // 先在临时行上算好（字段不认识 / 物料查不到会在这儿就抛，不会留下半行数据）
                Object.assign(row, (await buildItemPatch(values, row)).fields);
                grid.addRow(row, anchorKey || undefined);

                return (
                    `已在「子项物料」插入一行：行号 ${rowNo}，rowId ${rowKeyOf(row)}` +
                    (toStringOrEmpty(row.MaterialCode) ? `，物料 ${toStringOrEmpty(row.MaterialCode)}` : '（还没填物料）') +
                    '；配色 / 配码已补同一行。改动只活在弹窗里：保存接口还没接，不会入库'
                );
            },
            'matrix.remove': (params) => {
                const ctx = read();
                const grid = writableGrid(ctx, 'items');
                const {rowKey, row, rows} = requireRow(grid, params.rowId);
                const rowNo = toStringOrEmpty(row.VRowNo);
                if (rowNo === '10') {
                    throw new Error('行号 10 是产成品那一行，不能删：要换产成品请用 form.set SewMaterialCode');
                }
                const index = rows.findIndex((item) => rowKeyOf(item) === rowKey);
                grid.removeRow(rowKey);
                return (
                    `已删除「子项物料」第 ${index + 1} 行（行号 ${rowNo || '空'}，rowId ${rowKey}）：` +
                    '配色 / 配码的同一行一并删除。改动只活在弹窗里：保存接口还没接，不会入库'
                );
            },
            'form.submit': async () => {
                const outcome = await read().submit();
                if (!outcome.ok) {
                    /*
                     * 原因原样抛给模型（handler 会把它放进回执的 error 字段）。
                     * 界面上的失败只有一句 toast，模型看不到 —— 只说「保存失败」等于什么都没说。
                     */
                    throw new Error(outcome.message || '保存未完成，页面没有给出原因');
                }
                return '已保存';
            },
            'form.cancel': () => {
                read().close();
                return '已关闭表单弹窗';
            },
        },
        guide: FORM_GUIDE,
        ready: () => read().isReady(),
    };
}
