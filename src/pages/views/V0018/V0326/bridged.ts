/**
 * V0018_V0326（生产看板 > 周生产数据）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定。
 * 本页没有命令条（旧客户端的「刷新」不迁、「导出」交给 FilterTable），桥只做两件事：
 * 1. 表格的读能力 —— 全部来自 `createTableBridge`；
 * 2. `query.set` —— 年份 + 组织，改完重新查库并等请求落地。
 *
 * 列随组织切换动态变化，所以 columns 由页面经 context 传入，桥随 context 重建。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {now} from '@/utils';
import {productionColumnHints} from '../productionShared';
import {WEEK_PRODUCTION_ROW_KEY} from './columns';

/** 页面级查询条件：year 改完重查；orgId 只改列（桥里统一走重查，保证回执行数准确） */
export type WeekProductionQuery = {
    year: number;
    /** 组织 ID；空串 = 全部 */
    orgId: string;
};

const MIN_YEAR = 2024;

const WEEK_PRODUCTION_GUIDE: UIGuide = {
    summary: '周生产数据：按年份查看义乌/越南两地每周的织造、染色、缝制生产指标，可切换单个组织或查看全部',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行',
        'data.page 默认只回周期与织造产量/次品率几列；要其它指标把对应字段放进 fields（字段名 = 组织前缀 YW/VN + 指标名），要全部列传 fields="*"（最多 45 列，一次 20 行会很占上下文）',
        '换年份或组织用 query.set：year 是 2024 起的整数年份，orgId 传组织 ID（空串 = 全部）；改完会重新查库',
        '只想在已查回的结果里临时筛一筛（不重新查库）用 data.filter',
    ],
    terms: {
        周: 'WeekName，形如 2025第03周；行主键 _rowKey 与周名同值',
        组织前缀: '义乌=YW、越南=VN；列字段名 = 前缀 + 指标字段（如 YWZZZZTotalNum = 义乌织造产量）',
        织造指标: 'ZZ 开头：产量 ZZZZTotalNum、次品数 ZZZZCPNum、次品率 ZZCPRate、产出工时 ZZWorkHours、产出效率 ZZEfficiency、机台利用率 ZZUtilizationRate',
        缝制单件工时: 'FZOneWt，界面派生列 = 缝制产出工时/缝制产量*60（分钟），后端不返回',
        比率列: '以 Rate/Efficiency 结尾的字段，显示为百分数（如 85.5%）',
    },
    cautions: [
        'data.total 含底部统计行：回答「共几周」时只数明细行（一年约 52 行）',
        '统计行口径：数量/工时类求和，比率/效率类取平均，不是把各周比率相加',
        '0 值显示为空白（旧客户端同样处理），空白不代表缺数据',
        '选单个组织时列头是「指标(组织)」；选全部时按指标分组、列头是组织名 —— 同一份数据两种排布',
        '双击织造列会打开织造明细弹窗（按机型拆分），那是用户交互，不是桥命令',
    ],
};

export type WeekProductionBridgeContext = {
    view: string;
    query: WeekProductionQuery;
    /** 组织下拉候选（含「全部」空串项），随 userOrgs 加载变化 */
    orgOptions: Array<{value: string; label: string}>;
    /** 当前组织排布下的列定义（与页面同一份） */
    columns: AppColumnDef[];
    applyQuery: (next: WeekProductionQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(ctx: WeekProductionBridgeContext): UIField[] {
    return [
        {id: 'year', label: '年份', type: 'number', value: ctx.query.year, hint: `${MIN_YEAR} 起的整数年份`},
        {
            id: 'orgId',
            label: '组织',
            type: 'select',
            options: ctx.orgOptions.map((option) => option.value),
            value: ctx.query.orgId,
            hint: '组织 ID；空串 = 全部。候选：' + ctx.orgOptions.map((o) => `${o.value || '(空)'}=${o.label}`).join('、'),
        },
    ];
}

function toQueryPatch(params: Record<string, unknown>, ctx: WeekProductionBridgeContext): Partial<WeekProductionQuery> {
    const patch: Partial<WeekProductionQuery> = {};
    const rawYear = params.year;
    const year = typeof rawYear === 'number' ? rawYear : typeof rawYear === 'string' ? Number(rawYear.trim()) : NaN;
    if (Number.isInteger(year) && year >= MIN_YEAR && year <= now().year()) {
        patch.year = year;
    }
    if (typeof params.orgId === 'string') {
        const orgId = params.orgId.trim();
        if (ctx.orgOptions.some((option) => option.value === orgId)) {
            patch.orgId = orgId;
        }
    }
    return patch;
}

export function createWeekProductionBridge(read: () => WeekProductionBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: read().columns,
        rowKey: WEEK_PRODUCTION_ROW_KEY,
        readTable: () => read().readTable(),
        // 默认投影：周期 + 两地织造产量/次品率；不存在的列会被自动忽略
        keyFields: [
            'WeekName', 'WeekStartDate', 'WeekEndDate',
            'YWZZZZTotalNum', 'VNZZZZTotalNum',
            'YWZZCPRate', 'VNZZCPRate',
        ],
        columnHints: productionColumnHints(),
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const query = currentQuery(ctx);
        return {
            view: ctx.view,
            title: '生产看板 > 周生产数据',
            mode: 'list',
            guide: WEEK_PRODUCTION_GUIDE,
            actions: [
                ...tableBridge.actions(),
                {
                    id: 'query.set',
                    label: '设置查询条件',
                    group: 'filter' as const,
                    params: query.map((field) => ({
                        name: field.id,
                        type: field.type,
                        hint: field.hint ?? field.label,
                    })),
                },
            ],
            query,
            tables: [tableBridge.data()],
        };
    };

    return {
        snapshot,
        handlers: {
            ...tableBridge.handlers,
            'query.set': async (params) => {
                const ctx = read();
                const patch = toQueryPatch(params, ctx);
                if (Object.keys(patch).length === 0) {
                    return `没有可设置的条件：year 要 ${MIN_YEAR} 起的整数年份，orgId 要在候选里（空串 = 全部）。当前条件 ${JSON.stringify(ctx.query)}`;
                }
                const next = {...ctx.query, ...patch};
                await ctx.applyQuery(next);
                const orgLabel = ctx.orgOptions.find((option) => option.value === next.orgId)?.label ?? next.orgId;
                return `已按「${next.year} 年、组织=${orgLabel || '全部'}」重新查询`;
            },
        },
        // 不报 ready：快照只有列目录与行数，挂载即可用
    };
}
