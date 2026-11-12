import type {MisProduceDataRow} from '@/api';
import type {CommandItem} from '@/components/CommandBar';
import type {AppColumnDef, FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';

export type ProduceDataQuery = {
    startDate: string;
    endDate: string;
    machCode: string;
};

export type ProduceDataBridgeContext = {
    view: string;
    query: ProduceDataQuery;
    columns: AppColumnDef[];
    commands: CommandItem[];
    activeRow: MisProduceDataRow | null;
    applyQuery: (next: ProduceDataQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

const GUIDE: UIGuide = {
    summary: '织造挡车产量：按日期和机台查询挡车扫描产量，越南组织还包含入库、踩毛边与出库信息',
    steps: [
        '换日期和机台用 query.set；日期格式 YYYY-MM-DD，查询时间口径为每天 06:00',
        '需要操作单行时先用 data.select 定位，再执行工具栏命令',
        '修改挡车数量会打开弹窗，填写非负整数后保存',
    ],
    cautions: [
        '修改挡车数量和删除只在越南组织可用，并受菜单按钮权限控制',
        '已入库/已同步的记录不能删除',
        '补条码/打印按项目约定未迁',
    ],
};

function queryFields(query: ProduceDataQuery): UIField[] {
    return [
        {id: 'startDate', label: '开始日期', type: 'date', value: query.startDate},
        {id: 'endDate', label: '结束日期', type: 'date', value: query.endDate},
        {id: 'machCode', label: '机台', type: 'text', value: query.machCode},
    ];
}

export function createProduceDataBridge(read: () => ProduceDataBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: read().columns,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: ['Status', 'DateShiftStart', 'ShiftName', 'MachCode', 'Employee', 'EmployeeName', 'OrderCode', 'DispatchNo', 'Qty', 'CheckQty'],
        columnHints: {
            Status: '越南：未扫描 / 已入库；其它组织：已同步',
            Qty: '挡车产量',
            CheckQty: '越南为入库数量，其它组织为检验数量',
        },
    });
    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        'query.set': async (params) => {
            const ctx = read();
            const next = {
                startDate: toStringOrEmpty(params.startDate).trim() || ctx.query.startDate,
                endDate: toStringOrEmpty(params.endDate).trim() || ctx.query.endDate,
                machCode: params.machCode === undefined
                    ? ctx.query.machCode
                    : toStringOrEmpty(params.machCode).trim(),
            };
            await ctx.applyQuery(next);
            return `已按 ${next.startDate} ~ ${next.endDate}${next.machCode ? `，机台 ${next.machCode}` : ''} 重新查询`;
        },
    };
    read().commands.forEach((item) => {
        if (!item.onClick) return;
        handlers[item.key] = () => {
            const latest = read().commands.find((command) => command.key === item.key) ?? item;
            latest.onClick?.();
            return latest.waitConfirm ? `「${latest.label}」已触发，等待用户确认` : `已执行：${latest.label}`;
        };
    });
    return {
        snapshot: (): UISnapshotData => {
            const ctx = read();
            const query = queryFields(ctx.query);
            return {
                view: ctx.view,
                title: 'MIS > 挡车产量',
                mode: 'list',
                guide: GUIDE,
                actions: [
                    ...ctx.commands.map((item) => ({
                        id: item.key,
                        label: item.label,
                        group: 'toolbar' as const,
                        disabled: item.disabled,
                        waitConfirm: item.waitConfirm,
                        disabledReason: item.disabled ? '需要越南组织、选中一条可操作记录，并具备对应按钮权限' : undefined,
                    })),
                    ...tableBridge.actions(),
                    {
                        id: 'query.set',
                        label: '设置查询条件',
                        group: 'filter',
                        params: query.map((field) => ({name: field.id, type: field.type, hint: field.label})),
                    },
                ],
                query,
                tables: [tableBridge.data({active: ctx.activeRow})],
            };
        },
        handlers,
    };
}
