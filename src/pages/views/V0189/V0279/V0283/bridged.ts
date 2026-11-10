import type {YupaiOrder} from '@/api';
import type {CommandItem} from '@/components/CommandBar';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge, type UIBridgeHandler, type UIBridgeHost} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {YUPAI_CANCELLED_COLUMNS} from './columns';

const GUIDE: UIGuide = {
    summary: '预排取消列表：查看已取消的预排订单，并恢复或彻底删除选中记录',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 屏幕第 1 行',
        '要恢复多行时，用 data.select 传 rowIds；恢复按钮支持批量',
        '删除只处理当前激活行：先用 data.select 选中目标，再执行 delete',
        '执行 reset / delete 后界面会弹确认框，用户点确认后才会真正调用接口',
    ],
    terms: {
        rowId: '预订单主键 ID',
        恢复: '把已取消的预订单重新放回预排列表',
        删除: '彻底删除已取消的预订单，删除后无法恢复',
    },
    cautions: [
        '命令 disabled 时先看 disabledReason',
        '取消列表只显示当前用户有部门权限的数据；非超级管理员还只显示本人创建的数据',
    ],
};

export type YupaiCancelledBridgeContext = {
    view: string;
    commands: CommandItem[];
    activeRow: YupaiOrder | null;
    activeRowCount: number;
    readTable: () => FilterTableApi | null;
    readActiveRow: () => YupaiOrder | null;
};

async function waitForActiveRow(
    readActiveRow: () => YupaiOrder | null,
    rowId: string,
    timeoutMs = 800,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (toStringOrEmpty(readActiveRow()?.ID) === rowId) return true;
        await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return false;
}

export function createYupaiCancelledBridge(read: () => YupaiCancelledBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: YUPAI_CANCELLED_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: [
            'WorkPlace',
            'DelTime',
            'YPDate',
            'Ywy',
            'OrderCode',
            'Qty',
            'Number',
            'StyleCode',
            'ProduceName',
            'HDWorkName',
            'QRDate',
            'ZHDate',
            'DelUser',
        ],
        waitSelected: (rowId) => waitForActiveRow(() => read().readActiveRow(), rowId),
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        return {
            view: ctx.view,
            title: '计划管理 > 预订单 > 预排取消列表',
            mode: 'list',
            guide: GUIDE,
            actions: [
                ...ctx.commands.map((item) => ({
                    id: item.key,
                    label: item.label,
                    group: 'toolbar' as const,
                    danger: item.danger,
                    waitConfirm: item.waitConfirm,
                    disabled: item.disabled,
                    disabledReason: item.disabled ? '需要先选中记录：用 data.select 传 rowIds' : undefined,
                })),
                ...tableBridge.actions(),
            ],
            tables: [
                tableBridge.data({
                    active: ctx.activeRow,
                    selection: {
                        count: ctx.activeRowCount,
                        activeRowId: ctx.activeRow?.ID ?? null,
                        rowIds: ctx.activeRow ? [ctx.activeRow.ID] : [],
                    },
                }),
            ],
        };
    };

    const handlers: Record<string, UIBridgeHandler> = {...tableBridge.handlers};
    read().commands.forEach((item) => {
        if (!item.onClick) return;
        handlers[item.key] = () => {
            const latest = read().commands.find((cmd) => cmd.key === item.key) ?? item;
            if (latest.disabled) {
                return `「${latest.label}」现在不可用：请先选中记录`;
            }
            latest.onClick?.();
            if (latest.waitConfirm) {
                return `「${latest.label}」已触发，但还没有生效：界面上弹出了确认框，用户点「确认」之后才会执行。`
                    + '不要重复调用这条命令；结果以稍后重新 ui_observe / 读表格为准';
            }
            return `已执行：${latest.label}`;
        };
    });

    return {
        snapshot,
        handlers,
        events: [
            {
                id: 'selection.change',
                label: '取消记录选中变化',
                mergeBy: ['table'],
                payload: [{name: 'rowId', type: 'text'}],
                hint: '用户点击、勾选或框选取消记录时上报',
            },
            {
                id: 'action.outcome',
                label: '需要确认的命令结果',
                delivery: 'immediate',
                waitConfirmFor: ['reset', 'delete'],
                mergeBy: ['actionId'],
                payload: [
                    {name: 'actionId', type: 'text', required: true},
                    {name: 'outcome', type: 'text', required: true},
                ],
                hint: '只在 agent 发起恢复或删除后，用户最终确认、取消或失败时立即上报',
            },
        ],
    };
}
