import type {AppColumnDef, FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';

export type EfficiencyQuery = {
    startDate: string;
    endDate: string;
};

export type EfficiencyBridgeContext = {
    view: string;
    title: string;
    query: EfficiencyQuery;
    columns: AppColumnDef[];
    applyQuery: (next: EfficiencyQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(query: EfficiencyQuery): UIField[] {
    return [
        {id: 'startDate', label: '开始日期', type: 'date', value: query.startDate},
        {id: 'endDate', label: '结束日期', type: 'date', value: query.endDate},
    ];
}

export function createEfficiencyBridge(
    read: () => EfficiencyBridgeContext,
    guide: UIGuide,
): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: read().columns,
        rowKey: '_rowKey',
        readTable: () => read().readTable(),
    });
    const query = () => currentQuery(read().query);
    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
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
    return {
        snapshot: (): UISnapshotData => ({
            view: read().view,
            title: read().title,
            mode: 'list',
            guide,
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
