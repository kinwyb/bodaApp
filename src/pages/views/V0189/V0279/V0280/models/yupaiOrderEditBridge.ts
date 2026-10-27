/**
 * 预订单编辑弹窗的界面桥声明（页面 V0189_V0279_V0280 的 form 那一层）。
 *
 * 弹窗一打开，它顶掉页面的工具栏动作 / 筛选条件 / 列表数据，成为 agent 此刻的视野；
 * 关闭后自动让位 —— 覆盖规则由桥统一实现（见 ui-bridge/handler.ts 的 composeSnapshot），
 * 这里只负责回答「这个弹窗有哪些字段、怎么填、提交意味着什么」。
 *
 * 三条约束，都是**照着界面上的真实限制**来的，不是另发明一套：
 * - 新增/复制下，订单号必须**检测可用**之后，日期与明细才解锁（界面上是同样的顺序）；
 * - 能确定的就替 agent 设进去（订单号带出业务员、枚举字段校验取值），
 *   确定不了的**不硬设**，回执里请用户手动设置 —— 硬塞一个错误值只会让保存时更难查；
 * - 明细不逐格设置，而是**整份替换数据源**（detail.get 拿现状 → 改 → detail.set 写回）。
 *
 * 两条写法约束：
 * - 只放常量与纯函数，不导出组件、不调 hook：弹窗把「怎么取当前状态」以取值函数传进来。
 * - 字段表 `formFields` 与弹窗 JSX 里的 `<Field label>` / `Form.Item rules` 是同一份信息的
 *   两种表达（属于平行维护）：本表单用自定义 Field 布局，没有 antd 的 label 可读。
 */

import type {FormInstance} from 'antd';
import dayjs from 'dayjs';
import {employeeApi} from '@/api';
import type {UIAction, UIFieldType, UIForm, UIGuide} from '@/pages/agent/protocol';
import type {UIDialogHost} from '@/pages/agent/ui-bridge';
import {DATE_FORMAT, toDayjs, toStringOrEmpty} from '@/utils';
import type {FormMode} from '../command';
import {DETAIL_COLUMNS, HD_WORK_OPTIONS, type yupaiOrderDetailRow} from './yupaiOrderEditColumns';
import type {yupaiOrderFormValues} from './yupaiOrderEdit';

/** 一个表单字段：取值在运行时从 form 实例读，这里只描述「有哪些字段、怎么填」 */
interface yupaiOrderFormField {
    /** 字段 id，就是 Form.Item 的 name */
    id: string;
    label: string;
    /**
     * 控件类型。直接用协议里的 `UIFieldType` 字面量，不另外发明一套枚举 ——
     * 两边各写一份，迟早会悄悄跑偏。
     */
    kind: UIFieldType;
    value?: unknown;
    required?: boolean;
    readOnly?: boolean;
    options?: string[];
    errors?: string[];
}

/**
 * agent 能看到的字段表。
 *
 * 隐藏字段（YwyNo / DepartmentID）不入表：它们由业务员带出来，让 agent 单独填只会填出脏数据。
 * 明细不在这里 —— 它走 detail.get / detail.set，见 DETAIL_FIELDS。
 */
const formFields = (workPlaces: string[]): Omit<yupaiOrderFormField, 'value' | 'errors'>[] => [
    {id: 'OrderCode', label: '订单号', kind: 'text', required: true},
    {id: 'YPDate', label: '预排日期', kind: 'date', required: true},
    {id: 'Ywy', label: '业务员', kind: 'text', required: true},
    {id: 'WorkPlace', label: '产地', kind: 'select', required: true, options: workPlaces},
    {id: 'JHDate', label: '计划下单日期', kind: 'date', required: true},
    {id: 'QRDate', label: '确认可下单期', kind: 'date'},
    {id: 'WCDate', label: '尾货期', kind: 'date'},
    {id: 'ZHDate', label: '走货期', kind: 'date', required: true},
    {id: 'YLDate', label: '原料可下单期', kind: 'date', required: true},
    {id: 'FLDate', label: '缝制辅料可下单期', kind: 'date', required: true},
    {id: 'BZFLDate', label: '包装辅料提供期', kind: 'date', required: true},
    {id: 'XDRate', label: '下单把握率', kind: 'text'},
    {id: 'Qty', label: '总数量', kind: 'number', readOnly: true},
    {id: 'Memo', label: '备注', kind: 'text'},
    {id: 'ZQCheckDate', label: '中期检验日期', kind: 'date'},
    {id: 'ZQCheckMemo', label: '中期检验要求', kind: 'text'},
];

