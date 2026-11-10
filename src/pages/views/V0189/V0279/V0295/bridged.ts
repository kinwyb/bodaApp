/**
 * V0189_V0279_V0295（计划管理 > 已下单汇总）的界面桥声明。
 *
 * 本页与 V0282 同型：没有业务命令，只有查询 + 单表 + 导出。
 * 桥负责发布表格读能力与 `query.set`，分组由页面列定义上的 `group: true` 交给 GridTable。
 */

import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge, type UIBridgeHandler, type UIBridgeHost} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {YUPAI_COMPLETE_GROUP_COLUMNS} from './columns';

export type YupaiCompleteGroupQuery = {
    org: string;
    orderCode: string;
};

export const COMPLETE_GROUP_ORG_OPTIONS = [
    {value: '', label: '全部'},
    {value: '0001E610000000KO20VW', label: '义乌'},
    {value: '0001E610000000KWHO9D', label: '越南'},
    {value: '0001E610000000KTWQDG', label: '山西'},
    {value: '~', label: '子公司'},
] as const;

const GUIDE: UIGuide = {
    summary: '已下单汇总：按组织和订单号查询订单/NC合同汇总，并按「下单月份」分组查看',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行',
        '表格默认按「下单月份」分组：屏幕上有组行、明细行和底部统计行',
        '换查询条件用 query.set：org 可选“全部 / 义乌 / 越南 / 山西 / 子公司”，orderCode 留空表示不限',
        '只想在已查回结果里临时收窄用 data.filter，不会重新请求',
    ],
    terms: {
        下单月份: 'CompleteMonth，取 CompleteDate 的 yyyy-MM；CompleteDate 为空时为“未知”，也是默认分组字段',
        组织: 'org：空值=全部，或义乌 / 越南 / 山西 / 子公司',
        CNYMoney: '人民币金额：Currency=“人民币”时等于合同金额，否则为 0',
        USDMoney: '美元金额：Currency 非“人民币”时等于合同金额，否则为 0',
        欠发货数: 'NoSendNum = NC合同下单数 - 发货数',
    },
    cautions: [
        '这张表默认按「下单月份」分组：回答订单条数时只数明细行，data.total 含组行和底部统计行',
        '组行与统计行不是订单数据，不要拿它们当某一张订单',
        '主表的 0 值金额与数量在界面上显示为空，但 data.page / data.row 里仍然是 0',
        '旧系统固定查询区间为“当前日期前一年 ~ 当前日期后一年”，页面没有日期范围输入控件',
    ],
};

export type YupaiCompleteGroupBridgeContext = {
    view: string;
    query: YupaiCompleteGroupQuery;
    applyQuery: (next: YupaiCompleteGroupQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(query: YupaiCompleteGroupQuery): UIField[] {
    const orgLabel = COMPLETE_GROUP_ORG_OPTIONS.find((item) => item.value === query.org)?.label ?? '全部';
    return [
        {
            id: 'org',
            label: '组织',
            type: 'select',
            value: orgLabel,
            options: COMPLETE_GROUP_ORG_OPTIONS.map((item) => item.label),
            hint: '全部 / 义乌 / 越南 / 山西 / 子公司',
        },
        {
            id: 'orderCode',
            label: '订单号',
            type: 'text',
            value: query.orderCode,
            hint: '按订单号查询；留空表示不限',
        },
    ];
}

function parseOrg(value: unknown): string | null {
    const raw = toStringOrEmpty(value).trim();
    if (!raw) return '';
    const byValue = COMPLETE_GROUP_ORG_OPTIONS.find((item) => item.value === raw);
    if (byValue) return byValue.value;
    const byLabel = COMPLETE_GROUP_ORG_OPTIONS.find((item) => item.label === raw);
    return byLabel ? byLabel.value : null;
}

function toQueryPatch(
    params: Record<string, unknown>,
    fallback: YupaiCompleteGroupQuery,
): Partial<YupaiCompleteGroupQuery> {
    const patch: Partial<YupaiCompleteGroupQuery> = {};
    if (params.org !== undefined) {
        const org = parseOrg(params.org);
        if (org !== null) patch.org = org;
    }
    if (params.orderCode !== undefined) {
        const orderCode = toStringOrEmpty(params.orderCode).trim();
        if (orderCode !== fallback.orderCode) patch.orderCode = orderCode;
    }
    return patch;
}

export function createYupaiCompleteGroupBridge(read: () => YupaiCompleteGroupBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: YUPAI_COMPLETE_GROUP_COLUMNS,
        rowKey: 'OrderCode',
        readTable: () => read().readTable(),
        keyFields: [
            'OrderCode',
            'CompleteDate',
            'BillNo',
            'CompleteMonth',
            'BillDate',
            'JHTotalNum',
            'BillTotalNum',
            'Currency',
            'USDMoney',
            'CNYMoney',
            'OutNum',
            'SendNum',
            'NoSendNum',
            'DSendDate',
        ],
        columnHints: {
            CompleteMonth: '下单月份，默认分组字段；CompleteDate 为空时显示“未知”',
            Currency: '人民币 / 美元等货币名称',
            CNYMoney: '人民币金额；非人民币合同为 0（界面显示为空）',
            USDMoney: '美元金额；人民币合同为 0（界面显示为空）',
            NoSendNum: '欠发货数 = NC合同下单数 - 发货数',
        },
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const query = currentQuery(ctx.query);
        return {
            view: ctx.view,
            title: '计划管理 > 已下单汇总',
            mode: 'list',
            guide: GUIDE,
            actions: [
                ...tableBridge.actions(),
                {
                    id: 'query.set',
                    label: '设置查询条件',
                    group: 'filter' as const,
                    params: query.map((field) => ({
                        name: field.id,
                        type: field.type,
                        options: field.options,
                        hint: field.hint ?? field.label,
                    })),
                },
            ],
            query,
            tables: [tableBridge.data()],
        };
    };

    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        'query.set': async (params) => {
            const ctx = read();
            const patch = toQueryPatch(params, ctx.query);
            if (Object.keys(patch).length === 0) {
                return `没有可设置的条件：org 可选 ${COMPLETE_GROUP_ORG_OPTIONS.map((item) => item.label).join('/')}；当前条件 ${JSON.stringify(ctx.query)}`;
            }
            const next = {...ctx.query, ...patch};
            await ctx.applyQuery(next);
            const org = COMPLETE_GROUP_ORG_OPTIONS.find((item) => item.value === next.org)?.label ?? '全部';
            return `已按组织「${org}」${next.orderCode ? `、订单号「${next.orderCode}」` : ''}重新查询`;
        },
    };

    return {
        snapshot,
        handlers,
    };
}
