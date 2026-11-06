/**
 * 工艺路线矩阵编辑弹窗的界面桥声明（页面 V0277_V0367 的 form 那一层）。
 *
 * 弹窗一打开，它顶掉页面的工具栏动作 / 查询条件 / 列表数据，成为 agent 此刻的视野；
 * 关闭后自动让位 —— 覆盖规则由桥统一实现（见 ui-bridge/handler.ts 的 composeSnapshot），
 * 这里只回答「这个弹窗有哪些字段、怎么填、提交意味着什么」，以及「下面那张工序明细怎么读写」。
 *
 * 四条约束都是**照着界面上的真实限制**来的，不是另发明一套：
 * - 上半两组物料（包装成品 / 产成品）里，只有物料编码、单位、项目、特性是手填入口，
 *   名称 / 版本 / 规格 / 型号 / 主单位都由物料档案带出 —— 手填会出现「编码是 A、名称却是 B」；
 * - 产成品的物料决定下方工序明细能不能编（弹窗里的 `canEditItems`），界面上整块蒙着；
 * - 物料编码 / 单位 / 项目 / 特性**不能只是塞一个字符串**：编码要查库带出整组、
 *   单位要从这个物料的换算单位里取、项目要查出主键、特性会把一整组字段一起填 ——
 *   所以它们是**顺序字段**（写完带出关联值），与用户在界面上的操作路径完全同一条；
 * - 工序明细的「工序编码」同理：工序是基础档案，写编码要在档案里匹配出唯一一道工序，
 *   再把名称 / 操作要求 / 检测点一起带出（与格子里敲编码回车同一条路）。
 *
 * 三条写法约束（与 V0354 / V0189 的 bridged 文件一致）：
 * - 只放常量与纯函数，不导出组件、不调 hook：弹窗把「怎么取当前状态」以取值函数传进来；
 * - 字段表 `PACK_FIELDS` / `SEW_FIELDS` **同时被弹窗的 JSX 与本文件使用**（弹窗从这里 import），
 *   所以界面上少一个字段、agent 那儿也少一条，不会出现平行维护的两份；
 * - **通用的那套别抄在这里**：批量解析、锁判断、类型转换、回执拼装都在
 *   `@/pages/agent/ui-bridge/form`（`createFormWriter`）。本文件只给字段表、锁规则与四个顺序字段。
 */

import type {FormInstance} from 'antd';
import {ncBaseApi} from '@/api/modules/nc/base.ts';
import {ncMaterialApi} from '@/api/modules/nc/material.ts';
import type {NCMaterial, NCMaterialConvert} from '@/api/schemas/nc/NCMaterial.ts';
import type {NCProject} from '@/api/schemas/nc/NCBase.ts';
import type {ProcessRouteMatrix} from '@/api/schemas/nc/processRouteMatrix.ts';
import {ensureConverts} from '@/components/nc/convertCache.ts';
import {PROCESS_ITEM_COLUMNS} from '@/components/nc/processRouteMatrix/columns.ts';
import {ProcessMoveTypeValue} from '@/components/nc/processRouteMatrix/common.ts';
import type {ProcessRouteGridApi} from '@/components/nc/processRouteMatrix/gridApi.ts';
import {nextRowNo} from '@/components/nc/processRouteMatrix/rowNo.ts';
import {
    createItemRow,
    rowHasProcess,
    rowKeyOf,
} from '@/components/nc/processRouteMatrix/rows.ts';
import {emptyWorkProcessFields, matchWorkProcess, workProcessFields} from '@/components/nc/workProcess.ts';
import {ensureWorkProcesses} from '@/components/nc/workProcessCache.ts';
import type {UIAction, UIField, UIFieldType, UIForm, UIGuide} from '@/pages/agent/protocol';
import {
    createFormWriteHandlers,
    createFormWriter,
    type FieldOutcome,
    type FormFieldSpec,
    toAgentValue,
    type UIDialogHost,
} from '@/pages/agent/ui-bridge';
import {formatDate, toNumberOrNull, toStringOrEmpty} from '@/utils';
import type {FormMode} from '../command';

/** 表单里两组字段：包装成品（4 开头物料）与产成品（3 开头物料） */
export type ProcessRouteFieldGroup = 'pack' | 'sew';

const GROUP_LABEL: Record<ProcessRouteFieldGroup, string> = {
    pack: '包装成品',
    sew: '产成品',
};

/** 只读字段的统一原因：它们全是物料的属性，手填会出现自相矛盾的数据 */
const DERIVED_BY_MATERIAL = '由物料编码带出（名称 / 版本 / 规格 / 型号 / 主单位 / 换算率），手改会出现「编码是 A、名称却是 B」';

/**
 * 一个表单字段。
 *
 * `label` 是界面上的短名（分组标题已经说明了它属于谁），`agentLabel` 是给 agent 看的全名 ——
 * 两组都有「物料编码 / 单位 / 转换率」，短名重复。桥按 label 认字段（见 `resolveFieldEntries`），
 * 不分开就会出现「设产成品的单位，写进了包装成品那一组」。
 */
export type ProcessRouteFormField = {
    /** 字段 id，就是 Form.Item 的 name */
    id: string;
    /** 界面上的标签 */
    label: string;
    /** 给 agent 看的全名：两个分组的短名重复，靠它区分 */
    agentLabel: string;
    group: ProcessRouteFieldGroup;
    type: UIFieldType;
    readOnly?: boolean;
    readOnlyReason?: string;
    /** 物料编码：界面上是 MaterialSelect（输码查库），写入要先查库再回填整组 */
    material?: ProcessRouteFieldGroup;
    /** 单位：界面上是 ConvertSelect（候选来自这个物料的换算单位） */
    convert?: ProcessRouteFieldGroup;
    /** 项目号：界面上是 ProjectSelect（输入项目号查库，带出主键） */
    project?: boolean;
    /** 特性：界面上是下拉，选中会把包装方法 / 数量 / 项目 / 缝制物料整套填好 */
    feature?: boolean;
};

