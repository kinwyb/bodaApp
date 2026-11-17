/**
 * QuickBI 共用界面桥工厂（对应 C# Views/Dialog/QuickBI.cs 基类）。
 *
 * 注意文件名刻意**不叫 bridged.ts**：接桥标记按「页面目录下的 bridged.ts」判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`，glob 只扫 views/**），共用层不是页面。
 * 各页面目录留一份薄 bridged.ts 转导出本工厂，标记与实现各司其职。
 *
 * 页面结构：主表（KPI 月度指标，动态列）+ 点单元格展开的明细 Tabs（每标签一张表）。
 * 桥提供：两张表的读能力、query.set（年份/组织重查）、detail.open（等价于用户点单元格）、
 * 命令条动作（图表 / 配置明细）。
 */
import type {CommandItem} from '@/components/CommandBar';
import type {AppColumnDef, FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {now} from '@/utils';
import {KPI_ROW_KEY, UNCLICK_COLUMNS} from './columns';
import type {QuickBIConfig} from './types';

/** 页面级查询条件：年份 + 组织多选（至少一个），改完会重新查库 */
export type QuickBIQuery = {
    year: number;
    orgIds: string[];
};

function buildGuide(config: QuickBIConfig): UIGuide {
    return {
    summary: config.summary,
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行；列由存储过程动态返回，以快照列目录为准',
        '换年份或组织用 query.set：year 是整数年份，orgIds 传组织 ID（可多个，至少一个）；改完会重新查库',
        '看某个指标的明细用 detail.open：rowId 传主表行主键（_rowKey），field 传月份列的字段名；' +
        '明细出现在 detail 表（可能有多个标签页，tag 参数可选指定）',
        '用户要求分析（归因、构成、哪些单据/客户/渠道拖累指标）时，不要只看主表就出结论：' +
        '先定位指标行与用户关心时间点对应的月份列，detail.open 加载明细，再用 detail.page 取明细行，基于明细做分析',
        '只想在已查回的结果里临时筛一筛（不重新查库）用 data.filter',
    ],
    terms: {
        业务单元: '业务单元分组（纵向合并列），与「指标」共同决定点开哪些明细标签页',
        指标: 'KPI 指标名（纵向合并列）；图表命令按它画月度趋势',
        月份列: '列名含「月份」的列（如「1月份」），是明细取数的 DateDecs 参数；部分指标值是百分数字符串（如 95.5%）',
        rowId: '主表行主键（_rowKey 字段，行下标派生），重查后会变，别跨查询复用',
    },
    cautions: [
        '主表「业务单元 / 指标」纵向合并：合并块内只有首行有值，取数看到空值先想想是不是同一块',
        'data.total 含底部统计行（数值列自动求和）；回答「共几行指标」时只数明细行',
        '百分数列是字符串原值（95.5%），不是数值列，不参与合计',
        'detail 表是明细标签页里当前激活的那张；没打开明细时快照里没有它',
        '明细行数与主表数值没有直接的求和关系（明细是单据级记录，主表是聚合指标）',
        '主表只回答「值是多少」，回答不了「为什么 / 由什么构成」。分析类问题必须先加载明细再下结论，' +
        '直接拿主表聚合值出分析结果等于没分析',
        'detail.open 的 field 要选用户问题里时间点对应的月份列（如问 3 月就传「3月份」）；' +
        '时间点不明确时先向用户确认，不要随便挑一列加载',
    ],
    };
}

export type QuickBIBridgeContext = {
    view: string;
    query: QuickBIQuery;
    orgOptions: Array<{value: string; label: string}>;
    /** 主表动态列（与页面同一份） */
    columns: AppColumnDef[];
    /** 明细面板是否展开 */
    detailOpen: boolean;
    /** 当前明细标签页名 / 指标 / 月份列 */
    detailTag: string;
    detailKpi: string;
    detailField: string;
    /** 当前明细标签页的动态列 */
    detailColumns: AppColumnDef[];
    /** 页面命令条：动作表直接由它生成 */
    commands: CommandItem[];
    applyQuery: (next: QuickBIQuery) => Promise<void>;
    /** 等价于用户点单元格：按主表行主键 + 列字段名展开明细，返回回执文案 */
    openDetail: (rowId: string, field: string, tag?: string) => Promise<string>;
    readTable: () => FilterTableApi | null;
    readDetailTable: () => FilterTableApi | null;
};

function currentQuery(ctx: QuickBIBridgeContext): UIField[] {
    return [
        {id: 'year', label: '年份', type: 'number', value: ctx.query.year, hint: `整数年份，不超过 ${now().year()}`},
        {
            id: 'orgIds',
            label: '组织',
            type: 'text',
            value: ctx.query.orgIds.join(','),
            hint: '组织 ID，逗号分隔可多选（至少一个）。候选：' +
                ctx.orgOptions.map((option) => `${option.value}=${option.label}`).join('、'),
        },
    ];
}

