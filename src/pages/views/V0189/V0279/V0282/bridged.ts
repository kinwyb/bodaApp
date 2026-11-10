/**
 * V0189_V0279_V0282（计划管理 > 预排汇总）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`）。删掉它，本页对 agent 立刻隐身。
 *
 * 本页比 V0280 简单一档，因为它**没有命令条**（旧客户端的「刷新」不迁、「导出」交给
 * FilterTable）。所以桥里没有动作表要同步，只有两件事：
 * 1. 表格的读能力 —— 全部来自 `createTableBridge`（列目录、行数、排序、按行号取数）；
 * 2. `query.set` —— 「查哪批数据」，要发请求，只有页面知道怎么发。
 *
 * 三条约束与其它页一致：只放常量与纯函数（不导出组件、不调 hook）；
 * 页面把「怎么取当前状态」以取值函数传进来；不重复描述表格能力。
 */

import type {YupaiOrderGroupDateType} from '@/api';
import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {PRESCHEDULE_COLUMNS} from './columns';
// 机型列「寸/针」的术语表暂时住在 V0280，等第三处用到再提到共用位置 —— 复制一份必然漂移
import {MACHINE_SIZE_FIELD_HINTS, MACHINE_SIZE_GUIDE_TERM} from '../V0280/machineSize';

/** 页面级查询条件（顶部表单）：改完会重新查库 */
export interface PrescheduleQuery {
    /** 0 全部 / 1 新增 / 2 更新 */
    dateType: YupaiOrderGroupDateType;
    /** 开始日期 YYYY-MM-DD */
    startDate: string;
    /** 结束日期 YYYY-MM-DD */
    endDate: string;
}

const DATE_TYPE_VALUES = ['0', '1', '2'];

/**
 * 页面自述：只写快照里推不出来的东西（操作顺序、前置条件、业务术语、陷阱）。
 *
 * 不写命令清单（命令已经在 actions 里）；不从页面数据生成（这里是可信内容）。
 */
const PRESCHEDULE_GUIDE: UIGuide = {
    summary: '预排汇总：按「全部 / 新增 / 更新」加日期范围筛出预订单，按出货月份分组看各机型尺码的数量分布',
    steps: [
        '数据行不在快照里：用 data.page 传 offset / limit 取，offset 0 = 用户屏幕第 1 行（「第 5 条」传 offset=4）',
        'data.page 默认只回认单与数量那几列；要机型尺码（如「12寸960针有多少量」）就把对应 MCSize 列放进 fields，' +
        '要全部列传 fields="*"（共 44 列，一次 20 行会很占上下文）',
        '换数据范围用 query.set：dateType 只认 0 / 1 / 2，日期一律 YYYY-MM-DD；改完会重新查库',
        '只想在已查回的结果里临时筛一筛（不重新查库）用 data.filter —— 它只是前端隐掉几行',
    ],
    terms: {
        出货月份: 'YPMonth，形如 2026-11；这也是表格默认的分组维度',
        下单月份: 'XDMonth，按确认下单期(QRDate)算出的年月，**界面派生列**（后端没有这个字段）',
        类型: 'dateType：0 全部 / 1 新增 / 2 更新，决定按哪种日期口径筛订单（语义在后端）',
        rowId: '预订单主键（ID 字段），不要用行号 —— 排序或分组一变行号就全错',
        '尺码分布(寸/针机型)': MACHINE_SIZE_GUIDE_TERM,
    },
    cautions: [
        '这张表默认按「出货月份」分组：屏幕上有明细行、组行（组标题）和底部统计行。' +
        '回答「共几条」时只数明细行，data.total 是三者的总和',
        '选「全部」时日期不参与筛选（界面上日期框是禁用态），此时改日期不会改变结果',
        'query.set 与 data.filter 是两件事：前者重新查库、影响整张表；后者只在当前这批数据里隐藏行。' +
        '行数比预期少时两边都要看',
        '组行与统计行不是业务数据，别把它们当成某一张订单',
    ],
};

/** 页面交给桥的东西：只有状态与能力，没有桥的结构 */
export type PrescheduleBridgeContext = {
    /** 当前 View（菜单里配的 V0189_V0279_V0282） */
    view: string;
    /** 当前查询条件 */
    query: PrescheduleQuery;
    /** 用新条件重新查询：页面负责落 state、拉数据，并等请求落地再 resolve */
    applyQuery: (next: PrescheduleQuery) => Promise<void>;
    /**
     * 取表格实例（`() => tableRef.current`）。
     *
     * 「用户看到的第几行是什么」只有表格知道 —— 分组、排序、统计行都发生在表格里，
     * 页面 state 里没有这些信息。
     */
    readTable: () => FilterTableApi | null;
};

/**
 * 把 agent 传来的查询参数收敛成查询条件：只认已知字段，避免脏值进 state。
 *
 * `dateType` 可能是数字、字符串或不在 0/1/2 里的值 —— 一律挡掉，
 * 否则后端会按一个没定义的口径查，结果看着像「查不到数据」。
 */
