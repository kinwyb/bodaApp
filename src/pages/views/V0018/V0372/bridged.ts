/**
 * V0018_V0372（生产看板 > 月生产数据）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**。
 * 本页没有命令条（刷新不迁、导出交给 FilterTable），桥提供表格读能力 + query.set。
 * 组织是多选（旧客户端 QuickBIOrg 勾选窗），orgIds 用逗号分隔字符串传递。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {now} from '@/utils';
import {productionColumnHints} from '../productionShared';
import {MONTH_PRODUCTION_ROW_KEY} from './columns';

export type MonthProductionQuery = {
    year: number;
    /** 选中的组织 ID 列表；空数组 = 不显示任何组织列 */
    orgIds: string[];
};

const MIN_YEAR = 2025;

const MONTH_PRODUCTION_GUIDE: UIGuide = {
    summary: '月生产数据：按年份查看所选组织（可多选）每月的织造、染色、缝制生产指标，义乌/越南两地可任意组合',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行',
        'data.page 默认只回周期与两地织造产量/次品率几列；要其它指标把对应字段放进 fields（字段名 = 组织前缀 YW/VN + 指标名），要全部列传 fields="*"（最多 45 列）',
        '换年份或组织用 query.set：year 是 2025 起的整数年份，orgIds 传逗号分隔的组织 ID（如 "义乌ID,越南ID"）；改完会重新查库',
        '只想在已查回的结果里临时筛一筛（不重新查库）用 data.filter',
    ],
    terms: {
        月: 'WeekName，形如 2025-03（接口用 WeekNum-60 表示月份）；行主键 _rowKey 与月名同值',
        组织前缀: '义乌=YW、越南=VN；列字段名 = 前缀 + 指标字段（如 YWZZZZTotalNum = 义乌织造产量）',
        织造指标: 'ZZ 开头：产量 ZZZZTotalNum、次品数 ZZZZCPNum、次品率 ZZCPRate、产出工时 ZZWorkHours、产出效率 ZZEfficiency、机台利用率 ZZUtilizationRate',
        缝制单件工时: 'FZOneWt，界面派生列 = 缝制产出工时/缝制产量*60（分钟），后端不返回',
        比率列: '以 Rate/Efficiency 结尾的字段，显示为百分数（如 85.5%）',
    },
    cautions: [
        'data.total 含底部统计行：回答「共几月」时只数明细行（一年 12 行）',
        '统计行口径：数量/工时类求和，比率/效率类取平均',
        '0 值显示为空白，空白不代表缺数据',
        '只有义乌/越南两个组织有指标列；选了其它组织不会出现列（与旧客户端一致）',
        '双击越南的织造列会打开织造明细弹窗（按机型拆分），那是用户交互，不是桥命令',
    ],
};

export type MonthProductionBridgeContext = {
    view: string;
    query: MonthProductionQuery;
    /** 组织多选候选（用户组织列表，与旧客户端 QuickBIOrg 一致） */
    orgOptions: Array<{value: string; label: string}>;
    columns: AppColumnDef[];
    applyQuery: (next: MonthProductionQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(ctx: MonthProductionBridgeContext): UIField[] {
    return [
        {id: 'year', label: '年份', type: 'number', value: ctx.query.year, hint: `${MIN_YEAR} 起的整数年份`},
        {
            id: 'orgIds',
            label: '组织',
            type: 'text',
            value: ctx.query.orgIds.join(','),
            hint: '逗号分隔的组织 ID，可多选；候选：' + ctx.orgOptions.map((o) => `${o.value}=${o.label}`).join('、'),
        },
    ];
}

function toQueryPatch(params: Record<string, unknown>, ctx: MonthProductionBridgeContext): Partial<MonthProductionQuery> {
    const patch: Partial<MonthProductionQuery> = {};
    const rawYear = params.year;
    const year = typeof rawYear === 'number' ? rawYear : typeof rawYear === 'string' ? Number(rawYear.trim()) : NaN;
    if (Number.isInteger(year) && year >= MIN_YEAR && year <= now().year()) {
        patch.year = year;
    }
    const rawOrgs = params.orgIds;
    const list = Array.isArray(rawOrgs)
        ? rawOrgs.filter((item): item is string => typeof item === 'string')
        : typeof rawOrgs === 'string' ? rawOrgs.split(',') : null;
    if (list) {
        const orgIds = list.map((item) => item.trim()).filter((item) => ctx.orgOptions.some((option) => option.value === item));
        // 去重且保持传入顺序；允许空数组（旧客户端允许一个都不勾）
        patch.orgIds = [...new Set(orgIds)];
    }
    return patch;
}

export function createMonthProductionBridge(read: () => MonthProductionBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: read().columns,
        rowKey: MONTH_PRODUCTION_ROW_KEY,
        readTable: () => read().readTable(),
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
            title: '生产看板 > 月生产数据',
            mode: 'list',
            guide: MONTH_PRODUCTION_GUIDE,
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
                    return `没有可设置的条件：year 要 ${MIN_YEAR} 起的整数年份，orgIds 要逗号分隔的组织 ID。当前条件 ${JSON.stringify(ctx.query)}`;
                }
                const next = {...ctx.query, ...patch};
                await ctx.applyQuery(next);
                const orgLabel = next.orgIds
                    .map((id) => ctx.orgOptions.find((option) => option.value === id)?.label ?? id)
                    .join('、');
                return `已按「${next.year} 年、组织=${orgLabel || '(未选)'}」重新查询`;
            },
        },
    };
}
