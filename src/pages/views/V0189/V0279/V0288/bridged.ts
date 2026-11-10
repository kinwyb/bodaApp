import type {YupaiOrderCompleteDateType} from '@/api';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIAction, UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge, type UIBridgeHandler, type UIBridgeHost} from '@/pages/agent/ui-bridge';
import {toDayjs, toStringOrEmpty} from '@/utils';
import {YUPAI_COMPLETED_COLUMNS} from './columns';

export type YupaiCompletedQuery = {
    startDate: string;
    endDate: string;
    dateType: YupaiOrderCompleteDateType;
};

const DATE_TYPE_LABELS: Record<YupaiOrderCompleteDateType, string> = {
    1: '下单日期',
    2: '走货日期',
};

const GUIDE: UIGuide = {
    summary: '已下单列表：按日期类型和日期范围查询已完成下单的预订单，并按出货月份分组查看',
    steps: [
        '表格默认按出货月份分组，并且只展开到组行；data.total 含组行与底部统计行，回答明细条数时只数非组行',
        '数据行不在快照里：用 data.page 传 offset / limit 取；offset 0 = 屏幕第 1 行',
        '要换查询范围用 query.set，传 dateType、startDate、endDate 后会重新查库',
        '只想在当前结果里收窄用 data.filter（不重新查库）；例如按订单号精确筛选用 data.filter 的 OrderCode',
        '从其他页面带订单号打开时会自动设置 OrderCode 表筛选，清除它用 data.filter.clear',
    ],
    terms: {
        日期类型: 'query.set 的 dateType：下单日期=1，走货日期=2',
        出货月份: 'YPMonth，由走货日期 ZHDate 派生成 YYYY-MM，也是默认分组字段',
        NC下单总数: 'TotalNum，NC 已下单的总数量',
        NC下单款式数: 'Num，NC 已下单的款式数量',
    },
    cautions: [
        'data.total 是屏幕显示行数，不是接口返回的明细条数：分组表里含组行，底部还有统计行',
        'query.set 改的是数据范围，会重新请求；data.filter 只隐藏当前结果里的行，两者不要混用',
        '左右日期都包含在查询范围内；开始日期不能晚于结束日期',
    ],
};

export type YupaiCompletedBridgeContext = {
    view: string;
    query: YupaiCompletedQuery;
    applyQuery: (next: YupaiCompletedQuery) => Promise<boolean>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(query: YupaiCompletedQuery): UIField[] {
    return [
        {
            id: 'dateType',
            label: '日期类型',
            type: 'select',
            value: DATE_TYPE_LABELS[query.dateType],
            options: [DATE_TYPE_LABELS[1], DATE_TYPE_LABELS[2]],
        },
        {
            id: 'startDate',
            label: '开始日期',
            type: 'date',
            value: query.startDate,
            hint: '格式 YYYY-MM-DD，查询范围包含当天',
        },
        {
            id: 'endDate',
            label: '结束日期',
            type: 'date',
            value: query.endDate,
            hint: '格式 YYYY-MM-DD，查询范围包含当天',
        },
    ];
}

function queryActions(query: UIField[]): UIAction {
    return {
        id: 'query.set',
        label: '设置查询条件并重新查询',
        group: 'filter',
        params: query.map((field) => ({
            name: field.id,
            type: field.type,
            options: field.options,
            hint: field.hint ?? field.label,
        })),
    };
}

function parseDateType(value: unknown): YupaiOrderCompleteDateType | null {
    if (value === 1 || value === '1' || value === DATE_TYPE_LABELS[1]) return 1;
    if (value === 2 || value === '2' || value === DATE_TYPE_LABELS[2]) return 2;
    return null;
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 32));
}

export function createYupaiCompletedBridge(read: () => YupaiCompletedBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: YUPAI_COMPLETED_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: [
            'WorkPlace',
            'CompleteDate',
            'YPDate',
            'Ywy',
            'OrderCode',
            'YPMonth',
            'Qty',
            'Number',
            'TotalNum',
            'Num',
            'StyleCode',
            'ProduceName',
            'QRDate',
            'ZHDate',
        ],
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const query = currentQuery(ctx.query);
        return {
            view: ctx.view,
            title: '计划管理 > 预订单 > 已下单列表',
            mode: 'list',
            guide: GUIDE,
            actions: [
                ...tableBridge.actions(),
                queryActions(query),
            ],
            query,
            tables: [tableBridge.data()],
        };
    };

    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        'query.set': async (params) => {
            const ctx = read();
            const next: YupaiCompletedQuery = {...ctx.query};
            let changed = false;

            if (params.dateType !== undefined) {
                const dateType = parseDateType(params.dateType);
                if (!dateType) {
                    return '日期类型无效：只能传 1（下单日期）或 2（走货日期）';
                }
                if (dateType !== next.dateType) {
                    next.dateType = dateType;
                    changed = true;
                }
            }

            for (const field of ['startDate', 'endDate'] as const) {
                if (params[field] === undefined) continue;
                const value = toStringOrEmpty(params[field]).trim();
                if (!toDayjs(value)) {
                    return `${field === 'startDate' ? '开始' : '结束'}日期无效：请传 YYYY-MM-DD`;
                }
                const normalized = toDayjs(value)?.format('YYYY-MM-DD') ?? '';
                if (normalized !== next[field]) {
                    next[field] = normalized;
                    changed = true;
                }
            }

            if (toDayjs(next.startDate)!.isAfter(toDayjs(next.endDate)!)) {
                return '开始日期不能晚于结束日期';
            }
            if (!changed) return '查询条件没有变化，未重新查询';

            const ok = await ctx.applyQuery(next);
            if (!ok) return '已发起查询，但请求失败；列表仍保持原来的结果';

            await nextFrame();
            const rows = ctx.readTable()?.getFilteredRecords().length ?? 0;
            return `已按「${DATE_TYPE_LABELS[next.dateType]}」查询 ${next.startDate} 至 ${next.endDate}：当前结果 ${rows} 条明细`;
        },
    };

    return {
        snapshot,
        handlers,
    };
}