/**
 * 明细能填的字段：直接由列定义推导，不另维护一份。
 *
 * 数值列（dataType int/double）在数据源里「未填 = null」；后道主工序是枚举。
 */
const DETAIL_FIELDS: Array<{field: string; label: string; type: UIFieldType; options?: string[]}> =
    DETAIL_COLUMNS.map((column) => ({
        field: column.field,
        label: String(column.title ?? column.field),
        type:
            column.dataType === 'int' || column.dataType === 'double'
                ? 'number'
                : column.field === 'HDWorkName'
                    ? 'select'
                    : 'text',
        options: column.field === 'HDWorkName' ? HD_WORK_OPTIONS.map((item) => item.value) : undefined,
    }));

/** 明细里不归用户填的内部字段：写回时原样带回来，别让 agent 改 */
const DETAIL_NUMERIC_FIELDS = new Set(
    DETAIL_FIELDS.filter((item) => item.type === 'number').map((item) => item.field),
);

/** 交给 agent 的取值：日期转成 YYYY-MM-DD 字符串 —— 模型读得懂，也填得回来 */
function toAgentValue(value: unknown): unknown {
    if (dayjs.isDayjs(value)) return value.format(DATE_FORMAT);
    return value ?? null;
}

/**
 * 弹窗打开时给 agent 的操作说明，会覆盖页面的 guide。
 *
 * 顺序不是建议而是**界面的硬约束**：新增/复制下没把订单号检测通过，日期与明细根本改不了。
 * 写在这里是为了让模型一次做对，而不是每一步都撞一次锁再读报错。
 */
const FORM_GUIDE: UIGuide = {
    summary: '预订单表单弹窗：主信息 + 明细行一起保存成一张单据',
    steps: [
        '新增 / 复制：先 form.set OrderCode。写入后会自动检测——可用才解锁日期与明细；被占用就换号（回执会说被谁用了）',
        '再逐项 form.set 日期（YYYY-MM-DD）。业务员、产地这类只能从界面选项里选的，取值不确定就问用户，别猜',
        '明细整份写回：detail.get 拿现有行与字段 → 改 → detail.set 把整份 rows 传回去（rowId / YupaiOrderID 原样带回）',
        '填完 form.submit。保存没成时回执里就是具体原因（哪一行哪一格 / 哪个必填项 / 后端原话），按它改完再提交',
        '不打算保存就用 form.cancel 关掉',
    ],
    terms: {
        明细: '详情表格里的款式行，一个款式一行（款号 / 数量 / 颜色 / 尺码分布）',
        总数量: 'Qty，由明细各行的款式数量自动汇总，不能直接设',
    },
    cautions: [
        '日期一律用 YYYY-MM-DD',
        '总数量 Qty 只读：改明细的「款式数量」或尺码列，它会自己变',
        '新增/复制下，订单号没检测通过之前，除订单号与预排日期外的字段都是 readOnly，明细也改不了，别反复重试',
        '有些日期会按订单号前缀（HL / HG / FT）自动推算——那只在用户手改时触发，agent 设完要自己逐项核对补齐',
        '明细的校验错误在快照的 form.errors 里（形如「第 2 行（款号 X）后道主工序：不能为空」），' +
            '它们不属于任何表单字段，所以 form.fields[].errors 看不到',
        '明细校验（款号不能重复、数量必填等）在保存和 detail.set 时都会跑，回执里会列出前几条',
    ],
};

/**
 * 弹窗打开时的动作表：改字段 / 读写明细 / 保存 / 取消。
 *
 * 「改哪个字段」由 field 参数指认，字段清单在 form.fields 里 —— 不在这条 action 的 params 里重复一遍。
 */
