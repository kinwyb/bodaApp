import type {CommandItem} from '@/components/CommandBar';
import type {FilterTableApi} from '@/components/grid-table';
import type {ProductionMonitorOrder} from '@/api/schemas/mis/productionMonitorOrder';
import type {ShiftInfo} from '@/api/schemas/mis/machineShift';
import type {UIAction, UIField, UIForm, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {
    createFormWriteActions,
    createFormWriteHandlers,
    createFormWriter,
    createTableBridge,
    type FieldOutcome,
    type FormFieldSpec,
    type UIBridgeHandler,
    type UIBridgeHost,
} from '@/pages/agent/ui-bridge';
import {ErrorMessage} from '@/api/request';
import {DATETIME_FORMAT, formatDateTime, toDayjs, toStringOrEmpty} from '@/utils';
import {ORDER_INFO_COLUMNS} from './columns';
import {
    EDITABLE_FIELD_LABELS,
    EDITABLE_FIELDS,
    type EditableField,
    moPatch,
    type OrderInfoQuery,
    type OrderInfoQueryResult,
    type OrderInfoRow,
    type OrderInfoSaveResult,
    validateQuery,
} from './orderInfo';

export type OrderInfoBridgeContext = {
    view: string;
    query: OrderInfoQuery;
    commands: CommandItem[];
    editing: boolean;
    activeRow: OrderInfoRow | null;
    dirtyCount: number;
    loading: boolean;
    saving: boolean;
    applyQuery: (next: OrderInfoQuery) => Promise<OrderInfoQueryResult>;
    readTable: () => FilterTableApi | null;
    save: () => Promise<OrderInfoSaveResult>;
    readActiveRow: () => OrderInfoRow | null;
    fieldLock: (id: string) => string | null;
    writeInline: (patch: Partial<OrderInfoRow>) => void;
    applyInlinePatch: (patch: Partial<OrderInfoRow>) => void;
    loadShifts: (date: string) => Promise<ShiftInfo[]>;
    resolveMo: (mo: string) => Promise<ProductionMonitorOrder | null>;
    isShiftReady: (date: unknown) => boolean;
    shiftOptions: (date: unknown) => string[];
};

const GUIDE: UIGuide = {
    summary: '织造机器班次生产订单信息补充：按日期、订单号与机台查询织造下机的原始记录，补充派工单号与下机时间，并对新增原因记录调整开始时间、班次和机台',
    steps: [
        '换查询条件用 query.set，日期格式 YYYY-MM-DD；它会重新请求后端并清空未保存改动',
        '数据行不在快照里：用 data.page 按显示行号取行，再用 data.select 选中要操作的那一行',
        '修改前先执行 edit 进入编辑态；选中一行后，form 段会给出该行此刻真正可写的字段',
        '一次传齐要改的字段用 form.setMany；开始时间、班次、派工单号会自动按界面顺序联动',
        '改完执行 save；保存失败会保留修改和编辑态，按回执里的原因修正后再保存',
    ],
    terms: {
        派工单号: 'StLot，修改后会带出订单号、订单信息、颜色、尺码、款号；不是原料批次',
        下机时间: 'Cycle，数值型',
        开始时间: 'DateStartShift，格式 YYYY-MM-DD HH:mm:ss',
        新增记录: 'Reason = 999，额外允许修改开始时间、班次、机台号，也只有这类未审核记录可删除',
        已审核: 'Flag = 1，FlagString 显示「审核」，整行锁定',
    },
    cautions: [
        '未审核且 Reason 不是 999 的记录只能改 Cycle 与 StLot',
        '班次候选依赖开始时间所在日期；班次未加载时 ShiftName 会保持锁定',
        'StLot 回车提交后，只会向开始时间与机台相同且派工单号为空的下一行填充',
        '删除要求 Flag = 0 且 Reason = 999；复制可作用于任意选中行，二者都要等用户确认后才生效',
        'query.set 是重新查库；data.filter 只在当前结果里筛选，不会重新请求',
        '打印按项目约定未迁；刷新由查询入口承担',
    ],
};

const KEY_FIELDS = [
    'DateRec',
    'MachCode',
    'ShiftName',
    'StLot',
    'OrderCode',
    'StyleCode',
    'StColor',
    'StSize',
    'Cycle',
    'Pieces',
    'Discards',
    'Reason',
    'FlagString',
];

const COLUMN_HINTS: Record<string, string> = {
    StLot: '派工单号；修改后自动带出订单资料',
    Cycle: '下机时间',
    DateStartShift: '班次开始时间，格式 YYYY-MM-DD HH:mm:ss',
    Reason: '999 表示新增资料，可删除并额外修改班次/机台',
    FlagString: 'Flag = 1 时显示「审核」，已审核行不可修改',
    MachCode: '机台号',
};

function queryFields(query: OrderInfoQuery): UIField[] {
    return [
        {id: 'startDate', label: '开始日期', type: 'date', value: query.startDate, required: true},
        {id: 'endDate', label: '结束日期', type: 'date', value: query.endDate, required: true},
        {id: 'orderCode', label: '订单号', type: 'text', value: query.orderCode},
        {id: 'machineCode', label: '机台号', type: 'text', value: query.machineCode},
    ];
}

function inlineFieldSpecs(ctx: OrderInfoBridgeContext): FormFieldSpec[] {
    const row = ctx.activeRow;
    return EDITABLE_FIELDS.map((field) => {
        const lock = ctx.fieldLock(field);
        const spec: FormFieldSpec = {
            id: field,
            label: EDITABLE_FIELD_LABELS[field],
            type: field === 'Cycle' || field === 'MachCode'
                ? 'number'
                : field === 'ShiftName'
                    ? 'select'
                    : field === 'DateStartShift'
                        ? 'date'
                        : 'text',
            readOnly: lock !== null,
            readOnlyReason: lock ?? undefined,
        };
        if (field === 'ShiftName') spec.options = ctx.shiftOptions(row?.DateStartShift);
        if (field === 'DateStartShift') spec.required = row?.Reason === 999;
        return spec;
    });
}

function inlineFieldValue(row: OrderInfoRow, field: EditableField): unknown {
    if (field === 'DateStartShift') return formatDateTime(row.DateStartShift) || null;
    return row[field] ?? null;
}

function inlineForm(ctx: OrderInfoBridgeContext): UIForm | null {
    const row = ctx.activeRow;
    if (!ctx.editing || !row) return null;
    return {
        id: 'orderInfoInline',
        title: `订单信息补充 · ID ${toStringOrEmpty(row.ID)}`,
        mode: 'edit',
        recordId: toStringOrEmpty(row.ID) || null,
        fields: inlineFieldSpecs(ctx).map((spec) => ({
            ...spec,
            value: inlineFieldValue(row, spec.id as EditableField),
            hint: spec.id === 'DateStartShift' ? '格式 YYYY-MM-DD HH:mm:ss' : undefined,
        })),
        errors: [],
        dirty: ctx.dirtyCount > 0,
    };
}

function commandDisabledReason(item: CommandItem, ctx: OrderInfoBridgeContext): string | undefined {
    if (!item.disabled) return undefined;
    if (ctx.loading) return '查询进行中，请等待列表落地后再操作';
    if (ctx.saving) return '保存进行中，请等待保存结果';
    switch (item.key) {
        case 'edit':
            return '已经处于编辑态；改完执行 save，或继续修改其它行';
        case 'save':
            return '先执行 edit 进入编辑态';
        case 'delete':
            if (!ctx.activeRow) return '先用 data.select 选中一行';
            return '只有未审核且 Reason = 999 的新增记录可删除';
        case 'copy':
            return '先用 data.select 选中一行';
        default:
            return '当前状态下不可用';
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForActiveRow(read: () => OrderInfoBridgeContext, rowId: string): Promise<boolean> {
    const deadline = Date.now() + 800;
    for (; ;) {
        if (toStringOrEmpty(read().activeRow?.ID) === rowId) return true;
        if (Date.now() >= deadline) return false;
        await sleep(16);
    }
}

async function setInlineDate(ctx: OrderInfoBridgeContext, value: unknown): Promise<FieldOutcome> {
    const parsed = toDayjs(value);
    if (!parsed) {
        return {ok: false, message: '未设置开始时间：需要有效日期，格式 YYYY-MM-DD HH:mm:ss'};
    }
    const formatted = parsed.format(DATETIME_FORMAT);
    ctx.applyInlinePatch({DateStartShift: formatted});
    try {
        await ctx.loadShifts(parsed.format('YYYY-MM-DD'));
        return {ok: true, message: `已设置开始时间 = ${formatted}，当天班次已预取`};
    } catch (error) {
        return {
            ok: true,
            message: `已设置开始时间 = ${formatted}；班次预取失败：${ErrorMessage(error, '班次信息加载失败')}`,
        };
    }
}

async function setInlineShift(ctx: OrderInfoBridgeContext, value: unknown): Promise<FieldOutcome> {
    const row = ctx.readActiveRow();
    const name = toStringOrEmpty(value).trim();
    if (!row) return {ok: false, message: '未设置班次：先用 data.select 选中一行'};
    if (!name) return {ok: false, message: '未设置班次：班次名称不能为空'};
    const date = formatDateTime(row.DateStartShift).slice(0, 10);
    if (!date) return {ok: false, message: '未设置班次：开始时间无效，请先设置 DateStartShift'};
    let shifts: ShiftInfo[];
    try {
        shifts = await ctx.loadShifts(date);
    } catch (error) {
        return {ok: false, message: `未设置班次：${ErrorMessage(error, '班次信息加载失败')}`};
    }
    const hit = shifts.find((shift) => toStringOrEmpty(shift.Name) === name);
    if (!hit) {
        const options = shifts.map((shift) => toStringOrEmpty(shift.Name)).filter(Boolean);
        return {
            ok: false,
            message: `未设置班次「${name}」：只能是 ${options.join(' / ') || '（当天没有可选班次）'}`,
        };
    }
    const start = formatDateTime(hit.StartTime);
    if (!start) return {ok: false, message: `未设置班次「${name}」：该班次缺少有效开始时间`};
    ctx.applyInlinePatch({ShiftName: name, DateStartShift: start});
    return {ok: true, message: `已设置班次 = ${name}，开始时间同步为 ${start}`};
}

async function setInlineStLot(ctx: OrderInfoBridgeContext, value: unknown): Promise<FieldOutcome> {
    const text = toStringOrEmpty(value).trim();
    try {
        const mo = await ctx.resolveMo(text);
        ctx.applyInlinePatch({StLot: text, ...moPatch(mo)});
        if (!text) return {ok: true, message: '已清空派工单号及关联订单资料'};
        if (!mo) return {ok: true, message: `已设置派工单号 = ${text}；未查到关联订单资料`};
        return {
            ok: true,
            message: `已设置派工单号 = ${text}，带出订单号 ${toStringOrEmpty(mo.OrderCode) || '—'}、款号 ${toStringOrEmpty(mo.StyleCode) || '—'}`,
        };
    } catch (error) {
        return {ok: false, message: `未设置派工单号：${ErrorMessage(error, '派工单资料加载失败')}`};
    }
}

function formWriteActions(specs: FormFieldSpec[]): UIAction[] {
    return createFormWriteActions(specs).map((action) => {
        if (action.id === 'form.setMany') {
            return {
                ...action,
                params: action.params?.map((param) => param.name === 'values'
                    ? {
                        ...param,
                        hint: '字段 id → 新值的对象（也接受 JSON 字符串），例如 {"Cycle":12.5,"StLot":"MO123"}。' +
                            '字段 id 见 form.fields[].id；一次传齐，开始时间/班次/派工单号会自动联动',
                    }
                    : param),
            };
        }
        if (action.id === 'form.set') {
            return {
                ...action,
                params: action.params?.map((param) => param.name === 'value'
                    ? {...param, hint: '新值；DateStartShift 用 YYYY-MM-DD HH:mm:ss'}
                    : param),
            };
        }
        return action;
    });
}

export function createOrderInfoBridge(read: () => OrderInfoBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: ORDER_INFO_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: KEY_FIELDS,
        columnHints: COLUMN_HINTS,
        waitSelected: (rowId) => waitForActiveRow(read, rowId),
    });

    const writer = createFormWriter({
        fields: () => inlineFieldSpecs(read()),
        fieldLock: (id) => read().fieldLock(id),
        write: (patch) => read().writeInline(patch as Partial<OrderInfoRow>),
        sequenced: [
            {id: 'DateStartShift', run: (value) => setInlineDate(read(), value)},
            {id: 'ShiftName', run: (value) => setInlineShift(read(), value)},
            {id: 'StLot', run: (value) => setInlineStLot(read(), value)},
        ],
    });

    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        ...createFormWriteHandlers(writer),
        'query.set': async (params) => {
            const ctx = read();
            const next: OrderInfoQuery = {
                startDate: toStringOrEmpty(params.startDate).trim() || ctx.query.startDate,
                endDate: toStringOrEmpty(params.endDate).trim() || ctx.query.endDate,
                orderCode: params.orderCode === undefined
                    ? ctx.query.orderCode
                    : toStringOrEmpty(params.orderCode).trim(),
                machineCode: params.machineCode === undefined
                    ? ctx.query.machineCode
                    : toStringOrEmpty(params.machineCode).trim(),
            };
            const issue = validateQuery(next);
            if (issue) throw new Error(issue);
            const result = await ctx.applyQuery(next);
            if (!result.ok) throw new Error(result.message);
            return `${result.message}（${next.startDate} ~ ${next.endDate}）`;
        },
    };

    read().commands.forEach((item) => {
        handlers[item.key] = async () => {
            const ctx = read();
            const latest = ctx.commands.find((command) => command.key === item.key);
            if (!latest?.onClick) throw new Error(`命令「${item.key}」当前不可用`);
            if (latest.disabled) {
                throw new Error(commandDisabledReason(latest, ctx) ?? `「${latest.label}」当前不可用`);
            }
            if (latest.key === 'save') {
                const result = await ctx.save();
                if (!result.ok) throw new Error(result.message);
                return result.message;
            }
            latest.onClick();
            if (latest.waitConfirm) {
                return `「${latest.label}」已触发，但还没有生效：界面上弹出了确认框，用户点「确认」之后才会执行。` +
                    '不要重复调用这条命令；最终结果以 action.outcome 事件或重新读取表格为准';
            }
            if (latest.key === 'edit') {
                return '已进入编辑态；选中一行后，form 段会给出该行可写字段';
            }
            return `已执行：${latest.label}`;
        };
    });

    return {
        snapshot: (): UISnapshotData => {
            const ctx = read();
            const query = queryFields(ctx.query);
            const form = inlineForm(ctx);
            const specs = form ? inlineFieldSpecs(ctx) : [];
            return {
                view: ctx.view,
                title: 'MIS > 订单信息补充',
                mode: ctx.editing ? 'form' : 'list',
                guide: GUIDE,
                actions: [
                    ...ctx.commands.map((item) => ({
                        id: item.key,
                        label: item.label,
                        group: 'toolbar' as const,
                        danger: item.danger,
                        waitConfirm: item.waitConfirm,
                        disabled: item.disabled,
                        disabledReason: commandDisabledReason(item, ctx),
                    })),
                    ...tableBridge.actions(),
                    {
                        id: 'query.set',
                        label: '设置查询条件',
                        group: 'filter',
                        params: query.map((field) => ({
                            name: field.id,
                            type: field.type,
                            required: field.required,
                            hint: field.label,
                        })),
                    },
                    ...(form ? formWriteActions(specs) : []),
                ],
                query,
                tables: [tableBridge.data({active: ctx.activeRow})],
                form,
            };
        },
        handlers,
        events: [
            {
                id: 'action.outcome',
                label: '需要确认的命令结果',
                delivery: 'immediate',
                waitConfirmFor: ['delete', 'copy'],
                mergeBy: ['actionId'],
                payload: [
                    {name: 'actionId', type: 'text', required: true},
                    {name: 'outcome', type: 'text', required: true},
                    {name: 'rowId', type: 'text'},
                    {name: 'newRowId', type: 'text'},
                    {name: 'message', type: 'text'},
                ],
                hint: '用户最终确认、取消或删除/复制失败时立即上报真实终态',
            },
        ],
    };
}
