import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {SALARY_DETAIL_COLUMNS} from './columns';

export type SalaryDetailQuery = {
    startDate: string;
    endDate: string;
    orderCode: string;
    machineCode: string;
};

const GUIDE: UIGuide = {
    summary: '织造工资明细：按开始日期、结束日期、订单号和机台号查询计件工资明细',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行',
        '换查询条件用 query.set，日期一律 YYYY-MM-DD；机台号按文本匹配',
        '只想在已查回结果里临时收窄用 data.filter，不会重新请求',
    ],
    terms: {
        Salary: '计件工资金额，底部统计行求和',
        CpQty: '次品数',
        Discards: '折算废品',
        DateStartShift: '班次开始日期时间',
    },
    cautions: ['首屏不会自动查询；必须先设置条件并查询，或由用户点击查询按钮。'],
};

export type SalaryDetailBridgeContext = {
    view: string;
    query: SalaryDetailQuery | null;
    applyQuery: (next: SalaryDetailQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(query: SalaryDetailQuery | null): UIField[] {
    return [
        {id: 'startDate', label: '开始日期', type: 'date', value: query?.startDate ?? ''},
        {id: 'endDate', label: '结束日期', type: 'date', value: query?.endDate ?? ''},
        {id: 'orderCode', label: '订单号', type: 'text', value: query?.orderCode ?? ''},
        {id: 'machineCode', label: '机台号', type: 'text', value: query?.machineCode ?? ''},
    ];
}

function toQueryPatch(params: Record<string, unknown>, fallback: SalaryDetailQuery | null): Partial<SalaryDetailQuery> {
    const patch: Partial<SalaryDetailQuery> = {};
    for (const key of ['startDate', 'endDate'] as const) {
        const value = toStringOrEmpty(params[key]).trim();
        if (value) patch[key] = value;
    }
    if (params.orderCode !== undefined) patch.orderCode = toStringOrEmpty(params.orderCode).trim();
    if (params.machineCode !== undefined) patch.machineCode = toStringOrEmpty(params.machineCode).trim();
    if (!patch.startDate && fallback) patch.startDate = fallback.startDate;
    if (!patch.endDate && fallback) patch.endDate = fallback.endDate;
    return patch;
}

export function createSalaryDetailBridge(read: () => SalaryDetailBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: SALARY_DETAIL_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: ['DateStartShift', 'RoomCode', 'MachCode', 'OpeCode', 'OpeName', 'OrderCode', 'Pieces', 'Salary'],
        columnHints: {
            Salary: '计件工资金额；底部统计行求和',
            CpQty: '次品数',
            Discards: '折算废品',
        },
    });
    const query = () => currentQuery(read().query);
    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        'query.set': async (params) => {
            const ctx = read();
            const patch = toQueryPatch(params, ctx.query);
            const next = {
                startDate: patch.startDate ?? '',
                endDate: patch.endDate ?? '',
                orderCode: patch.orderCode ?? ctx.query?.orderCode ?? '',
                machineCode: patch.machineCode ?? ctx.query?.machineCode ?? '',
            };
            await ctx.applyQuery(next);
            return `已按 ${next.startDate} ~ ${next.endDate} 重新查询`;
        },
    };
    return {
        snapshot: (): UISnapshotData => ({
            view: read().view,
            title: 'MIS > 工资明细',
            mode: 'list',
            guide: GUIDE,
            actions: [
                ...tableBridge.actions(),
                {
                    id: 'query.set',
                    label: '设置查询条件',
                    group: 'filter',
                    params: query().map((field) => ({name: field.id, type: field.type, hint: field.label})),
                },
            ],
            query: query(),
            tables: [tableBridge.data()],
        }),
        handlers,
    };
}