function formActions(fields: yupaiOrderFormField[]): UIAction[] {
    return [
        {
            id: 'form.set',
            label: '设置表单字段',
            group: 'form',
            params: [
                {
                    name: 'field',
                    type: 'text',
                    required: true,
                    hint: `字段 id，见 form.fields[].id${fields.length > 0 ? `，例如 ${fields[0].id}` : ''}`,
                },
                {name: 'value', type: 'text', hint: '新值；日期用 YYYY-MM-DD'},
            ],
        },
        {id: 'detail.get', label: '读取明细行', group: 'form'},
        {
            id: 'detail.set',
            label: '写入明细行（整份替换数据源）',
            group: 'form',
            params: [
                {
                    name: 'rows',
                    type: 'text',
                    required: true,
                    hint: '明细行数组（JSON）。字段见 detail.get 返回的 fields；先 get 再改再整份传回来',
                },
            ],
        },
        {id: 'form.submit', label: '保存', group: 'form'},
        {id: 'form.cancel', label: '取消', group: 'form'},
    ];
}

/** 当前字段与取值：快照和回执都用它，避免两处各读一次表 */
function currentFields(
    form: FormInstance<yupaiOrderFormValues>,
    workPlaces: string[],
    fieldLock: (fieldId: string) => string | null,
): yupaiOrderFormField[] {
    const values = form.getFieldsValue();
    const errorMap = new Map<string, string[]>();
    form.getFieldsError().forEach((item) => {
        if (item.errors.length === 0) return;
        errorMap.set(String(item.name), item.errors);
    });
    return formFields(workPlaces).map((field) => ({
        ...field,
        // 界面上锁住的字段，快照里也如实标成只读 —— 让模型一眼看出「现在还不能改」，
        // 而不是设一次被拒一次
        readOnly: field.readOnly || fieldLock(field.id) !== null,
        value: toAgentValue(values[field.id as keyof yupaiOrderFormValues]),
        errors: errorMap.get(field.id),
    }));
}

/** 只读字段的原因：不写的话模型会一直试着改 */
function readOnlyHint(fieldId: string): string {
    if (fieldId === 'Qty') return '由明细各行的款式数量汇总得出，改明细就会跟着变';
    return '当前状态下不可修改';
}

/**
 * 设置一个字段，返回**直接回给模型的那句话**（设成了什么 / 没设成的原因与下一步）。
 *
 * 顺序照界面的真实顺序来：先看锁（订单号没检测通过时详情区是锁着的），再看只读，
 * 最后按类型转换。**设不进去的都不抛错**，只回一句人话说明「为什么」+「该怎么办」——
 * 抛错会让模型当成失败反复重试，而它要做的往往是「请用户手动设置」。
 */
