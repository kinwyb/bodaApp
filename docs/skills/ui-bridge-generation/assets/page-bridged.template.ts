import type {FilterTableApi} from '@/components/grid-table';
import type {CommandItem} from '@/components/CommandBar';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge, type UIBridgeHandler, type UIBridgeHost} from '@/pages/agent/ui-bridge';
import {XXX_COLUMNS} from './columns';

const GUIDE: UIGuide = {
    summary: '一句话说明这个菜单能做什么',
    steps: ['数据行用 data.page 按屏幕行号取；整单核对用 data.row'],
    terms: {rowId: '业务主键，不要使用行号'},
    cautions: ['分组表的 total 含组行与统计行'],
};

export type XxxBridgeContext = {
    view: string;
    query: XxxQuery;
    commands: CommandItem[];
    applyQuery: (next: XxxQuery) => Promise<void>;
    readTable: () => FilterTableApi | null;
};

function currentQuery(query: XxxQuery): UIField[] {
    return [
        {id: 'Keyword', label: '关键字', type: 'text', value: query.Keyword},
        // 枚举的 options 与 query.set 参数从同一份字段描述派生
        /*
         * 日期 / 数值区间：**一项拆成起止两项**。页面控件是 RangePicker（FilterModel 存 {min, max}），
         * 给一个单值参数就只能表达「某一天」，用户在界面上筛的一段会丢掉一半。
         * hint 要写清格式、含当天、怎么清空 —— 不写时 params 只剩标签，模型看不出这是区间的一端。
         */
        // {id: 'DateFrom', label: '日期(起)', type: 'date', value: query.DateFrom ?? '',
        //  hint: '格式 YYYY-MM-DD，含当天；留空传空串 = 不限下限'},
        // {id: 'DateTo', label: '日期(止)', type: 'date', value: query.DateTo ?? '',
        //  hint: '格式 YYYY-MM-DD，含当天；留空传空串 = 不限上限'},
    ];
}

function toQueryPatch(params: Record<string, unknown>, _fallback: XxxQuery): Partial<XxxQuery> {
    const patch: Partial<XxxQuery> = {};
    if (typeof params.Keyword === 'string') patch.Keyword = params.Keyword.trim();
    // 只认已知字段；数字、日期、枚举在这里收敛
    // 区间是两项，各归各的键：只传一端就只改那一端（清空传空串），别把区间拼成一个字符串
    // if (typeof params.DateFrom === 'string') patch.DateFrom = params.DateFrom;
    // if (typeof params.DateTo === 'string') patch.DateTo = params.DateTo;
    return patch;
}

export function createXxxBridge(read: () => XxxBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: XXX_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: ['Code', 'Name', 'Status'],
        columnHints: {Status: '当前业务状态'},
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const query = currentQuery(ctx.query);
        return {
            view: ctx.view,
            title: '一级菜单 > 二级菜单',
            mode: 'list',
            guide: GUIDE,
            actions: [
                ...ctx.commands.map((item) => ({
                    id: item.key,
                    label: item.label,
                    group: 'toolbar' as const,
                    danger: item.danger,
                    waitConfirm: item.waitConfirm,
                    disabled: item.disabled,
                    disabledReason: item.disabled
                        ? '需要先选中一行：用 data.select 传 rowId'
                        : undefined,
                })),
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

    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        'query.set': async (params) => {
            const ctx = read();
            const patch = toQueryPatch(params, ctx.query);
            if (Object.keys(patch).length === 0) {
                return '没有可设置的查询条件';
            }
            await ctx.applyQuery({...ctx.query, ...patch});
            return '已按新条件重新查询';
        },
    };

    for (const item of read().commands) {
        if (!item.onClick) continue;
        handlers[item.key] = () => {
            const latest = read().commands.find((command) => command.key === item.key);
            if (!latest || latest.disabled) {
                return `「${latest?.label ?? item.label}」当前不可用：请先满足界面上的前置条件`;
            }
            latest.onClick?.();
            return latest.waitConfirm
                ? `「${latest.label}」已触发，但还没有生效：请在界面上完成确认`
                : `已执行：${latest.label}`;
        };
    }

    return {snapshot, handlers};
}
