import type {MisScheduleEmployee, ScheduleBJ} from '@/api';
import type {CommandItem} from '@/components/CommandBar';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIForm, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
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
import {formatDate, toDayjs, toNumberOrZero, toStringOrEmpty} from '@/utils';
import {SCHEDULE_COLUMNS} from './columns';
import {
    EMPLOYEE_FIELD_META,
    EMPLOYEE_FIELDS,
    type EmployeeField,
    type ScheduleMutationResult,
    type ScheduleQuery,
    type ScheduleQueryResult,
} from './schedule';

export type ScheduleMaintenanceBridgeContext = {
    view: string;
    query: ScheduleQuery;
    editing: boolean;
    employeeLoading: boolean;
    reload: () => Promise<ScheduleQueryResult>;
    activeRow: ScheduleBJ | null;
    commands: CommandItem[];
    applyQuery: (next: ScheduleQuery) => Promise<ScheduleQueryResult>;
    toggleEditing: () => Promise<boolean>;
    employeeCodes: (field: EmployeeField) => string[];
    findEmployee: (field: EmployeeField, code: unknown) => MisScheduleEmployee | undefined;
    writeEmployeeField: (
        rowId: number,
        field: EmployeeField,
        value: unknown,
    ) => Promise<ScheduleMutationResult>;
    readScheduleTable: () => FilterTableApi | null;
};

const GUIDE: UIGuide = {
    summary: '按日期维护查看织造排班，给每条班次记录选择挡车工、踩毛边工、毛坯全检工和机修工，并同步查看每台机台的三个班次安排',
    steps: [
        '换日期用 query.set，格式 YYYY-MM-DD；它会重新请求后端并等待新数据落地',
        '先用 schedule.select 按 rowId 选中一条班次记录，再执行 edit 进入编辑态',
        '编辑态下用 form.setMany 一次设置要改的员工编号；字段 id 见 form.fields[].id',
        '每次员工编号写入都会按 C# 的 RowUpdated 行为立即调用更新接口，并自动回填员工名称；挡车工还会回填班组',
        '右侧机台卡片由左侧同一批数据按 MachineID 汇总，不需要单独查询',
    ],
    terms: {
        挡车工: 'OpeCode / OpeName，员工组 0',
        踩毛边工: 'OpeCode2 / OpeName2，员工组 2',
        毛坯全检工: 'OpeCode3 / OpeName3，员工组 3',
        机修工: 'OpeCode4 / OpeName4，员工组 4',
        班次1: '交班1或白班',
        班次2: '交班2',
        班次3: '夜班',
    },
    cautions: [
        '未执行 edit 时四类员工编号均为只读；未选中行时 form 不出现',
        '员工编号只能从当前员工组候选里选，清空编号会同时清空对应员工名称',
        'schedule.filter 只在当前日期结果里前端筛选；query.set 才会重新查库',
        '右侧机台卡片是同一批数据派生的只读汇总视图，不是另一份可查询数据',
    ],
};

function queryFields(query: ScheduleQuery): UIField[] {
    return [{id: 'date', label: '日期', type: 'date', value: query.date, required: true}];
}

function formFieldSpecs(ctx: ScheduleMaintenanceBridgeContext): FormFieldSpec[] {
    if (!ctx.editing || !ctx.activeRow) return [];
    return EMPLOYEE_FIELDS.map((field) => ({
        id: field,
        label: EMPLOYEE_FIELD_META[field].label,
        type: 'select',
        options: ctx.employeeCodes(field),
    }));
}

function fieldLock(ctx: ScheduleMaintenanceBridgeContext, field: string): string | null {
    if (!ctx.editing) return '先执行 edit 进入编辑态；选中行后 form 会给出可写字段';
    if (!ctx.activeRow) return '先用 schedule.select 选中一条班次记录';
    if (!(EMPLOYEE_FIELDS as readonly string[]).includes(field)) {
        return `「${field}」不是本页可编辑的员工编号字段`;
    }
    return null;
}

function inlineForm(ctx: ScheduleMaintenanceBridgeContext): UIForm | null {
    if (!ctx.editing || !ctx.activeRow) return null;
    const row = ctx.activeRow;
    return {
        id: 'scheduleMaintenanceInline',
        title: `排班维护 · ID ${toStringOrEmpty(row.ID)}`,
        mode: 'edit',
        recordId: toStringOrEmpty(row.ID) || null,
        fields: formFieldSpecs(ctx).map((spec) => {
            const field = spec.id as EmployeeField;
            const employee = ctx.findEmployee(field, row[field]);
            return {
                ...spec,
                value: row[field] ?? null,
                hint: employee
                    ? `${toStringOrEmpty(employee.No)} ${toStringOrEmpty(employee.Name)}`.trim()
                    : '从当前员工组候选中选择编号',
            };
        }),
        errors: [],
        dirty: false,
    };
}

