import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {SALARY_GROUP_COLUMNS} from './columns';

export type SalaryGroupQuery = {
    startDate: string;
    endDate: string;
    orderCode: string;
};

const GUIDE: UIGuide = {
    summary: '织造工资汇总：按日期范围和订单号汇总员工正品、废次品数量与计件工资',
    steps: [
        '数据行不在快照里：用 data.page 取当前显示顺序的数据',
        '换查询条件用 query.set，日期用 YYYY-MM-DD',
        '只想在当前结果内筛选用 data.filter，不会重新请求',
    ],
    cautions: ['首屏不会自动查询；设置查询条件后才会加载数据。'],
};

export type SalaryGroupBridgeContext = {
    view: string;
    query: SalaryGroupQuery | null;
    applyQuery: (next: SalaryGroupQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(query: SalaryGroupQuery | null): UIField[] {
    return [
        {id: 'startDate', label: '开始日期', type: 'date', value: query?.startDate ?? ''},
        {id: 'endDate', label: '结束日期', type: 'date', value: query?.endDate ?? ''},
        {id: 'orderCode', label: '订单号', type: 'text', value: query?.orderCode ?? ''},
    ];
}

export function createSalaryGroupBridge(read: () => SalaryGroupBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: SALARY_GROUP_COLUMNS,
        rowKey: 'OpeCode',
        readTable: () => read().readTable(),
        keyFields: ['RoomCode', 'OpeCode', 'OpeName', 'Pieces', 'Discards', 'CpQty', 'Salary'],
        columnHints: {Salary: '计件工资，底部统计行求和'},
    });
    const query = () => currentQuery(read().query);
    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        'query.set': async (params) => {
            const ctx = read();
            const next = {
                startDate: toStringOrEmpty(params.startDate).trim() || ctx.query?.startDate || '',
                endDate: toStringOrEmpty(params.endDate).trim() || ctx.query?.endDate || '',
                orderCode: params.orderCode === undefined
                    ? ctx.query?.orderCode ?? ''
                    : toStringOrEmpty(params.orderCode).trim(),
            };
            await ctx.applyQuery(next);
            return `已按 ${next.startDate} ~ ${next.endDate} 重新查询`;
        },
    };
    return {
        snapshot: (): UISnapshotData => ({
            view: read().view,
            title: 'MIS > 工资汇总',
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
