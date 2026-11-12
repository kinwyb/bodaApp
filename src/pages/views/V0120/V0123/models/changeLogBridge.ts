import type {GridTableApi} from '@/components/grid-table';
import type {ProductionMonitorDetail} from '@/api';
import type {UIBridgeHandler, UIDialogHost} from '@/pages/agent/ui-bridge';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import {CHANGE_LOG_DETAIL_COLUMNS, CHANGE_LOG_LOG_COLUMNS} from './changeLogColumns';

export type ChangeLogBridgeContext = {
    recordId: number | null;
    orderCode: string;
    dispatchNo: string;
    machCode: string;
    isTwins: boolean;
    loading: boolean;
    error?: string;
    activeDetail: ProductionMonitorDetail | null;
    readDetailTable: () => GridTableApi | null;
    readLogTable: () => GridTableApi | null;
    updateDetail: (patch: { GxProduction?: number; CpQty?: number }) => Promise<void>;
    close: () => void;
};

function parsePatch(params: Record<string, unknown>): { GxProduction?: number; CpQty?: number } {
    const source = typeof params.fields === 'string'
        ? JSON.parse(params.fields) as Record<string, unknown>
        : params.fields;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('请传 fields，例如 {"GxProduction": 100}');
    }
    const record = source as Record<string, unknown>;
    const patch: { GxProduction?: number; CpQty?: number } = {};
    if (record.GxProduction !== undefined) patch.GxProduction = Number(record.GxProduction);
    if (record.CpQty !== undefined) patch.CpQty = Number(record.CpQty);
    if (patch.GxProduction === undefined && patch.CpQty === undefined) {
        throw new Error('没有可写入的字段：只支持 GxProduction / CpQty');
    }
    for (const value of [patch.GxProduction, patch.CpQty]) {
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
            throw new Error('产量与次品数必须是非负整数');
        }
    }
    return patch;
}

export function createChangeLogBridge(read: () => ChangeLogBridgeContext): UIDialogHost {
    const detailTable = createTableBridge({
        name: 'detail',
        columns: CHANGE_LOG_DETAIL_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readDetailTable(),
        keyFields: ['DateRec', 'MachCode', 'OrderCode', 'StLot', 'StyleCode', 'StColor', 'StSize', 'MacProduction', 'GxProduction', 'CpQty'],
        columnHints: {
            GxProduction: '实际产量，可修改',
            CpQty: '次品数，仅双胞胎订单可修改',
        },
        waitSelected: async (rowId) => {
            const deadline = Date.now() + 600;
            while (Date.now() < deadline) {
                const active = read().activeDetail;
                if (active && String(active.ID ?? '') === rowId) return true;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            return false;
        },
    });
    const logTable = createTableBridge({
        name: 'log',
        columns: CHANGE_LOG_LOG_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readLogTable(),
        keyFields: ['DateRec', 'MachCode', 'OrderCode', 'StLot', 'Pieces', 'Discards', 'Reason', 'RecordBy', 'RecordTime'],
    });

    const handlers: Record<string, UIBridgeHandler> = {
        ...detailTable.handlers,
        ...logTable.handlers,
        'form.setMany': async (params) => {
            const ctx = read();
            if (!ctx.activeDetail) throw new Error('请先用 detail.select 选中一条明细');
            const patch = parsePatch(params);
            if (patch.CpQty !== undefined && !ctx.isTwins) {
                throw new Error('非双胞胎订单不能修改次品数 CpQty');
            }
            await ctx.updateDetail(patch);
            return '明细产量已修改';
        },
        'form.cancel': () => {
            read().close();
            return '已关闭产量差异调整表';
        },
    };

    return {
        snapshot: () => {
            const ctx = read();
            const detail = ctx.activeDetail;
            return {
                id: 'productionMonitorChangeLog',
                title: '产量差异调整表',
                mode: 'edit',
                recordId: ctx.recordId === null ? null : String(ctx.recordId),
                fields: [
                    {id: 'OrderCode', label: '订单号', type: 'text', value: ctx.orderCode, readOnly: true},
                    {id: 'DispatchNo', label: '派工单号', type: 'text', value: ctx.dispatchNo, readOnly: true},
                    {id: 'MachCode', label: '机台号', type: 'text', value: ctx.machCode, readOnly: true},
                    {id: 'DetailID', label: '明细 ID', type: 'text', value: detail?.ID ?? '', readOnly: true},
                    {id: 'DateRec', label: '日期', type: 'date', value: detail?.DateRec ?? '', readOnly: true},
                    {id: 'StLot', label: '批次号', type: 'text', value: detail?.StLot ?? '', readOnly: true},
                    {
                        id: 'MacProduction',
                        label: '机器产量',
                        type: 'number',
                        value: detail?.MacProduction ?? '',
                        readOnly: true
                    },
                    {
                        id: 'GxProduction',
                        label: '实际产量',
                        type: 'number',
                        value: detail?.GxProduction ?? '',
                        readOnly: !detail,
                        errors: ctx.error ? [ctx.error] : undefined,
                    },
                    {
                        id: 'CpQty',
                        label: '次品数',
                        type: 'number',
                        value: detail?.CpQty ?? '',
                        readOnly: !detail || !ctx.isTwins,
                        hint: ctx.isTwins ? '双胞胎订单可修改' : '非双胞胎订单只读',
                    },
                ],
                errors: ctx.error ? [ctx.error] : [],
                dirty: false,
            };
        },
        actions: () => [
            ...detailTable.actions(),
            ...logTable.actions(),
            {id: 'form.setMany', label: '修改产量', group: 'form'},
            {id: 'form.cancel', label: '关闭', group: 'form'},
        ],
        handlers,
        guide: {
            summary: '织造产量差异调整表：上方是班次明细，下方是选中明细的调整记录',
            steps: [
                '用 detail.page / detail.select 选中上方明细，log.page 读取下方调整记录',
                '修改实际产量用 form.setMany 传 {"GxProduction": 数量}；双胞胎订单还可传 CpQty',
            ],
            cautions: [
                '非双胞胎订单的 CpQty 只读',
                '修改会立即调用后端保存，没有单独的提交按钮',
            ],
        },
        ready: () => !read().loading,
    };
}
