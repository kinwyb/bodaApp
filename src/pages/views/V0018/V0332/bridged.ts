/**
 * V0018_V0332（生产看板 > 织造机型周数据）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**。
 * 本页没有命令条（刷新不迁、导出交给 FilterTable），桥提供表格读能力 + query.set。
 * 列随组织切换与机台数动态变化，columns 由页面经 context 传入。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {now} from '@/utils';
import {PRODUCTION_ORGS} from '../productionShared';
import {MACHINE_SIZES, MACHINE_WEEK_ROW_KEY} from './columns';

export type MachineWeekQuery = {
    year: number;
    /** 组织 ID；空串 = 全部 */
    orgId: string;
};

const MIN_YEAR = 2024;

const MACHINE_WEEK_GUIDE: UIGuide = {
    summary: '织造机型周数据：按年份查看义乌/越南各机型（12~21寸）每周的织造产出效率与机台利用率，表头括号里是机台数',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行',
        'data.page 默认只回周期与 12 寸两地的效率列；要其它机型把对应字段放进 fields（字段名 = 组织前缀 YW/VN + MZEfficiency 或 MZUtilizationRate + 尺寸，如 YWMZEfficiency14），要全部列传 fields="*"（最多 43 列）',
        '换年份或组织用 query.set：year 是 2024 起的整数年份，orgId 传组织 ID（空串 = 全部）；改完会重新查库',
        '只想在已查回的结果里临时筛一筛（不重新查库）用 data.filter',
    ],
    terms: {
        周: 'WeekName，形如 2025第03周；行主键 _rowKey 与周名同值',
        机型: '织造机尺寸（寸），12~21 共 10 档；表头「14寸(35)」的 35 是该机型各组织机台总数',
        产出效率: 'MZEfficiency，百分数（如 85.5%）',
        机台利用率: 'MZUtilizationRate，百分数',
        组织前缀: '义乌=YW、越南=VN；列头「义乌(12)」的 12 是该组织该机型的机台数',
    },
    cautions: [
        'data.total 含底部统计行：回答「共几周」时只数明细行',
        '统计行是各周比率的平均值，不是求和',
        '0 值显示为空白；某机型某组织没有机台时整列为空',
        '表头括号里的机台数来自数据（MZMachineCount），不是列定义的一部分，查回数据后才出现',
        '数据来自 SQL 直查 transitDB.ProductionWeekData（DataType=2），与周生产数据页同源但维度不同',
    ],
};

export type MachineWeekBridgeContext = {
    view: string;
    query: MachineWeekQuery;
    orgOptions: Array<{value: string; label: string}>;
    columns: AppColumnDef[];
    applyQuery: (next: MachineWeekQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(ctx: MachineWeekBridgeContext): UIField[] {
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

function toQueryPatch(params: Record<string, unknown>, ctx: MachineWeekBridgeContext): Partial<MachineWeekQuery> {
    const patch: Partial<MachineWeekQuery> = {};
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

/** 机型列的业务提示：组织 × 指标 × 尺寸逐一生成 */
function machineColumnHints(): Record<string, string> {
    const hints: Record<string, string> = {
        WeekName: '周名（2025第03周）；行主键 _rowKey 与其同值',
        WeekStartDate: '周开始日期 YYYY-MM-DD',
        WeekEndDate: '周结束日期 YYYY-MM-DD',
    };
    for (const org of PRODUCTION_ORGS) {
        for (const size of MACHINE_SIZES) {
            hints[`${org.prefix}MZEfficiency${size}`] = `${org.name}·${size}寸·织造产出效率，百分数`;
            hints[`${org.prefix}MZUtilizationRate${size}`] = `${org.name}·${size}寸·织造机台利用率，百分数`;
        }
    }
    return hints;
}

export function createMachineWeekBridge(read: () => MachineWeekBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: read().columns,
        rowKey: MACHINE_WEEK_ROW_KEY,
        readTable: () => read().readTable(),
        keyFields: [
            'WeekName', 'WeekStartDate', 'WeekEndDate',
            'YWMZEfficiency12', 'VNMZEfficiency12',
            'YWMZUtilizationRate12', 'VNMZUtilizationRate12',
        ],
        columnHints: machineColumnHints(),
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const query = currentQuery(ctx);
        return {
            view: ctx.view,
            title: '生产看板 > 织造机型周数据',
            mode: 'list',
            guide: MACHINE_WEEK_GUIDE,
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
    };
}