/**
 * 包装成品那一组（界面上的第一组）。
 *
 * 弹窗的 JSX 直接用它渲染，所以这里少写一个字段，界面上也就少一个 —— 不会与 agent 看到的对不上。
 */
export const PACK_FIELDS: ProcessRouteFormField[] = [
    {id: 'MaterialCode', label: '物料编码', agentLabel: '包装物料编码', group: 'pack', type: 'text', material: 'pack'},
    {
        id: 'MaterialName',
        label: '物料名称',
        agentLabel: '包装物料名称',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'MaterialVersion',
        label: '物料版本',
        agentLabel: '包装物料版本',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'MaterialSpec',
        label: '物料规格',
        agentLabel: '包装物料规格',
        group: 'pack',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: DERIVED_BY_MATERIAL,
    },
    {
        id: 'MaterialModel',
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
    {id: 'ProjectCode', label: '项目', agentLabel: '项目名称', group: 'pack', type: 'text', project: true},
    /*
     * 特性 = 这个包装物料在**包装 BOM** 里已有的那一组「项目 + 包装方法 + 包装数量 +
     * 缝制物料」组合（`processRouteMatrixApi.features`）。选它不是选一个值，
     * 而是把这一组字段一次性填好 —— 手工一项项对，很容易和 BOM 那边对不上。
     * 候选随包装物料变，所以它只在快照里带 options，写入走自己的 run（见 setFeatureField）。
     */
    {id: 'Feature', label: '特性', agentLabel: '特性（包装 BOM 组合）', group: 'pack', type: 'select', feature: true},
];

/**
 * 产成品（缝制物料）那一组。
 *
 * 「物料编码」是这一组唯一的编辑入口；`SewMaterialVID` 是隐藏的关联键，不入表 ——
 * 让 agent 手填 VID 只会填出脏数据。
 *
 * 「单位」在界面上是**恒禁用**的（`disabled={!isEditable || isSew}`）：缝制物料的单位跟着
 * 物料档案走，没有单独的换算入口。所以这里如实标成只读，别让模型以为能改。
 */
export const SEW_FIELDS: ProcessRouteFormField[] = [
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
        readOnlyReason: '随缝制物料带出，界面上没有单独选单位的入口',
    },
    {
        id: 'SewCassmeasure',
        label: '单位',
        agentLabel: '产成品单位',
        group: 'sew',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: '界面上这一格恒禁用（跟着缝制物料走）：要换单位请换 SewMaterialCode',
    },
];

/** 表单里全部字段（界面顺序：包装成品 → 产成品） */
export const PROCESS_ROUTE_FORM_FIELDS: ProcessRouteFormField[] = [...PACK_FIELDS, ...SEW_FIELDS];

/** 字段 id → 字段描述：顺序字段要按 id 找它自己的说明与分组 */
const FIELD_BY_ID = new Map(PROCESS_ROUTE_FORM_FIELDS.map((field) => [field.id, field]));

/** 交给写入引擎的字段表：label 换成 agent 全名（两组短名重复，靠它区分） */
const WRITER_FIELDS: FormFieldSpec[] = PROCESS_ROUTE_FORM_FIELDS.map((field) => ({
    id: field.id,
    label: field.agentLabel,
    type: field.type,
    readOnly: field.readOnly,
    readOnlyReason: field.readOnlyReason,
}));

/**
 * 弹窗打开时给 agent 的操作说明，会覆盖页面的 guide。
 *
 * 顺序不是建议而是**界面的硬约束**：不先定产成品，下面工序明细整块禁用（界面上蒙着一层）。
 * 写在这里是为了让模型一次做对，而不是每一步撞一次锁再读报错。
 */