function toQueryPatch(
    params: Record<string, unknown>,
    fallback: PrescheduleQuery,
): Partial<PrescheduleQuery> {
    const patch: Partial<PrescheduleQuery> = {};
    const rawType = params.dateType;
    const type = typeof rawType === 'number' ? String(rawType) : typeof rawType === 'string' ? rawType.trim() : '';
    if (DATE_TYPE_VALUES.includes(type)) {
        patch.dateType = Number(type) as YupaiOrderGroupDateType;
    }
    if (typeof params.startDate === 'string' && params.startDate.trim()) {
        patch.startDate = params.startDate.trim();
    }
    if (typeof params.endDate === 'string' && params.endDate.trim()) {
        patch.endDate = params.endDate.trim();
    }
    // 兜底：日期区间反了就换回来，否则后端查出空表，看着像没数据
    const next = {...fallback, ...patch};
    if (next.startDate > next.endDate) {
        [next.startDate, next.endDate] = [next.endDate, next.startDate];
        patch.startDate = next.startDate;
        patch.endDate = next.endDate;
    }
    return patch;
}

/** 查询条件的展示值与命令参数声明 —— 一处维护，快照与命令不会对不上 */
function currentQuery(query: PrescheduleQuery): UIField[] {
    return [
        {
            id: 'dateType',
            label: '类型',
            type: 'select',
            options: DATE_TYPE_VALUES,
            value: String(query.dateType),
            hint: '0 全部 / 1 新增 / 2 更新（选 0 时日期不参与筛选）',
        },
        {id: 'startDate', label: '开始日期', type: 'date', value: query.startDate, hint: 'YYYY-MM-DD'},
        {id: 'endDate', label: '结束日期', type: 'date', value: query.endDate, hint: 'YYYY-MM-DD'},
    ];
}

/**
 * 装配本页的界面桥宿主。
 *
 * 吃取值函数而不是 ctx 对象：桥在「被调用的那一刻」才读页面状态，
 * 所以宿主可以长期不变，读到的永远是最新的 query 与表格。
 */
export function createPrescheduleBridge(read: () => PrescheduleBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: PRESCHEDULE_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        /*
         * 默认投影列：认单 + 数量 + 几个关键日期。
         *
         * **刻意不含 17 个尺码列** —— 这页一屏 44 列，全给是最贵的一帧，
         * 而尺码是「问到了才要」的细节（guide 的 steps 里教模型怎么传 fields）。
         */
        keyFields: [
            'YPMonth',
            'WorkPlace',
            'YPDate',
            'Ywy',
            'OrderCode',
            'Qty',
            'Number',
            'StyleCode',
            'ProduceName',
            'XDMonth',
            'JHDate',
            'QRDate',
            'ZHDate',
            'XDRate',
        ],
        columnHints: {
            YPMonth: '出货月份，形如 2026-11，也是表格的默认分组维度',
            XDMonth: '下单月份：按确认下单期(QRDate)算出的年月，界面派生列',
            Qty: '整单总数量',
            Number: '款式数量（与 Qty 不同：这是一单里这一款的数量）',
            ...MACHINE_SIZE_FIELD_HINTS,
        },
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        const query = currentQuery(ctx.query);
        return {
            view: ctx.view,
            title: '计划管理 > 预排汇总',
            mode: 'list',
            guide: PRESCHEDULE_GUIDE,
            actions: [
                // 取数 / 取整行 / 选中 / 筛选：与业务无关，全在通用表格桥里
                ...tableBridge.actions(),
                {
                    /*
                     * 查询条件改的是「查哪批数据」，要发请求，这个语义只有页面知道；
                     * 表上的筛选则相反，列上配了 filterType 就全自动。
                     */
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
            /*
             * 单表页面也是数组。
             *
             * 不传 `selection`/`active`：这一页没有「选中行驱动按钮」的需求，
             * 表格自己的选中态（用户点选、框选）由表桥读，页面不必再维护一份。
             */
            tables: [tableBridge.data()],
        };
    };

    return {
        snapshot,
        handlers: {
            ...tableBridge.handlers,
            /** 改查询条件：等请求真的落地再回执，否则补丁里的行数还是旧的 */
            'query.set': async (params) => {
                const ctx = read();
                const patch = toQueryPatch(params, ctx.query);
                if (Object.keys(patch).length === 0) {
                    return `没有可设置的条件：dateType 只认 0 / 1 / 2，日期要 YYYY-MM-DD。当前条件 ${JSON.stringify(ctx.query)}`;
                }
                const next = {...ctx.query, ...patch};
                await ctx.applyQuery(next);
                return `已按「类型=${next.dateType}，${next.startDate} ~ ${next.endDate}」重新查询`;
            },
        },
        /*
         * 不报 ready：挂载即可用。
         *
         * 快照里没有数据行（只有列目录与行数），列定义是页面常量。
         * 拿「接口回来没有」当就绪条件，会让 agent 的导航等一个它用不到的东西，
         * 接口慢一点就变成「打开页面超时」。行数 0 → N 会由下一次 observe / 命令补丁自然带上。
         */
    };
}
