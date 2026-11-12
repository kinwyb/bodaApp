import type {CommandItem} from '@/components/CommandBar';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import {toDayjs, toStringOrEmpty} from '@/utils';
import {PRODUCTION_MONITOR_COLUMNS} from './columns';
import type {ProductionMonitorQueryState, ProductionMonitorRow} from './types';

export type ProductionMonitorBridgeContext = {
    view: string;
    query: ProductionMonitorQueryState | null;
    commands: CommandItem[];
    activeRow: ProductionMonitorRow | null;
    selectionCount: number;
    applyQuery: (next: ProductionMonitorQueryState) => Promise<void>;
    auditSelected: () => Promise<void>;
    changePieces: (rowId: string, pieces: number) => Promise<void>;
    openChangeLog: (rowId: string) => void;
    readTable: () => FilterTableApi | null;
};

const GUIDE: UIGuide = {
    summary: '织造产量差异调整：按日期、订单、机台与厂别查询织造产量，调整正品产量并批量审核',
    steps: [
        '首屏不自动查询：先用 query.set 设置开始/结束日期（YYYY-MM-DD），再读 data.page',
        '需要操作单行时先用 data.select 定位；审核只提交选中且尚未审核的记录',
        '调整正品产量用 data.changePieces；查看/调整明细记录用 data.openChangeLog 打开弹窗',
    ],
    terms: {
        Status: '界面派生：Flag=1 显示审核，Flag2=1 显示调整',
        ZPTime: '界面派生：Cycle * Pieces / 3600，接口不返回',
        Pieces: '正品产量，可在表格内联修改',
        DispatchNo: '派工单号；查询条里的派工单号是表内筛选，不会重新请求后端',
    },
    cautions: [
        'query.set 会重新请求后端；data.filter 只在已查回结果里筛选',
        '底部统计行不是业务记录，不要把它当订单行',
        '补打条码/打印按项目约定未迁',
    ],
};

function queryFields(query: ProductionMonitorQueryState | null): UIField[] {
    return [
        {id: 'startDate', label: '开始日期', type: 'date', value: query?.startDate ?? ''},
        {id: 'endDate', label: '结束日期', type: 'date', value: query?.endDate ?? ''},
        {id: 'orderCode', label: '订单号', type: 'text', value: query?.orderCode ?? ''},
        {id: 'machineCode', label: '机台号', type: 'text', value: query?.machineCode ?? ''},
        {id: 'roomCode', label: '厂别', type: 'text', value: query?.roomCode ?? ''},
    ];
}

export function createProductionMonitorBridge(read: () => ProductionMonitorBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: PRODUCTION_MONITOR_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: ['Status', 'DateStartShift', 'RoomCode', 'MachCode', 'GroupCode2', 'Shift2', 'OpeName', 'OrderCode', 'DispatchNo', 'ProductName', 'LiLunQty', 'MacPieces', 'ChangePieces', 'Pieces', 'TargetPieces'],
        columnHints: {
            Status: '审核 / 调整 / 审核调整，来自 Flag 与 Flag2',
            Pieces: '正品产量，非负整数',
            ZPTime: '正品用时 = Cycle * Pieces / 3600',
            ChangePieces: '调整产量',
        },
        waitSelected: async (rowId) => {
            const deadline = Date.now() + 600;
            while (Date.now() < deadline) {
                const ctx = read();
                if (ctx.activeRow && String(ctx.activeRow.ID ?? '') === rowId) return true;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            return read().selectionCount > 0;
        },
    });

    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        'query.set': async (params) => {
            const ctx = read();
            const fallback = ctx.query;
            const startDate = toStringOrEmpty(params.startDate).trim() || fallback?.startDate || '';
            const endDate = toStringOrEmpty(params.endDate).trim() || fallback?.endDate || '';
            if (!startDate || !toDayjs(startDate)) throw new Error('请传有效的 startDate（YYYY-MM-DD）');
            if (!endDate || !toDayjs(endDate)) throw new Error('请传有效的 endDate（YYYY-MM-DD）');
            const next: ProductionMonitorQueryState = {
                startDate,
                endDate,
                orderCode: params.orderCode === undefined ? fallback?.orderCode ?? '' : toStringOrEmpty(params.orderCode).trim(),
                machineCode: params.machineCode === undefined ? fallback?.machineCode ?? '' : toStringOrEmpty(params.machineCode).trim(),
                roomCode: params.roomCode === undefined ? fallback?.roomCode ?? '' : toStringOrEmpty(params.roomCode).trim(),
            };
            await ctx.applyQuery(next);
            return `已按 ${next.startDate} ~ ${next.endDate} 重新查询`;
        },
        'data.changePieces': async (params) => {
            const rowId = toStringOrEmpty(params.rowId).trim();
            if (!rowId) throw new Error('请传 rowId（来自 data.page 的 rowId）');
            const pieces = Number(params.pieces);
            if (!Number.isInteger(pieces) || pieces < 0) throw new Error('pieces 必须是非负整数');
            await read().changePieces(rowId, pieces);
            return `已将 ${rowId} 的正品产量调整为 ${pieces}`;
        },
        'data.openChangeLog': (params) => {
            const rowId = toStringOrEmpty(params.rowId).trim();
            if (!rowId) throw new Error('请传 rowId（来自 data.page 的 rowId）');
            read().openChangeLog(rowId);
            return `已打开 ${rowId} 的产量差异调整表`;
        },
    };

    read().commands.forEach((item) => {
        if (!item.onClick) return;
        handlers[item.key] = async () => {
            const latest = read().commands.find((command) => command.key === item.key) ?? item;
            if (latest.disabled) return `「${latest.label}」现在不可用：请先用 data.select 选中记录`;
            await Promise.resolve(latest.onClick?.());
            return latest.waitConfirm
                ? `「${latest.label}」已触发，等待用户确认`
                : `已执行：${latest.label}`;
        };
    });

    handlers.audit = async () => {
        const latest = read().commands.find((command) => command.key === 'audit');
        if (latest?.disabled) throw new Error('审核现在不可用：请先用 data.select 选中至少一条记录');
        await read().auditSelected();
        return '已执行：审核';
    };

    return {
        snapshot: (): UISnapshotData => {
            const ctx = read();
            const query = queryFields(ctx.query);
            return {
                view: ctx.view,
                title: 'MIS > 产量差异调整',
                mode: 'list',
                guide: GUIDE,
                actions: [
                    ...ctx.commands.map((item) => ({
                        id: item.key,
                        label: item.label,
                        group: 'toolbar' as const,
                        disabled: item.disabled,
                        waitConfirm: item.waitConfirm,
                        disabledReason: item.disabled ? '需要先选中至少一条记录：用 data.select 传 rowId' : undefined,
                    })),
                    ...tableBridge.actions(),
                    {
                        id: 'query.set',
                        label: '设置查询条件',
                        group: 'filter',
                        params: query.map((field) => ({name: field.id, type: field.type, hint: field.label})),
                    },
                    {
                        id: 'data.changePieces',
                        label: '调整正品产量',
                        group: 'row',
                        params: [
                            {name: 'rowId', type: 'text', required: true, hint: '来自 data.page 的 rowId'},
                            {name: 'pieces', type: 'number', required: true, hint: '非负整数'},
                        ],
                    },
                    {
                        id: 'data.openChangeLog',
                        label: '查看调整记录',
                        group: 'row',
                        params: [{name: 'rowId', type: 'text', required: true, hint: '来自 data.page 的 rowId'}],
                    },
                ],
                query,
                tables: [tableBridge.data({active: ctx.activeRow})],
            };
        },
        handlers,
    };
}