const FORM_GUIDE: UIGuide = {
    summary: '工艺路线矩阵表单弹窗：上半是包装成品 / 产成品的物料信息，下半是这张矩阵的工序明细',
    steps: [
        '**先定包装物料**（MaterialCode）：矩阵是「某个物料的工艺路线」，没有它连保存都过不了',
        '再看「特性」（Feature）：它把包装成品在包装 BOM 里已有的组合（项目 + 包装方法 + 包装数量 + 缝制物料）' +
        '整套填好 —— 有候选就优先用它，省得逐项手填、还容易和 BOM 那边对不上',
        '**定产成品的物料**（SewMaterialCode）：它决定下面工序明细能不能编，没有它整块是禁用状态',
        '要改多个字段就用 form.setMany 传一整张 {字段id: 新值}；只改一处用 form.set。字段 id 见 form.fields[].id',
        '物料编码 / 单位 / 项目 / 特性都可以直接写：写编码会先查库带出整组属性，写单位会从这个物料的' +
        '换算单位里取并带出换算率，写项目会查出项目主键，写特性会整套带出',
        '读工序明细用 items.get；改一格用 items.update（rowId + {字段: 新值}），加行用 items.add，删行用 items.remove',
        '**保存前会先校验**：包装物料必填、至少一行工序、有明细时产成品必填、每行要有工序编码与名称、行号不能重复。' +
        '不过就把原因原样回给你，照着改就行',
        '**保存已接后端**：form.submit 会校验 → 落库 → 按返回的主键重新取一遍详情，回执里带新的 `ProcessRouteMatrixID`',
        '不打算继续就 form.cancel 关掉弹窗',
    ],
    terms: {
        包装成品: '上半第一组：工艺路线挂在它身上（编码 4 开头），名称 / 规格 / 单位都来自物料档案',
        产成品: '上半第二组：缝制物料（编码 3 开头），工序明细就是这个物料的工艺路线',
        特性: 'Feature，包装 BOM 里这个包装物料已有的一组组合：项目_包装方法_包装数量',
        包装方法: 'PackMethod，包装方式的文字说明',
        包装数量: 'PackNum，一份包装里的数量（接口里是字符串）',
        项目: 'ProjectCode（项目编码）+ ProjectID（项目主键），界面上叫「项目」：直接写 ProjectCode 即可，查库会带出主键',
        工序明细: '下半那张表：一行一道工序（行标识 ProcessRouteMatrixDetailID）',
        行号: 'VRowNo，工序顺序的排序键（10 / 20 / 30 递增），界面上不能手改 —— 新增行会自动算',
        转移方式: 'ProcessMoveType，1=不转移 2=自动转移 3=手动转移',
    },
    cautions: [
        '保存是**真的入库**：form.submit 成功后矩阵就有了主键。items.update / add / remove 只改界面，' +
        '**不点保存就不入库**；关掉弹窗这些改动就没了 —— 别把它们当成「数据已经改好」',
        '两组的「物料编码 / 单位 / 转换率」短名重复：form.setMany 一律用字段 id（MaterialCode / SewMaterialCode / Cassmeasure），不要用中文名',
        '物料编码写的是**编码**，不是名称也不是 VID；编码查不到、或匹配到多个版本时会被如实拒绝，交给用户在界面上选',
        '产成品那一组只认 3 开头的物料，包装成品只认 4 开头的',
        '产成品没设之前工序明细是禁用的（界面上整块蒙住）：此时 items.update / add / remove 一律拒绝',
        '产成品的「单位」界面上是禁用的（跟着物料走）：要换单位就换 SewMaterialCode，别去写 SewCassmeasure',
        '特性只认候选里的值（候选来自包装 BOM，随包装物料变）；没有候选说明这个物料在包装 BOM 里还没有组合，' +
            '那就逐项填包装方法 / 包装数量 / 项目',
        '工序明细里「工序名称 / 操作要求 / 检测点 / 报告点 / 交接点」写工序编码时会按工序档案带出：' +
            '要换工序就写 CrcCode（清空它，带出的那几个字段会一起清掉）',
        '末尾那一行没有工序编码 / 名称的是**等输入的空行**，不是明细：保存时会被滤掉，别把它当成一条数据',
        '行号（VRowNo）界面上不可改：新增行由系统按 10 的步长算，写它会被拒绝',
        '发布不在这里：弹窗上的「发布」要按已落库的记录做事，而且会推送到下游 NC —— 必须由用户在界面上操作',
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
                    '{"MaterialCode":"4001","SewMaterialCode":"3001","PackMethod":"纸箱"}。字段 id 见 form.fields[].id。' +
                    '**一次传齐，不要一个字段调一次**；物料编码 / 单位 / 项目 / 特性会先按界面顺序处理，其余字段随后一次写入',
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

/** 工序明细里 agent 能改的列 —— 与界面上可编辑的格子是同一批（见 `itemView` 的 `editableFields`） */
const ITEM_WRITABLE_FIELDS = [
    'CrcCode', 'CrcName', 'CrcDesc', 'WorkStation', 'MainProcess', 'CheckPoint', 'CountPoint',
    'HandOverPoint', 'OutProcess', 'AllowAdd', 'MixDeliverNum', 'VDef9', 'WorkTime', 'VDef11',
    'VDef12', 'VDef13', 'ProcessMoveType', 'CraftNote', 'EffectDate', 'InvalidDate',
];

/**
 * 刻意**不在**可写白名单里的列：
 * - `VRowNo`：界面上这一格没有编辑器（行号是排序键，由新增行自动算，改它会和导出的工艺顺序打架）；
 * - `VDef5` / `VDef6` / `VDef7`：审核三列是后端流程的产物，界面上只读；
 * - `CrcID` / `WorkStationID`：基础档案主键，由工序档案带出，手填等于造脏数据。
 */
const ITEM_READONLY_FIELDS: Record<string, string> = {
    VRowNo: '行号是排序键，界面上不可改：新增行会自动算（10 的步长）',
    VDef5: '审核状态是后端流程的产物，界面上只读',
    VDef6: '审核人由后端写入',
    VDef7: '审核时间由后端写入',
    CrcID: '工序主键由工序档案带出：要换工序就写 CrcCode',
    WorkStationID: '工作中心主键由工序档案带出',
};

/** 布尔列：界面上是勾选框，数据源里存 1 / 0（与表格写回一致） */
const ITEM_BOOLEAN_FIELDS = new Set([
    'MainProcess', 'CheckPoint', 'CountPoint', 'HandOverPoint', 'OutProcess', 'AllowAdd',
]);

/** 数字列：schema 里是 number 的那几列 */
const ITEM_NUMBER_FIELDS = new Set(['MixDeliverNum', 'VDef9', 'WorkTime', 'VDef11', 'VDef12', 'VDef13']);

/** 日期列：schema 里是 `YYYY-MM-DD` 字符串 */
const ITEM_DATE_FIELDS = new Set(['EffectDate', 'InvalidDate']);

/** 弹窗打开时的动作表：改字段 / 读工序明细 / 改工序明细 / 保存 / 关闭 */
function formActions(): UIAction[] {
    return [
        ...FORM_WRITE_ACTIONS,
        {
            // 纯读：回执立刻发（不用等弹窗落定），也不推 rev
            id: 'items.get',
            label: '读取工序明细行',
            group: 'form',
            returns: 'result',
            params: [
                {
                    name: 'limit',
                    type: 'number',
                    hint: '最多返回多少行，默认 50、上限 200；只要几行就传几行，别习惯性取满',
                },
            ],
        },
        {
            id: 'items.update',
            label: '改工序明细行的若干格',
            group: 'form',
            params: [
                {
                    name: 'rowId',
                    type: 'text',
                    required: true,
                    hint: '行的 rowId（items.get 返回的那个），**不是行号**',
                },
                {
                    name: 'values',
                    type: 'object',
                    required: true,
                    hint: `字段 → 新值（对象或它的 JSON 字符串）。可写：${ITEM_WRITABLE_FIELDS.join(' / ')}；` +
                        '写 CrcCode 会按工序档案把名称 / 操作要求 / 检测点一起带出',
                },
            ],
        },
        {
            id: 'items.add',
            label: '在工序明细里插入一行',
            group: 'form',
            params: [
                {
                    name: 'values',
                    type: 'object',
                    hint: '新行的字段（可只给 CrcCode，名称 / 操作要求会按工序档案带出；行号不给就自动算）。可写字段同 items.update',
                },
                {
                    name: 'afterRowId',
                    type: 'text',
                    hint: '插在这一行后面；不给就插在最后一行有工序的后面（末尾那行是待输入的空行）',
                },
            ],
        },
        {
            id: 'items.remove',
            label: '删除工序明细的一行',
            group: 'form',
            params: [
                {
                    name: 'rowId',
                    type: 'text',
                    required: true,
                    hint: '要删的行 rowId',
                },
            ],
        },
        {id: 'form.submit', label: '保存', group: 'form'},
        {id: 'form.cancel', label: '取消（关闭弹窗）', group: 'form'},
    ];
}

/** 列定义里可能出现的形状（原生列与项目列定义都覆盖） */
type ColumnLike = {
    field?: unknown;
    title?: unknown;
    children?: unknown;
    columns?: unknown;
};

/** 列定义 → 叶子列（field + 列头）：分组表头本身不是一列 */
function flattenColumns(columns: unknown[]): Array<{ field: string; title: string }> {
    const result: Array<{ field: string; title: string }> = [];
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

/** 工序明细的列目录（与屏幕共用 `PROCESS_ITEM_COLUMNS`，不另写一份） */
const ITEM_FIELDS = flattenColumns(PROCESS_ITEM_COLUMNS);

/** 一行只留非空的列：二十几列里通常一半是空的，键名往往比值还贵 */
function pickCells(row: Record<string, unknown>): Record<string, unknown> {
    const cells: Record<string, unknown> = {
        rowId: rowKeyOf(row),
        // 末尾那行等输入的空行也在这里，标出来免得模型把它当一条明细
        hasProcess: rowHasProcess(row),
    };
    ITEM_FIELDS.forEach(({field}) => {
        const value = row[field];
        if (value === null || value === undefined || value === '') return;
        cells[field] = value;
    });
    return cells;
}

/** 取整并夹到区间内（模型给 1e9 或 -5 都不该让弹窗去算半天） */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Math.floor(toNumberOrNull(value) ?? fallback);
    if (num < min) return min;
    if (num > max) return max;
    return num;
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

/** 字典 / 候选的可选值提示：列全了反而淹没重点，截断前 20 个 */
function describeOptions(names: string[]): string {
    if (names.length === 0) return '（当前没有可选值）';
    return names.length <= 20 ? names.join(' / ') : `${names.slice(0, 20).join(' / ')} 等 ${names.length} 个`;
}

/** 编码前缀：产成品是 3 开头的缝制物料，包装成品是 4 开头的包装物料（与 MaterialSelect 的 filter 一致） */
function codePrefix(group: ProcessRouteFieldGroup): string {
    return group === 'sew' ? '3' : '4';
}

/**
 * 物料编码：写完**按编码查库**，把整组属性带出来（等价于用户在界面上用物料选择器选中）。
 *
 * 三种情况只有一条能过：正好命中一条同前缀的物料。零条 / 多条都请用户手动选 ——
 * 替它挑一条等于赌运气，赌错了要等到保存才发现，更难查。
 */
async function setMaterialField(
    ctx: ProcessRouteEditBridgeContext,
    field: ProcessRouteFormField,
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
     * 回填交给弹窗的 apply（那是界面自己的规则：一组字段怎么带、产成品还要重取特性候选）。
     * 桥再抄一份必然与界面漂移。
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
    ctx: ProcessRouteEditBridgeContext,
    field: ProcessRouteFormField,
    value: unknown,
): Promise<FieldOutcome> {
    const unit = toStringOrEmpty(value).trim();
    if (!unit) {
        return {ok: false, message: `未设置「${field.agentLabel}」：单位不能清空，请让用户在界面上选一个`};
    }
    const group = field.convert ?? field.group;
    const materialVID = toStringOrEmpty(
        ctx.form.getFieldValue(group === 'sew' ? 'SewMaterialVID' : 'MaterialVID'),
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
    const hit = converts.find((item) => toStringOrEmpty(item.measdoc).trim() === unit);
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

/**
 * 项目号：写完**按号查库**，把项目主键一起带出来（等价于用户在界面上输入项目号回车）。
 *
 * 为什么非查不可：`ProjectCode` 只是表单里一个文本框，`setFieldsValue` 塞个字符串进去
 * **不会报任何错** —— 不查库的话，agent 写一个根本不存在的项目号也会收到「已设置」，
 * 一直到点保存才被「请选择项目」挡下，中间那几步全是假的。
 *
 * 三种结果只有一条能过：正好命中一条 → 写编码 + 主键；零条 / 多条都拒（替它挑一条等于赌运气）。
 */
async function setProjectField(
    ctx: ProcessRouteEditBridgeContext,
    field: ProcessRouteFormField,
    value: unknown,
): Promise<FieldOutcome> {
    const keyword = toStringOrEmpty(value).trim();
    if (!keyword) {
        return {
            ok: false,
            message: `未设置「${field.agentLabel}」：清空项目请让用户在界面上点输入框的 ×（项目主键要一起清）`,
        };
    }
    let list: NCProject[] = [];
    try {
        list = (await ncBaseApi.projectByName(keyword)).data ?? [];
    } catch {
        return {
            ok: false,
            message: `未设置「${field.agentLabel}」= ${keyword}：按项目号查库失败了（网络 / 后端），稍后重试`,
        };
    }
    /*
     * 接口是模糊查（名称也能命中）：只有**全等**才算数。
     * 拿「返回的第一条」当答案，输入 2024 这种片段就会指到一个不相干的项目上。
     */
    const matched = list.filter(
        (project) =>
            toStringOrEmpty(project.project_code).trim() === keyword
            || toStringOrEmpty(project.project_name).trim() === keyword,
    );
    if (matched.length === 0) {
        return {
            ok: false,
            message:
                `未设置「${field.agentLabel}」= ${keyword}：查不到这个项目号 / 项目名称` +
                (list.length > 0 ? `（有 ${list.length} 个近似结果，但没有一条与它完全相同）` : '') +
                '。请换完整项目号，或让用户在界面上用项目选择器选',
        };
    }
    if (matched.length > 1) {
        return {
            ok: false,
            message:
                `未设置「${field.agentLabel}」= ${keyword}：命中 ${matched.length} 个项目（不同分类同号），` +
                '请让用户在界面上用项目选择器挑一个',
        };
    }
    const project = matched[0];
    ctx.applyProject(project);
    return {
        ok: true,
        message:
            `已设置「${field.agentLabel}」= ${toStringOrEmpty(project.project_name)}` +
            `（项目号 ${toStringOrEmpty(project.project_code)}），项目主键已一起带出`,
    };
}

/**
 * 特性：只认候选里的值（候选来自包装 BOM 的组合，随包装物料变）。
 *
 * 不做「模糊匹配」：`Feature` 本身就是 `项目_包装方法_包装数量` 拼出来的串，
 * 相近的串大多指向另一份组合 —— 选中它会静默改掉包装方法 / 数量 / 项目 / 缝制物料四件事。
 */
function setFeatureField(
    ctx: ProcessRouteEditBridgeContext,
    field: ProcessRouteFormField,
    value: unknown,
): FieldOutcome {
    const feature = toStringOrEmpty(value).trim();
    const options = ctx.featureOptions();
    if (!feature) {
        return {
            ok: false,
            message: `未设置「${field.agentLabel}」：清空请让用户在界面上点下拉的 ×（那一格可以空着）`,
        };
    }
    if (options.length === 0) {
        return {
            ok: false,
            message:
                `未设置「${field.agentLabel}」= ${feature}：当前没有候选` +
                '（要先有包装物料编码，且这个物料在包装 BOM 里有组合），请让用户先定包装物料',
        };
    }
    if (!options.includes(feature)) {
        return {
            ok: false,
            message:
                `未设置「${field.agentLabel}」= ${feature}：不在候选里（候选是包装 BOM 里这个物料已有的组合）。` +
                `可选 ${describeOptions(options)}`,
        };
    }
    ctx.applyFeature(feature);
    return {
        ok: true,
        message: `已设置「${field.agentLabel}」= ${feature}，包装方法 / 包装数量 / 项目 / 缝制物料已一起带出`,
    };
}

/** 字段 → 顺序字段的处理：物料编码查库带出整组，单位取换算单位，项目号查库，特性整套填 */
async function setManySpecial(
    ctx: ProcessRouteEditBridgeContext,
    fieldId: string,
    value: unknown,
): Promise<FieldOutcome> {
    const field = FIELD_BY_ID.get(fieldId);
    if (!field) return {ok: false, message: `表单没有字段「${fieldId}」`};
    if (field.material) return await setMaterialField(ctx, field, value);
    if (field.convert) return await setConvertField(ctx, field, value);
    if (field.project) return await setProjectField(ctx, field, value);
    if (field.feature) return setFeatureField(ctx, field, value);
    return {ok: false, message: `字段「${field.agentLabel}」不需要顺序处理`};
}

/** 清空工序编码时要一起清掉的字段（与 `workProcessFields` 成对，见 `emptyWorkProcessFields`） */
const EMPTY_AFTER_CRC = emptyWorkProcessFields();

/**
 * 工序编码：在**全量工序档案**里匹配一道工序，把名称 / 操作要求 / 检测点一起带出。
 *
 * 工序没有「按编码查一条」的接口（只有全量列表），所以这条路与格子里敲编码回车完全一致：
 * 全等优先、其次唯一包含匹配；多条 / 零条都拒绝 —— 替它选一条等于赌运气。
 */
async function resolveCrcCode(value: unknown): Promise<{ fields: Record<string, unknown>; note: string }> {
    const text = toStringOrEmpty(value).trim();
    if (!text) {
        return {
            fields: {CrcCode: '', ...EMPTY_AFTER_CRC},
            note: '工序已清空：名称 / 描述 / 操作要求 / 检测点等一并清掉',
        };
    }
    const list = await ensureWorkProcesses();
    if (list.length === 0) {
        throw new Error('基本工序档案没取到（网络 / 后端）：稍后重试，或让用户在格子里点搜索按钮选');
    }
    const matched = matchWorkProcess(list, text);
    if (matched.kind === 'none') {
        throw new Error(`工序档案里没有编码或名称匹配「${text}」的工序：确认编码是否正确，或让用户在格子里点搜索按钮选`);
    }
    if (matched.kind === 'many') {
        throw new Error(
            `「${text}」匹配到 ${matched.candidates} 道工序：请让用户在格子里点搜索按钮挑一道（替它选一条等于赌运气）`,
        );
    }
    const process = matched.process;
    return {
        fields: workProcessFields(process),
        note: `工序 = ${toStringOrEmpty(process.CrcCode)} ${toStringOrEmpty(process.CrcName)}，名称 / 操作要求 / 检测点一并带出`,
    };
}

/** 把 agent 给的值转成这一列该有的形态（布尔 / 数字 / 日期 / 枚举 / 字符串） */
function coerceItemValue(
    field: string,
    value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
    if (ITEM_BOOLEAN_FIELDS.has(field)) {
        if (typeof value === 'boolean') return {ok: true, value: value ? 1 : 0};
        const text = toStringOrEmpty(value).trim().toLowerCase();
        const truthy = text === '1' || text === 'true' || text === '是' || text === 'y';
        const falsy = text === '0' || text === 'false' || text === '否' || text === 'n';
        if (!truthy && !falsy) return {ok: false, reason: '是勾选列，只能填 true / false（或 1 / 0）'};
        return {ok: true, value: truthy ? 1 : 0};
    }
    if (field === 'ProcessMoveType') {
        const num = toNumberOrNull(value);
        if (num !== null) {
            if (![1, 2, 3].includes(num)) {
                return {ok: false, reason: '只能是 1=不转移 / 2=自动转移 / 3=手动转移'};
            }
            return {ok: true, value: num};
        }
        const fromLabel = ProcessMoveTypeValue(toStringOrEmpty(value).trim());
        if (!fromLabel) return {ok: false, reason: '只能是 1=不转移 / 2=自动转移 / 3=手动转移（或这三个中文名）'};
        return {ok: true, value: fromLabel};
    }
    if (ITEM_NUMBER_FIELDS.has(field)) {
        const num = toNumberOrNull(value);
        if (num === null) return {ok: false, reason: '不是数字'};
        return {ok: true, value: num};
    }
    if (ITEM_DATE_FIELDS.has(field)) {
        const text = toStringOrEmpty(value).trim();
        if (!text) return {ok: true, value: ''};
        const date = formatDate(text);
        if (!date) return {ok: false, reason: '不是日期，格式要 YYYY-MM-DD'};
        return {ok: true, value: date};
    }
    return {ok: true, value: toStringOrEmpty(value)};
}

/**
 * 工序明细的一批改动 → 真正要写进这一行的字段。
 *
 * **工序编码先写**：名称 / 操作要求 / 检测点的候选都挂在它上面。不排序的话，
 * `{CraftNote: "x", CrcCode: "CZ001"}` 会先写操作要求、再被工序档案覆盖掉 ——
 * 而模型的入参顺序是随机的。
 */
async function buildItemPatch(
    values: Record<string, unknown>,
): Promise<{ fields: Record<string, unknown>; notes: string[] }> {
    const fields: Record<string, unknown> = {};
    const notes: string[] = [];
    const ordered = [
        ...Object.entries(values).filter(([field]) => field === 'CrcCode'),
        ...Object.entries(values).filter(([field]) => field !== 'CrcCode'),
    ];

    for (const [field, raw] of ordered) {
        if (!ITEM_WRITABLE_FIELDS.includes(field)) {
            const readonly = ITEM_READONLY_FIELDS[field];
            throw new Error(
                readonly
                    ? `「${field}」不能改：${readonly}`
                    : `工序明细里没有可编辑的列「${field}」。可写：${ITEM_WRITABLE_FIELDS.join(' / ')}`,
            );
        }
        if (field === 'CrcCode') {
            const resolved = await resolveCrcCode(raw);
            Object.assign(fields, resolved.fields);
            notes.push(resolved.note);
            continue;
        }
        const coerced = coerceItemValue(field, raw);
        if (!coerced.ok) throw new Error(`「${field}」${coerced.reason}`);
        fields[field] = coerced.value;
    }
    return {fields, notes};
}

/** 写操作前的统一闸：能编 + 详情已到 + 这张表真的渲染了 */
function writableGrid(ctx: ProcessRouteEditBridgeContext): ProcessRouteGridApi {
    const lock = ctx.itemsEditLock();
    if (lock) throw new Error(`工序明细当前不可编辑：${lock}`);
    if (!ctx.isReady()) {
        throw new Error('矩阵详情还在加载：等它回来再改（那之后整表会重铺，现在改了也留不住）');
    }
    const grid = ctx.readGrid();
    if (!grid) {
        throw new Error('工序明细表还没渲染出来：稍后重试；反复不行就让用户在界面上看一眼');
    }
    return grid;
}

/** 按 rowId 找行；找不到就把「有哪些行」说清楚（模型常把行号当 rowId 传） */
function requireRow(
    grid: ProcessRouteGridApi,
    rowId: unknown,
): { rowKey: string; row: Record<string, unknown>; rows: Array<Record<string, unknown>> } {
    const rows = grid.getRows();
    const key = toStringOrEmpty(rowId).trim();
    if (!key) throw new Error('需要 rowId（items.get 返回的 rowId，不是行号）');
    const row = rows.find((item) => rowKeyOf(item) === key);
    if (!row) {
        const sample = rows
            .slice(0, 8)
            .map((item) => `${rowKeyOf(item)}（行号 ${toStringOrEmpty(item.VRowNo) || '空'}）`)
            .join('、');
        throw new Error(
            `这张表里没有 rowId=${key} 的行。现有行：${sample || '（这张表一行都没有）'}` +
            '。rowId 请用 items.get 返回的那个，不要用行号',
        );
    }
    return {rowKey: key, row, rows};
}

/**
 * 默认插入点：最后一个**有工序**的行的 rowId。
 *
 * 工序明细表在编辑态末尾永远留一行等待输入的空行（见 itemView 的补空行逻辑），
 * 直接追加到末尾会排在那行空行后面 —— 看起来像是「加了一行却没出现」。
 */
function lastProcessRowKey(rows: Array<Record<string, unknown>>): string {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rowHasProcess(rows[index])) return rowKeyOf(rows[index]);
    }
    return '';
}

/** 字段此刻的样子：取值、锁、报错、界面位置提示 */
function currentFields(
    ctx: ProcessRouteEditBridgeContext,
): UIField[] {
    const {form} = ctx;
    const values = form.getFieldsValue();
    const errorMap = new Map<string, string[]>();
    form.getFieldsError().forEach((item) => {
        if (item.errors.length === 0) return;
        errorMap.set(String(item.name), item.errors);
    });
    const featureOptions = ctx.featureOptions();
    return PROCESS_ROUTE_FORM_FIELDS.map((field) => {
        const spec: UIField = {
            id: field.id,
            label: field.agentLabel,
            type: field.type,
            value: toAgentValue(values[field.id]),
            // 界面上锁住的字段，快照里也如实标成只读 —— 让它一眼看出「现在还不能改」，
            // 而不是设一次被拒一次
            readOnly: field.readOnly || ctx.fieldLock(field.id) !== null,
            errors: errorMap.get(field.id),
        };
        if (field.feature) spec.options = featureOptions;
        if (field.readOnly) spec.hint = field.readOnlyReason;
        else if (field.material) spec.hint = `界面上的「${field.label}」（${GROUP_LABEL[field.group]}那一组）：填编码会先查库，带出整组物料属性`;
        else if (field.convert) spec.hint = `界面上的「${field.label}」：只能从这个物料的换算单位里选，写进去会带出换算率`;
        else if (field.project) spec.hint = `界面上的「${field.label}」：写项目号会先查库，查到就把项目主键（ProjectID）一起带出 —— 只写它就够`;
        else if (field.feature) spec.hint = '界面上是下拉：候选是包装 BOM 里这个包装物料已有的组合，选中会把项目 / 包装方法 / 数量 / 缝制物料整套填好';
        else spec.hint = `界面上的「${field.label}」（${GROUP_LABEL[field.group]}那一组）`;
        return spec;
    });
}

/** 弹窗交给桥的东西：只有状态与能力，没有桥的结构 */
export type ProcessRouteEditBridgeContext = {
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
     * 未就绪时表格是**卸载**状态，读与写都要先拒绝。
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
    applyMaterial: (group: ProcessRouteFieldGroup, material: NCMaterial) => void;
    /** 按换算单位把「单位 + 换算率」一起写进去（与界面上选单位同一条路） */
    applyConvert: (group: ProcessRouteFieldGroup, convert: NCMaterialConvert) => void;
    /** 按项目把「项目编码 + 项目主键」一起写进去（与界面上选中项目同一条路） */
    applyProject: (project: NCProject) => void;
    /** 选中一个特性：把包装方法 / 数量 / 项目 / 缝制物料整套填好（与界面上选下拉同一条路） */
    applyFeature: (feature: string) => void;
    /** 特性下拉的候选值（`项目_包装方法_包装数量`；没选包装物料时是空数组） */
    featureOptions: () => string[];
    /** 当前矩阵（弹窗派生后的那份） */
    matrix: ProcessRouteMatrix;
    /** 当前标签页（受控在弹窗里，控件自己不存） */
    activeKey: string;
    setActiveKey: (key: string) => void;
    /** 工序明细的当前行（含未保存的编辑与末尾那行空行） */
    readRows: () => Array<Record<string, unknown>>;
    /**
     * 工序明细的**行级写能力**（`addRow` / `removeRow` / `updateRow` / `getRows`）。
     *
     * 详情没到 / 表格没渲染时是 null —— 写必须落到真实的表上，
     * 往现算出来的临时数组里写，屏幕上什么都不会变。
     */
    readGrid: () => ProcessRouteGridApi | null;
    /**
     * 工序明细此刻为什么不能编（null = 能编）。
     *
     * 与界面上那层蒙层同一条判据（弹窗的 `canEditItems`）：查看模式恒只读；
     * 其余模式要求先选产成品。桥不自己另算，否则会出现「界面蒙着、agent 却能改」。
     */
    itemsEditLock: () => string | null;
    /**
     * 保存。`ok=false` 时 `message` 是**可修复的原因**（或「存了但没回主键」的事实说明）。
     *
     * 走的是界面上「保存」的同一条路（校验 → 落库 → 按新主键重取）：
     * - 成功 → `ok: true`，`message` 里带新的 `ProcessRouteMatrixID`；
     * - 校验不过 / 存失败 → `ok: false` + 原因。
     *
     * **`ok` 只在真的入库后才为 true**：模型拿它决定「已保存」还是「回去改」，
     * 谎报成功它会去核对一份不存在的记录。
     */
    submit: () => Promise<{ ok: boolean; message: string; issues?: string[] }>;
    close: () => void;
};

/**
 * 装配弹窗的界面桥宿主。
 *
 * 吃的是**取值函数**而不是 ctx 对象本身：字段表、动作表、就绪状态都在被调用的那一刻才读，
 * 所以宿主对象不必跟着每次渲染重建，读到的也永远是最新的表单内容。
 */
export function createProcessRouteEditBridge(read: () => ProcessRouteEditBridgeContext): UIDialogHost {
    /*
     * 写入引擎：批量解析、锁判断、类型转换、回执都在 `@/pages/agent/ui-bridge/form`。
     * 这里只交出本表单的字段表、锁规则，以及四个「写完还有后续动作」的字段。
     */
    const writer = createFormWriter({
        fields: () => WRITER_FIELDS,
        fieldLock: (fieldId) => read().fieldLock(fieldId),
        write: (patch) => read().form.setFieldsValue(patch),
        /*
         * 顺序字段：物料编码 / 单位 / 项目 / 特性。它们在界面上都不是「随便填一个字符串」——
         * 编码要查库带出整组属性、单位要取这个物料的换算单位、项目号要查库带出主键、
         * 特性会把四五个字段一起填，所以走各自的 run（判据与界面上的控件一致，见字段表的标记）。
         *
         * **不标 `unlocksOthers`**：本弹窗没有「写完这个字段，别的字段才解锁」的情形 ——
         * 表单字段的锁只跟查看模式 / 详情加载有关（`fieldLock`），工序明细的锁由
         * `itemsEditLock` 单独判断（它看产成品选没选）。标上只会让一次 setMany 白等一轮摘锁。
         */
        sequenced: PROCESS_ROUTE_FORM_FIELDS
            .filter((field) => field.material || field.convert || field.project || field.feature)
            .map((field) => ({
                id: field.id,
                run: (value: unknown): Promise<FieldOutcome> => setManySpecial(read(), field.id, value),
            })),
    });

    return {
        snapshot: (): UIForm => {
            const ctx = read();
            return {
                id: 'processRouteMatrixEdit',
                title: ctx.title,
                mode: ctx.mode,
                recordId: ctx.recordId,
                // 字段表与 writer 读的是同一份描述（id / label / type / 锁），不会一处有一处无
                fields: currentFields(ctx),
                // 详情加载失败这类不属于任何字段：界面只在表格位置画一句提示，模型看不到
                errors: ctx.isReady() ? [] : ['矩阵详情还在加载：字段与工序明细会整体重铺，等它就绪再改'],
            };
        },
        actions: () => formActions(),
        handlers: {
            // 改字段的两条由桥的通用实现接管：参数解析、锁判断、回执都在那一层
            ...createFormWriteHandlers(writer),
            'items.get': (params) => {
                const ctx = read();
                if (!ctx.isReady()) {
                    throw new Error('矩阵详情还在加载：等它回来再读（现在读到的是空表，不是「没有工序」）');
                }
                const rows = ctx.readRows();
                /*
                 * 详情刚到、表格还没挂载的那一帧：行数据是从控件的 ref 上取的，ref 还是 null。
                 * 这时回 `total: 0` 会让模型以为这份矩阵没有工序 —— 如实说「还没渲染」。
                 */
                if (rows.length === 0 && (ctx.matrix.Detail ?? []).length > 0 && !ctx.readGrid()) {
                    throw new Error('工序明细表还在渲染（详情已到、表格刚挂载）：稍后重试一次');
                }
                const limit = clampInt(params.limit, 50, 1, 200);
                const picked = rows.slice(0, limit).map(pickCells);
                return {
                    total: rows.length,
                    count: picked.length,
                    hasMore: picked.length < rows.length,
                    fields: ITEM_FIELDS,
                    writableFields: ITEM_WRITABLE_FIELDS,
                    rows: picked,
                    note:
                        '空值不出现（省略即未填，不是 0）；rowId 是明细主键，不是行号；' +
                        'hasProcess=false 的行是末尾那行「等输入」的空行，不算明细、保存时会被滤掉；' +
                        '改动用 items.update / add / remove，**不点保存就不入库**',
                };
            },
            'items.update': async (params) => {
                const ctx = read();
                const grid = writableGrid(ctx);
                const {rowKey, row} = requireRow(grid, params.rowId);
                const values = parseValues(params.values);
                if (!values) {
                    throw new Error('需要 values：{字段: 新值}（对象或它的 JSON 字符串），字段见 items.get 返回的 fields');
                }
                if (Object.keys(values).length === 0) throw new Error('values 是空的，没有要改的格子');

                const {fields, notes} = await buildItemPatch(values);
                if (Object.keys(fields).length === 0) return '没有要改的格子';
                // 走控件的行级命令：表格的数据源才会跟着更新（直接改数组屏幕上什么都不动）
                grid.updateRow(rowKey, fields);

                const rowNo = toStringOrEmpty(row.VRowNo);
                return [
                    `已改工序明细${rowNo ? `行号 ${rowNo} ` : ''}(rowId ${rowKey}) 共 ${Object.keys(fields).length} 个字段`,
                    ...notes,
                    '改动只活在弹窗里：点「保存」（form.submit）才会入库',
                ].join('；');
            },
            'items.add': async (params) => {
                const ctx = read();
                const grid = writableGrid(ctx);
                const rows = grid.getRows();
                const afterRowId = toStringOrEmpty(params.afterRowId).trim();
                const anchorKey = afterRowId || lastProcessRowKey(rows);
                const anchorIndex = anchorKey
                    ? rows.findIndex((row) => rowKeyOf(row) === anchorKey)
                    : -1;
                if (afterRowId && anchorIndex < 0) {
                    throw new Error(`afterRowId=${afterRowId} 这一行不存在：先用 items.get 取行，确认 rowId`);
                }
                const above = anchorIndex >= 0 ? rows[anchorIndex] : undefined;
                const below = anchorIndex >= 0 ? rows[anchorIndex + 1] : undefined;
                /*
                 * 行号必须**挤进现有行号之间**（它决定工序顺序）：
                 * 追加取下一个 10 的倍数，插在中间取上下平均值。推不出来（上下行号相同 / 倒挂）
                 * 就如实报错，别硬塞一个重复行号 —— 保存时会被校验挡下。
                 */
                const rowNo = nextRowNo(above?.VRowNo, below?.VRowNo);
                if (rowNo === null) {
                    throw new Error('算不出新行号：插入位置上下两行的行号相同或顺序不对，请让用户先调整行号');
                }

                const row = createItemRow(rowNo) as Record<string, unknown>;
                const values = parseValues(params.values) ?? {};
                // 先在临时行上算好（字段不认识 / 工序匹配不到会在这儿就抛，不会留下半行数据）
                Object.assign(row, (await buildItemPatch(values)).fields);
                grid.addRow(row, anchorKey || undefined);

                return (
                    `已插入一行：行号 ${rowNo}，rowId ${rowKeyOf(row)}` +
                    (rowHasProcess(row) ? `，工序 ${toStringOrEmpty(row.CrcCode)}` : '（还没填工序）') +
                    '。改动只活在弹窗里：点「保存」（form.submit）才会入库'
                );
            },
            'items.remove': (params) => {
                const ctx = read();
                const grid = writableGrid(ctx);
                const {rowKey, row, rows} = requireRow(grid, params.rowId);
                const index = rows.findIndex((item) => rowKeyOf(item) === rowKey);
                grid.removeRow(rowKey);
                return (
                    `已删除工序明细第 ${index + 1} 行（行号 ${toStringOrEmpty(row.VRowNo) || '空'}，rowId ${rowKey}）：` +
                    '改动只活在弹窗里，点「保存」（form.submit）才会入库'
                );
            },
            'form.submit': async () => {
                const outcome = await read().submit();
                if (!outcome.ok) {
                    /*
                     * 原因原样抛给模型（handler 会把它放进回执的 error 字段）。
                     * 界面上的失败只有一句 toast / 一个警告框，模型看不到 —— 只说「保存失败」等于什么都没说。
                     */
                    throw new Error(outcome.message || '保存未完成，弹窗没有给出原因');
                }
                // 成功也回原文：里面有新的 ProcessRouteMatrixID，模型接下来核对照它
                return outcome.message || '已保存';
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
