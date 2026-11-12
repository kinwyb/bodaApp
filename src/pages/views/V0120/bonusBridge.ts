import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHandler, UIBridgeHost} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {BONUS_DETAIL_COLUMNS, BONUS_SUMMARY_COLUMNS} from './bonusColumns';

export type BonusQuery = {
    month: string;
};

export type BonusBridgeContext = {
    view: string;
    title: string;
    query: BonusQuery;
    applyQuery: (next: BonusQuery) => Promise<void>;
    readSummaryTable: () => FilterTableApi | null;
    readDetailTable: () => FilterTableApi | null;
};

function currentQuery(query: BonusQuery): UIField[] {
    return [{id: 'month', label: '月份', type: 'text', value: query.month, hint: 'YYYY-MM'}];
}

export function createBonusBridge(
    read: () => BonusBridgeContext,
    guide: UIGuide,
): UIBridgeHost {
    const summaryBridge = createTableBridge({
        name: 'summary',
        columns: BONUS_SUMMARY_COLUMNS,
        rowKey: '_rowKey',
        readTable: () => read().readSummaryTable(),
        keyFields: ['Month', 'EmployeeNo', 'Employee', 'Bonus'],
    });
    const detailBridge = createTableBridge({
        name: 'detail',
        columns: BONUS_DETAIL_COLUMNS,
        rowKey: '_rowKey',
        readTable: () => read().readDetailTable(),
        keyFields: ['WorkDate', 'EmployeeNo', 'Employee', 'Qty', 'Bonus'],
    });
    const query = () => currentQuery(read().query);
    const handlers: Record<string, UIBridgeHandler> = {
        ...summaryBridge.handlers,
        ...detailBridge.handlers,
        'query.set': async (params) => {
            const month = toStringOrEmpty(params.month).trim();
            if (!/^\d{4}-\d{2}$/.test(month)) {
                return '月份格式应为 YYYY-MM';
            }
            await read().applyQuery({month});
            return `已按月份 ${month} 重新查询`;
        },
    };
    return {
        snapshot: (): UISnapshotData => ({
            view: read().view,
            title: read().title,
            mode: 'list',
            guide,
            actions: [
                ...summaryBridge.actions(),
                ...detailBridge.actions(),
                {
                    id: 'query.set',
                    label: '设置月份',
                    group: 'filter',
                    params: [{name: 'month', type: 'text', hint: 'YYYY-MM'}],
                },
            ],
            query: query(),
            tables: [summaryBridge.data(), detailBridge.data()],
        }),
        handlers,
    };
}