async function setFormField(
    ctx: YupaiOrderEditBridgeContext,
    id: string,
    value: unknown,
): Promise<string> {
    const field = formFields(ctx.workPlaces).find((item) => item.id === id);
    if (!field) {
        throw new Error(`表单没有字段「${id}」；可用字段见 form.fields[].id`);
    }
    const lock = ctx.fieldLock(id);
    if (lock) {
        return `未设置「${field.label}」：${lock}`;
    }
    if (field.readOnly) {
        return `未设置「${field.label}」：它是只读的，${readOnlyHint(id)}`;
    }

    // 订单号：写完立刻检测（等价于点界面上的「检测」按钮）—— 不检测就永远是锁定态，
    // 模型会卡在「字段都 readOnly」里出不来
    if (id === 'OrderCode') {
        const code = toStringOrEmpty(value).trim();
        if (!code) {
            return '未设置订单号：不能为空';
        }
        ctx.form.setFieldValue('OrderCode', code);
        const outcome = await ctx.checkOrderCode();
        return `已写入订单号 ${code}。${outcome.message}`;
    }

    // 业务员按姓名补齐工号与部门（界面上是快速选择做的）。查不到就请用户手动选，
    // 绝不塞一个空工号进去 —— 那样要等到保存时才报错，更难查
    if (id === 'Ywy') {
        const name = toStringOrEmpty(value).trim();
        const employees = (await employeeApi.list()).data ?? [];
        const hit = employees.find((item) => item.Employee === name);
        if (!hit) {
            const similar = employees
                .filter((item) => String(item.Employee ?? '').includes(name))
                .slice(0, 5)
                .map((item) => item.Employee);
            const candidates = (similar.length > 0
                ? similar
                : employees.slice(0, 8).map((item) => item.Employee)
            )
                .filter(Boolean)
                .join('、');
            return (
                `未设置业务员「${name}」：查不到这个人，交给用户在界面上手动选择（业务员右边的「...」按钮）` +
                (candidates ? `。可选例如：${candidates}` : '')
            );
        }
        ctx.form.setFieldsValue({
            Ywy: hit.Employee,
            YwyNo: hit.EmployeeNo,
            DepartmentID: hit.DepartmentID,
        });
        return `已设置业务员 = ${hit.Employee}（工号 ${hit.EmployeeNo} 一并带出）`;
    }

    // 枚举字段：值必须来自界面给出的候选，否则请用户选 —— 硬塞一个不存在的产地保存不了
    if (field.kind === 'select' && field.options && !field.options.includes(toStringOrEmpty(value))) {
        return (
            `未设置「${field.label}」= ${toStringOrEmpty(value)}：只能是 ` +
            `${field.options.join(' / ') || '（当前没有可选值）'}，请让用户手动选择`
        );
    }

    if (field.kind === 'date') {
        const parsed = toDayjs(value);
        if (!parsed) {
            return `未设置「${field.label}」：${JSON.stringify(value)} 不是日期，格式要 YYYY-MM-DD`;
        }
        ctx.form.setFieldsValue({[id]: parsed} as unknown as Partial<yupaiOrderFormValues>);
        return `已设置「${field.label}」= ${parsed.format(DATE_FORMAT)}`;
    }

    if (field.kind === 'number') {
        const number = Number(value);
        if (Number.isNaN(number)) {
            return `未设置「${field.label}」：${JSON.stringify(value)} 不是数字`;
        }
        ctx.form.setFieldsValue({[id]: number} as unknown as Partial<yupaiOrderFormValues>);
        return `已设置「${field.label}」= ${number}`;
    }

    ctx.form.setFieldsValue({[id]: value} as unknown as Partial<yupaiOrderFormValues>);
    return `已设置「${field.label}」= ${toStringOrEmpty(value)}`;
}

/** 明细写入结果 */
export type DetailApplyResult = {
    /** 写进去多少行 */
    count: number;
    /** 写入后重算的总数量（回执里告诉模型，省得它再问一次） */
    total: number;
    /** 校验没通过的提示（空数组 = 全部通过） */
    errors: string[];
};

/**
 * 明细行的入参形态：数组，或数组的 JSON 字符串。
 *
 * 参数在协议里只有标量类型，模型常把结构化数据序列化成字符串再传 —— 两种都认，
 * 免得它按格式报错反复重试。
 */
