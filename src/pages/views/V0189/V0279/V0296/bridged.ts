import type {CommandItem} from '@/components/CommandBar';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {DELIVER_PLAN_COLUMNS} from './columns';

const GUIDE: UIGuide = {
    summary: '已下单分期：查看预订单转为正式下单后的批次、日期与数量，默认按走货月份分组',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行',
        '这张表默认按「走货月份」分组；需要看某个月的订单时先展开对应组行',
        '临时收窄当前结果用 data.filter，不会重新请求；本页没有额外的服务端查询条件',
    ],
    terms: {
        Batch: '批次号,总批次；由后端 BatchNum,BatchCount 拼成',
        ZHMonth: '走货月份，取 ZHDate 的 yyyy-MM，也是默认分组字段',
        Qty: '本批次数量；组行显示该月份的数量合计',
        YPDate: '预排日期',
        JHDate: '预计下单期',
        CompleteDate: '实际下单期',
        ZHDate: '预计走货期',
    },
    cautions: [
        '这张表默认分组：屏幕行数包含组行，回答订单批次条数时只数明细行',
        '组行不是订单批次数据，不要把它当成某一条已下单分期记录',
        '接口没有返回业务主键，页面用订单号、批次和返回序号组成 _rowKey 供表格内部定位',
    ],
};

export type DeliverPlanBridgeContext = {
    view: string;
    readTable: () => FilterTableApi | null;
    commands: CommandItem[];
};

export function createDeliverPlanBridge(read: () => DeliverPlanBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: DELIVER_PLAN_COLUMNS,
        rowKey: '_rowKey',
        readTable: () => read().readTable(),
        keyFields: [
            'WorkPlace',
            'Ywy',
            'YPDate',
            'OrderCode',
            'Batch',
            'JHDate',
            'CompleteDate',
            'ZHDate',
            'Qty',
            'ZHMonth',
        ],
        columnHints: {
            Batch: '批次号,总批次',
            Qty: '本批次数量；组行是该月份明细数量合计',
            ZHMonth: '走货月份，取 ZHDate 的 yyyy-MM；表格默认分组字段',
        },
    });

    const snapshot = (): UISnapshotData => ({
        view: read().view,
        title: '计划管理 > 已下单分期',
        mode: 'list',
        guide: GUIDE,
        actions: [
            ...read().commands.map((item) => ({
                id: item.key,
                label: item.label,
                group: 'toolbar' as const,
                disabled: item.disabled,
            })),
            ...tableBridge.actions(),
        ],
        tables: [tableBridge.data()],
    });

    const handlers: Record<string, UIBridgeHandler> = {...tableBridge.handlers};
    read().commands.forEach((item) => {
        if (!item.onClick) return;
        handlers[item.key] = () => {
            const latest = read().commands.find((command) => command.key === item.key) ?? item;
            latest.onClick?.();
            return `已执行：${latest.label}`;
        };
    });

    return {
        snapshot,
        handlers,
    };
}