function commandDisabledReason(item: CommandItem, ctx: ScheduleMaintenanceBridgeContext): string | undefined {
    if (!item.disabled) return undefined;
    if (item.key === 'edit' && ctx.employeeLoading) {
        return '员工资料正在加载，请等待加载完成后再进入编辑态';
    }
    return `${item.label}当前不可用`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForActiveRow(
    read: () => ScheduleMaintenanceBridgeContext,
    rowId: string,
): Promise<boolean> {
    const deadline = Date.now() + 800;
    for (; ;) {
        if (toStringOrEmpty(read().activeRow?.ID) === rowId) return true;
        if (Date.now() >= deadline) return false;
        await sleep(16);
    }
}

export function createScheduleMaintenanceBridge(
    read: () => ScheduleMaintenanceBridgeContext,
): UIBridgeHost {
    const scheduleBridge = createTableBridge({
        name: 'schedule',
        columns: SCHEDULE_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readScheduleTable(),
        keyFields: [
            'MachineID',
            'Shift',
            'GroupCode',
            'OpeCode',
            'OpeName',
            'OpeCode2',
            'OpeName2',
            'OpeCode3',
            'OpeName3',
            'OpeCode4',
            'OpeName4',
            'StartTime',
            'EndTime',
        ],
        columnHints: {
            OpeCode: '挡车工编号，候选来自员工组 0；修改后回填 OpeName 与 GroupCode',
            OpeCode2: '踩毛边工编号，候选来自员工组 2；修改后回填 OpeName2',
            OpeCode3: '毛坯全检工编号，候选来自员工组 3；修改后回填 OpeName3',
            OpeCode4: '机修工编号，候选来自员工组 4；修改后回填 OpeName4',
            MachineID: '机台号；右侧 machines 表按它汇总',
        },
        waitSelected: (rowId) => waitForActiveRow(read, rowId),
    });
    const writer = createFormWriter({
        fields: () => formFieldSpecs(read()),
        fieldLock: (id) => fieldLock(read(), id),
        write: () => {
            // 四类员工编号都在 sequenced 中写入，并各自等待更新接口落地。
        },
        sequenced: EMPLOYEE_FIELDS.map((field) => ({
            id: field,
            run: async (value): Promise<FieldOutcome> => {
                const ctx = read();
                const rowId = toNumberOrZero(ctx.activeRow?.ID);
                if (!ctx.activeRow || rowId <= 0) {
                    return {ok: false, message: '未设置员工编号：先用 schedule.select 选中一条班次记录'};
                }
                return ctx.writeEmployeeField(rowId, field, value);
            },
        })),
    });

    const handlers: Record<string, UIBridgeHandler> = {
        ...scheduleBridge.handlers,
        ...createFormWriteHandlers(writer),
        'query.set': async (params) => {
            const ctx = read();
            const date = formatDate(params.date === undefined ? ctx.query.date : params.date);
            if (!date || !toDayjs(date)) {
                throw new Error('日期格式应为 YYYY-MM-DD，例如 2026-11-12');
            }
            const result = await ctx.applyQuery({date});
            if (!result.ok) throw new Error(result.message);
            return `${result.message}（${date}）`;
        },
    };

    read().commands.forEach((item) => {
        handlers[item.key] = async () => {
            const ctx = read();
            const latest = ctx.commands.find((command) => command.key === item.key);
            if (!latest) throw new Error(`命令「${item.key}」当前不存在，请重新 observe`);
            if (latest.disabled) {
                throw new Error(commandDisabledReason(latest, ctx) ?? `「${latest.label}」当前不可用`);
            }
            if (latest.key === 'edit') {
                const ready = await ctx.toggleEditing();
                if (!ready) throw new Error('员工资料加载失败，未进入编辑态；请稍后重试');
                return read().editing
                    ? '已进入编辑态；选中一条记录后，form 段会给出四类员工编号字段'
                    : '已退出编辑态，员工编号恢复只读';
            }
            if (latest.key === 'refresh') {
                const result = await ctx.reload();
                if (!result.ok) throw new Error(result.message);
                return result.message;
            }
            if (!latest.onClick) throw new Error(`命令「${item.key}」当前没有可执行动作`);
            latest.onClick();
            return `已执行：${latest.label}`;
        };
    });

    return {
        snapshot: (): UISnapshotData => {
            const ctx = read();
            const form = inlineForm(ctx);
            const specs = form ? formFieldSpecs(ctx) : [];
            return {
                view: ctx.view,
                title: 'MIS > 排班维护',
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
                    ...scheduleBridge.actions(),
                    {
                        id: 'query.set',
                        label: '设置查询日期',
                        group: 'filter',
                        params: queryFields(ctx.query).map((field) => ({
                            name: field.id,
                            type: field.type,
                            required: field.required,
                            hint: field.label,
                        })),
                    },
                    ...(form ? createFormWriteActions(specs) : []),
                ],
                query: queryFields(ctx.query),
                tables: [
                    scheduleBridge.data({active: ctx.activeRow}),
                ],
                form,
            };
        },
        handlers,
    };
}
