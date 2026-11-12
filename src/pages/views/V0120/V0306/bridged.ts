import type {MisProductOutStoreBill} from '@/api';
import type {CommandItem} from '@/components/CommandBar';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {OUT_STORE_BILL_COLUMNS, OUT_STORE_DETAIL_COLUMNS} from './columns';

export type OutStoreQuery = {
    startDate: string;
    endDate: string;
};

export type OutStoreBridgeContext = {
    view: string;
    query: OutStoreQuery;
    applyQuery: (next: OutStoreQuery) => Promise<void>;
    commands: CommandItem[];
    selected: MisProductOutStoreBill | null;
    readBillTable: () => FilterTableApi | null;
    readDetailTable: () => FilterTableApi | null;
};

const GUIDE: UIGuide = {
    summary: '白坯出库单：按日期查询出库单，主表选中单据后查看下方条码明细',
    steps: [
        '主表是 bills，明细表是 details；定位时必须用 tables[].name',
        '换日期范围用 query.set，日期格式 YYYY-MM-DD',
        '新增用新增出库单命令，删除前需要用户在确认框确认',
    ],
    cautions: ['打印按项目约定未迁；导出只导出当前主表。'],
};

function queryFields(query: OutStoreQuery): UIField[] {
    return [
        {id: 'startDate', label: '开始日期', type: 'date', value: query.startDate},
        {id: 'endDate', label: '结束日期', type: 'date', value: query.endDate},
    ];
}

export function createOutStoreBridge(read: () => OutStoreBridgeContext): UIBridgeHost {
    const billsBridge = createTableBridge({
        name: 'bills',
        columns: OUT_STORE_BILL_COLUMNS,
        rowKey: 'BillID',
        readTable: () => read().readBillTable(),
        keyFields: ['BillCode', 'BillDate', 'CreateUser', 'CreateTime'],
    });
    const detailsBridge = createTableBridge({
        name: 'details',
        columns: OUT_STORE_DETAIL_COLUMNS,
        rowKey: 'QRCode',
        readTable: () => read().readDetailTable(),
        keyFields: ['OrderCode', 'ProductCode', 'ProductName', 'Color', 'Size', 'DispatchNo', 'DataShiftStart', 'MachCode', 'Qty'],
    });
    const handlers: Record<string, UIBridgeHandler> = {
        ...billsBridge.handlers,
        ...detailsBridge.handlers,
        'query.set': async (params) => {
            const ctx = read();
            const next = {
                startDate: toStringOrEmpty(params.startDate).trim() || ctx.query.startDate,
                endDate: toStringOrEmpty(params.endDate).trim() || ctx.query.endDate,
            };
            await ctx.applyQuery(next);
            return `已按 ${next.startDate} ~ ${next.endDate} 重新查询`;
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
            return {
                view: ctx.view,
                title: 'V0120 > 白坯出库单',
                mode: 'list',
                guide: GUIDE,
                actions: [
                    ...ctx.commands.map((item) => ({
                        id: item.key,
                        label: item.label,
                        group: 'toolbar' as const,
                        disabled: item.disabled,
                        waitConfirm: item.waitConfirm,
                    })),
                    ...billsBridge.actions(),
                    ...detailsBridge.actions(),
                    {
                        id: 'query.set',
                        label: '设置查询条件',
                        group: 'filter',
                        params: queryFields(ctx.query).map((field) => ({name: field.id, type: field.type, hint: field.label})),
                    },
                ],
                query: queryFields(ctx.query),
                tables: [
                    billsBridge.data({active: ctx.selected}),
                    detailsBridge.data(),
                ],
            };
        },
        handlers,
    };
}