function toRowArray(input: unknown): unknown[] | null {
    if (Array.isArray(input)) return input;
    if (typeof input === 'string') {
        try {
            const parsed: unknown = JSON.parse(input);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

/** 把模型传来的明细行收敛成一份「只含已知字段」的数据源 */
function normalizeDetailRows(input: unknown[]): Array<Partial<yupaiOrderDetailRow>> {
    const writable = new Set(DETAIL_FIELDS.map((item) => item.field));
    return input.map((raw) => {
        const source = (raw ?? {}) as Record<string, unknown>;
        const row: Record<string, unknown> = {
            // rowId 就是数据源里的 `_id`；缺了会在弹窗那边补一个草稿号，当新行处理
            _id: toStringOrEmpty(source.rowId ?? source._id),
            // 编辑态下这行属于哪张单：原样带回来，别弄丢
            YupaiOrderID: toStringOrEmpty(source.YupaiOrderID),
        };
        writable.forEach((field) => {
            const value = source[field];
            if (DETAIL_NUMERIC_FIELDS.has(field)) {
                // 明细的数值约定是「未填 = null，不是 0」
                if (value === null || value === undefined || value === '') {
                    row[field] = null;
                    return;
                }
                const number = Number(value);
                row[field] = Number.isNaN(number) ? null : number;
                return;
            }
            row[field] = toStringOrEmpty(value);
        });
        return row as Partial<yupaiOrderDetailRow>;
    });
}

/** 明细行的对外形状：只给可填字段 + 行标识 */
function toAgentDetailRow(row: yupaiOrderDetailRow): Record<string, unknown> {
    const picked: Record<string, unknown> = {
        rowId: String(row._id ?? ''),
        YupaiOrderID: String(row.YupaiOrderID ?? ''),
    };
    DETAIL_FIELDS.forEach((item) => {
        picked[item.field] = row[item.field] ?? null;
    });
    return picked;
}

/**
 * 把「行主键#字段 → 提示」翻成人话：「第 2 行（款号 12345）后道主工序：不能为空」。
 *
 * 只报「有 3 处错误」没有意义 —— 模型看不到 canvas 里的红格，得给它行号 + 款号 + 字段名，
 * 它才知道去改哪一格。
 */
function describeDetailErrors(
    cellErrors: Record<string, string>,
    rows: yupaiOrderDetailRow[],
): string[] {
    const labelOf = new Map(DETAIL_FIELDS.map((item) => [item.field, item.label]));
    return Object.entries(cellErrors).map(([key, message]) => {
        const [rowKey, field] = key.split('#');
        const index = rows.findIndex((row) => String(row._id ?? '') === rowKey);
        const styleCode = index >= 0 ? toStringOrEmpty(rows[index].StyleCode) : '';
        const where = index >= 0
            ? `第 ${index + 1} 行${styleCode ? `（款号 ${styleCode}）` : ''} `
            : '（已删除的行）';
        return `${where}${labelOf.get(field) ?? field}：${message}`;
    });
}

/** 弹窗交给桥的东西：只有状态与能力，没有桥的结构 */
export type YupaiOrderEditBridgeContext = {
    /** 弹窗标题（按模式变：新增 / 编辑 / 复制 / 查看） */
    title: string;
    mode: FormMode;
    /** 正在编辑的单据主键；新增时为 null */
    recordId: string | null;
    /** 产地选项：WorkPlace 字段的可选值来自页面数据 */
    workPlaces: string[];
    /** antd 表单实例：字段取值与校验报错都向它要，弹窗不另存一份 */
    form: FormInstance<yupaiOrderFormValues>;
    /**
     * 这个字段此刻为什么改不了（null = 可以改）。
     *
     * 锁定规则只写在弹窗里一处，界面上的 `dpProps / selectProps / readOnly` 与桥共用它 ——
     * 桥再推一遍「新增且未检测则锁定」必然与界面漂移。
     */
    fieldLock: (fieldId: string) => string | null;
    /** 明细此刻为什么改不了（null = 可以改），理由同上 */
    detailLock: () => string | null;
    /** 检测订单号（等价于点界面上的「检测」按钮），返回结果摘要 */
    checkOrderCode: () => Promise<{ok: boolean; message: string}>;
    /** 当前明细行 */
    detailRows: () => yupaiOrderDetailRow[];
    /**
     * 用给定行**整份替换**明细数据源（不逐格改）。
     * 认得 rowId 的行保留原主键，认不出的当新行；写完顺带重算总数量、跑一次校验。
     */
    applyDetailRows: (rows: Array<Partial<yupaiOrderDetailRow>>) => DetailApplyResult;
    /**
     * 明细当前的红格内容：「行主键#字段」→ 提示。
     *
     * 这是弹窗里唯一一份「校验没通过」的真相（保存时写进去的），快照的 form.errors 由它生成 ——
     * 界面上这些提示只画在 canvas 红格和悬停浮层里，模型看不见。
     */
    cellErrors: () => Record<string, string>;
    /** 是否已就绪：还在拉数据 / 保存中都不算（那时字段是空的，agent 会以为单据本来空白） */
    isReady: () => boolean;
    /**
     * 提交保存。`ok=false` 时 `message` 是**可修复的原因**（哪一行哪一格、哪个必填项、后端原话）。
     *
     * 页面里校验不过、详情行有错、后端报错都会停在保存流程里（弹窗不关），一律落成
     * `ok=false` + 具体原因 —— 只说「保存失败」等于什么都没说，agent 只能瞎试。
     */
    submit: () => Promise<{ok: boolean; message: string}>;
    /** 关闭弹窗 */
    close: () => void;
};

/**
 * 装配弹窗的界面桥宿主。
 *
 * 吃的是**取值函数**而不是 ctx 对象本身：字段表、动作表、就绪状态都在被调用的那一刻才读，
 * 所以宿主对象不必跟着每次渲染重建，读到的也永远是最新的表单内容。
 */
export function createYupaiOrderEditBridge(read: () => YupaiOrderEditBridgeContext): UIDialogHost {
    return {
        snapshot: (): UIForm => {
            const ctx = read();
            return {
                id: 'yupaiOrderEdit',
                title: ctx.title,
                mode: ctx.mode,
                recordId: ctx.recordId,
                fields: currentFields(ctx.form, ctx.workPlaces, ctx.fieldLock).map((field) => ({
                    id: field.id,
                    label: field.label,
                    type: field.kind,
                    value: field.value,
                    options: field.options,
                    required: field.required,
                    readOnly: field.readOnly,
                    errors: field.errors,
                })),
                /*
                 * 明细的校验错误放这里（表单级），不放 fields[]：它们不属于任何一个表单字段。
                 * 界面上这些提示只画在 canvas 红格和悬停浮层里 —— 不写进快照，模型永远看不到，
                 * 就会一直觉得「必填都填了，为什么保存不了」。
                 */
                errors: describeDetailErrors(ctx.cellErrors(), ctx.detailRows()),
            };
        },
        actions: () => {
            const ctx = read();
            return formActions(currentFields(ctx.form, ctx.workPlaces, ctx.fieldLock));
        },
        handlers: {
            'form.set': async (params) => {
                const ctx = read();
                const field = String(params.field ?? '').trim();
                if (!field) {
                    throw new Error('需要 field（字段 id，见 form.fields[].id）与 value');
                }
                // 回执直接用人话：设进去了说清设成什么，没设进去说清为什么、下一步该谁做
                return await setFormField(ctx, field, params.value);
            },
            'detail.get': () => {
                const ctx = read();
                return {
                    fields: DETAIL_FIELDS,
                    rows: ctx.detailRows().map(toAgentDetailRow),
                    hint:
                        '整份替换：改完把 rows 原样传给 detail.set。rowId / YupaiOrderID 要带回来，' +
                        '缺了会被当成新行；数组顺序就是表格里从上到下的顺序',
                };
            },
            'detail.set': (params) => {
                const ctx = read();
                const rows = toRowArray(params.rows);
                if (!rows) {
                    throw new Error(
                        '需要 rows（明细行数组）；可以直接传数组，也可以传数组的 JSON 字符串。' +
                            '字段见 detail.get 返回的 fields',
                    );
                }
                const lock = ctx.detailLock();
                if (lock) {
                    return `未写入明细：${lock}`;
                }
                const result = ctx.applyDetailRows(normalizeDetailRows(rows));
                const lines = [`已写入 ${result.count} 行明细，总数量 ${result.total}`];
                if (result.errors.length > 0) {
                    const preview = result.errors.slice(0, 5).join('；');
                    const rest = result.errors.length - Math.min(result.errors.length, 5);
                    lines.push(
                        `校验未通过 ${result.errors.length} 处：${preview}${rest > 0 ? `；其余 ${rest} 处见页面红格` : ''}（保存前必须改掉）`,
                    );
                } else {
                    lines.push('校验全部通过');
                }
                return lines.join('；');
            },
            'form.submit': async () => {
                const outcome = await read().submit();
                if (!outcome.ok) {
                    /*
                     * 原因原样抛给模型（handler 会把它放进回执的 error 字段）。
                     * 这里绝不能只说「保存失败」：界面上的失败只有 toast 和红格，模型看不到，
                     * 一句没头没尾的失败会让它对着快照反复重试。
                     */
                    throw new Error(outcome.message || '保存未完成，页面没有给出原因');
                }
                return '已保存';
            },
            'form.cancel': () => {
                read().close();
                return '已关闭表单';
            },
        },
        guide: FORM_GUIDE,
        ready: () => read().isReady(),
    };
}