function toQueryPatch(params: Record<string, unknown>, ctx: QuickBIBridgeContext): Partial<QuickBIQuery> {
    const patch: Partial<QuickBIQuery> = {};
    const rawYear = params.year;
    const year = typeof rawYear === 'number' ? rawYear : typeof rawYear === 'string' ? Number(rawYear.trim()) : NaN;
    if (Number.isInteger(year) && year >= 2000 && year <= now().year()) {
        patch.year = year;
    }
    const rawOrgs = params.orgIds;
    const list = Array.isArray(rawOrgs)
        ? rawOrgs.map((item) => String(item).trim())
        : typeof rawOrgs === 'string'
            ? rawOrgs.split(',').map((item) => item.trim())
            : [];
    const orgIds = list.filter((id) => ctx.orgOptions.some((option) => option.value === id));
    if (orgIds.length > 0) {
        patch.orgIds = orgIds;
    }
    return patch;
}

export function createQuickBIBridge(config: QuickBIConfig, read: () => QuickBIBridgeContext): UIBridgeHost {
    const guide = buildGuide(config);
    const mainBridge = createTableBridge({
        columns: read().columns,
        rowKey: KPI_ROW_KEY,
        readTable: () => read().readTable(),
        columnHints: {
            业务单元: '业务单元（纵向合并列）',
            指标: 'KPI 指标名（纵向合并列）；detail.open 按行 + 月份列展开它的明细',
        },
    });
    const detailBridge = createTableBridge({
        name: 'detail',
        columns: read().detailColumns,
        rowKey: KPI_ROW_KEY,
        readTable: () => read().readDetailTable(),
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const query = currentQuery(ctx);
        return {
            view: ctx.view,
            title: config.caption,
            mode: 'list',
            guide,
            actions: [
                ...ctx.commands.map((item) => ({
                    id: item.key,
                    label: item.label,
                    group: 'toolbar' as const,
                    danger: item.danger,
                    waitConfirm: item.waitConfirm,
                    disabled: item.disabled,
                    disabledReason: item.disabled ? '需要先选中一行：用 data.select' : undefined,
                })),
                ...mainBridge.actions(),
                ...(ctx.detailOpen ? detailBridge.actions() : []),
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
                {
                    id: 'detail.open',
                    label: '展开指标明细',
                    group: 'filter' as const,
                    params: [
                        {name: 'rowId', type: 'text', hint: '主表行主键（_rowKey）'},
                        {name: 'field', type: 'text', hint: '月份列字段名（如「3月份」），不能是 业务单元/指标'},
                        {name: 'tag', type: 'text', hint: '可选：明细标签页名，缺省用当前/第一个标签'},
                    ],
                },
            ],
            query,
            tables: [
                mainBridge.data(),
                ...(ctx.detailOpen ? [detailBridge.data()] : []),
            ],
        };
    };

    const handlers: UIBridgeHost['handlers'] = {
        ...mainBridge.handlers,
        ...(read().detailOpen ? detailBridge.handlers : {}),
        'query.set': async (params) => {
            const ctx = read();
            const patch = toQueryPatch(params, ctx);
            if (Object.keys(patch).length === 0) {
                return `没有可设置的条件：year 要 2000~${now().year()} 的整数年份，orgIds 要在候选里且至少一个。当前条件 ${JSON.stringify(ctx.query)}`;
            }
            const next = {...ctx.query, ...patch};
            await ctx.applyQuery(next);
            const orgLabel = next.orgIds
                .map((id) => ctx.orgOptions.find((option) => option.value === id)?.label ?? id)
                .join('、');
            return `已按「${next.year} 年、组织=${orgLabel}」重新查询`;
        },
        'detail.open': async (params) => {
            const ctx = read();
            const rowId = typeof params.rowId === 'string' ? params.rowId.trim() : '';
            const field = typeof params.field === 'string' ? params.field.trim() : '';
            const tag = typeof params.tag === 'string' && params.tag.trim() ? params.tag.trim() : undefined;
            if (!rowId || !field) {
                return 'detail.open 需要 rowId（主表行主键）与 field（月份列字段名）';
            }
            if (UNCLICK_COLUMNS.includes(field)) {
                return `「${field}」列不触发明细：请传月份列的字段名`;
            }
            return ctx.openDetail(rowId, field, tag);
        },
    };
    read().commands.forEach((item) => {
        if (!item.onClick) return;
        handlers[item.key] = () => {
            const latest = read().commands.find((cmd) => cmd.key === item.key) ?? item;
            if (latest.disabled) return `「${latest.label}」现在不可用`;
            latest.onClick?.();
            if (latest.waitConfirm) {
                return `「${latest.label}」已触发，但还没有生效：界面上弹出了确认框，用户点「确认」之后才会执行。` +
                    '不要重复调用这条命令（会再弹一个框）；确认结果以稍后重新 ui_observe / 读表格为准';
            }
            return `已执行：${latest.label}`;
        };
    });

    return {snapshot, handlers};
}
