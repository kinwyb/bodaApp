/**
 * V0189_V0279_V0297（计划管理 > 月份汇总）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`）。删掉它，本页对 agent 立刻隐身。
 *
 * 本页有三种「看数据的角度」，桥要如实分开：
 * 1. `month` —— 月份汇总表（一月一行）；
 * 2. `department` —— 部门汇总表（同一月份多行，每部门一行）；
 * 3. 图表 —— **不是第三张表**，而是月份汇总按「全部/义乌/越南/山西」挑两列画出来的堆叠柱，
 *    数值与 `month` 表同源。所以图表不单独占 `tables[]`，只用 `query.chartScope` 说明当前维度。
 *
 * 约束与其它页一致：只放常量与纯函数（不导出组件、不调 hook）；
 * 页面把「怎么取当前状态」以取值函数传进来；不重复描述表格能力。
 */

import type {FilterTableApi} from '@/components/grid-table';
import type {UIField, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {createTableBridge} from '@/pages/agent/ui-bridge';
import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {DEPARTMENT_SUMMARY_COLUMNS, MONTH_SUMMARY_COLUMNS} from './columns';

/**
 * 图表维度：-1 隐藏，其余对应 C# 的 `dataType`。
 *
 * 定义在桥文件里（而不是页面里）：`query.set` 的取值校验与快照的 options 都在这儿，
 * 页面只 import 类型，两边不会各写一份字面量。
 */
export type ChartScope = -1 | 0 | 1 | 2 | 3;

/** 页面级查询条件：年份决定查哪一年的数据 */
export interface MonthSummaryQuery {
    /** 年份参数，形如 `2024-01-01`（接口要完整日期，存储过程只读年份） */
    year: string;
}

const CHART_SCOPE_VALUES = ['-1', '0', '1', '2', '3'];

/** 维度 → 人话（快照里给模型看） */
const CHART_SCOPE_LABELS: Record<string, string> = {
    '-1': '隐藏（图表区收起，只看两张表）',
    '0': '全部产地',
    '1': '义乌',
    '2': '越南',
    '3': '山西',
};

/**
 * 页面自述：只写快照里推不出来的东西（操作顺序、业务术语、陷阱）。
 *
 * 不写命令清单（命令已经在 actions 里）；不从页面数据生成（这里是可信内容）。
 */
const MONTH_SUMMARY_GUIDE: UIGuide = {
    summary: '月份汇总：按年份看「预排数 / 下单数」的按月汇总（全部 / 义乌 / 越南 / 山西四个产地），'
        + '上方两张表、下方一张堆叠柱图',
    steps: [
        '两张表的命令前缀不同：月份汇总用 `month.page`，部门汇总用 `department.page`（行数少，一次就能取完）',
        '屏幕第 N 行传 offset=N-1；默认只回月份与四个产地的预排/下单数，要全列传 fields="*"',
        '换年份用 query.set 传 year（`YYYY` 或 `YYYY-MM-DD` 都收，统一按年初算）',
        '只想换图表看的产地（全部/义乌/越南/山西）也用 query.set 传 chartScope，**它不重新查库**，' +
        '只是换图表取哪两列 —— 数据本来就在表里的四组字段中',
    ],
    terms: {
        预排数: 'YPQty 系列：已排产但还没下生产单的数量',
        下单数: 'XDQty 系列：已经下了生产单的数量',
        产地: '四个分组：全部(All) / 义乌(Yw) / 越南(Vn) / 山西(Sx)，字段前缀一一对应',
        月份: 'ZHMonth（走货月份），形如 2026-11，是两张表的行维度、也是图表 X 轴',
        部门汇总: '按「月份 + 部门」分组，**同一月份会有多行**，不是重复数据',
        chartScope: '-1 隐藏图表 / 0 全部产地 / 1 义乌 / 2 越南 / 3 山西（只影响图表，不影响表格数据）',
        rowId: '月份汇总的 rowId 是月份本身；部门汇总的是「月份__部门ID」，不要用行号',
    },
    cautions: [
        '两张表口径不同，不能相加：月份汇总一月一行，部门汇总是同一批量的再切分（按月+部门），' +
        '「总预排量」只能从月份汇总里取',
        '表格里数量 0 显示为空白（业务口径：0 与「没排产」是一回事），**数据本身还是 0**，' +
        '别把空白当成缺数据',
        '图表选「隐藏」时图表区不渲染，此时没有图表可读；但两张表的数据完整，照常取',
        '图表数值与月份汇总同源，要「某产地某月多少」直接读月份汇总的对应列，不用去读图',
    ],
};

/** 页面交给桥的东西：只有状态与能力，没有桥的结构 */
export type MonthSummaryBridgeContext = {
    /** 当前 View（菜单里配的 V0189_V0279_V0297） */
    view: string;
    /** 当前年份条件 */
    query: MonthSummaryQuery;
    /** 图表当前维度 */
    chartScope: ChartScope;
    /** 换年份：页面负责落 state、拉数据，并等请求落地再 resolve */
    applyQuery: (next: MonthSummaryQuery) => Promise<void>;
    /** 换图表维度：**不重新查库**，只切图表取哪两列 */
    applyChartScope: (scope: ChartScope) => void;
    readMonthTable: () => FilterTableApi | null;
    readDepartmentTable: () => FilterTableApi | null;
};

/** 年份入参收敛：只认 `YYYY` 与 `YYYY-MM-DD`，统一补成年初（与页面 `toYearArgument` 同义） */
function normalizeYear(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    const yearOnly = /^(\d{4})$/.exec(value);
    if (yearOnly) return `${yearOnly[1]}-01-01`;
    const fullDate = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
    if (fullDate) return `${fullDate[1]}-01-01`;
    return null;
}

/** 图表维度入参收敛：数字或字符串都收，超出 -1..3 一律挡掉 */
function normalizeChartScope(raw: unknown): ChartScope | null {
    const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    if (!CHART_SCOPE_VALUES.includes(value)) return null;
    return Number(value) as ChartScope;
}

/** 查询条件的展示值与命令参数声明 —— 一处维护，快照与命令不会对不上 */
function currentQuery(query: MonthSummaryQuery, chartScope: ChartScope): UIField[] {
    return [
        {
            id: 'year',
            label: '年份',
            type: 'date',
            value: query.year,
            hint: '按年汇总；传 YYYY 或 YYYY-MM-DD 都行，只看年份那一段',
        },
        {
            id: 'chartScope',
            label: '图表',
            type: 'select',
            options: CHART_SCOPE_VALUES,
            value: String(chartScope),
            hint: CHART_SCOPE_LABELS[String(chartScope)] ?? '',
        },
    ];
}

/**
 * 装配本页的界面桥宿主。
 *
 * 吃取值函数而不是 ctx 对象：桥在「被调用的那一刻」才读页面状态，
 * 所以宿主可以长期不变，读到的永远是最新的 query、chartScope 与两张表。
 */
export function createMonthSummaryBridge(read: () => MonthSummaryBridgeContext): UIBridgeHost {
    /*
     * 两张表各一个桥，**名字必须不同**：命令前缀是 `month.*` 与 `department.*`，
     * 撞在一起模型就分不清在读哪张表（同 `name` 会让 `data.page` 指代不明）。
     */
    const monthBridge = createTableBridge({
        name: 'month',
        columns: MONTH_SUMMARY_COLUMNS,
        rowKey: 'ZHMonth',
        readTable: () => read().readMonthTable(),
        // 9 列都便宜，全给；图表维度相关的四组列也要能读到
        keyFields: ['ZHMonth', 'AllYPQty', 'AllXDQty', 'YwYPQty', 'YwXDQty', 'VnYPQty', 'VnXDQty', 'SxYPQty', 'SxXDQty'],
        columnHints: {
            ZHMonth: '走货月份 yyyy-MM，月份汇总的行维度',
            AllYPQty: '全部产地 预排数',
            AllXDQty: '全部产地 下单数',
            YwYPQty: '义乌 预排数',
            YwXDQty: '义乌 下单数',
            VnYPQty: '越南 预排数',
            VnXDQty: '越南 下单数',
            SxYPQty: '山西 预排数',
            SxXDQty: '山西 下单数',
        },
    });

    const departmentBridge = createTableBridge({
        name: 'department',
        columns: DEPARTMENT_SUMMARY_COLUMNS,
        rowKey: '_rowKey',
        readTable: () => read().readDepartmentTable(),
        keyFields: ['ZHMonth', 'Department', 'AllYPQty', 'AllXDQty', 'YwYPQty', 'YwXDQty', 'VnYPQty', 'VnXDQty', 'SxYPQty', 'SxXDQty'],
        columnHints: {
            Department: '部门名称；同一月份会出现多行（每部门一行）',
        },
    });

    const snapshot = (): UISnapshotData => {
        const ctx = read();
        return {
            view: ctx.view,
            title: '计划管理 > 月份汇总',
            mode: 'list',
            guide: MONTH_SUMMARY_GUIDE,
            actions: [
                ...monthBridge.actions(),
                ...departmentBridge.actions(),
                {
                    /*
                     * 改年份要重新查库（这个语义只有页面知道）；改 chartScope 只是换图表看的产地，
                     * 不重新请求 —— 两者都走这一条，回执里会说明做了什么。
                     */
                    id: 'query.set',
                    label: '设置查询条件（年份 / 图表维度）',
                    group: 'filter' as const,
                    params: currentQuery(ctx.query, ctx.chartScope).map((field) => ({
                        name: field.id,
                        type: field.type,
                        ...(field.options ? {options: field.options} : {}),
                        hint: field.hint ?? field.label,
                    })),
                },
            ],
            query: currentQuery(ctx.query, ctx.chartScope),
            // 两张表都在 tables 里；图表不占一项（它与 month 同源，见文件头说明）
            tables: [monthBridge.data(), departmentBridge.data()],
        };
    };

    return {
        snapshot,
        handlers: {
            ...monthBridge.handlers,
            ...departmentBridge.handlers,
            'query.set': async (params) => {
                const ctx = read();
                const year = params.year === undefined ? null : normalizeYear(params.year);
                const scope = params.chartScope === undefined ? null : normalizeChartScope(params.chartScope);

                if (params.year !== undefined && year === null) {
                    return `年份不合法：只认 YYYY 或 YYYY-MM-DD，收到 ${JSON.stringify(params.year)}`;
                }
                if (params.chartScope !== undefined && scope === null) {
                    return `图表维度不合法：只认 -1 / 0 / 1 / 2 / 3，收到 ${JSON.stringify(params.chartScope)}`;
                }
                if (year === null && scope === null) {
                    return '没有可设置的条件：可传 year（年份）或 chartScope（图表维度）';
                }

                const messages: string[] = [];
                if (year !== null && year !== ctx.query.year) {
                    // 年份变了：真的会发两次请求（月份汇总 + 部门汇总），等它们回来再回执
                    await ctx.applyQuery({year});
                    messages.push(`已按 ${year.slice(0, 4)} 年重新查询（两张表都已刷新）`);
                } else if (year !== null) {
                    messages.push(`年份已经是 ${year.slice(0, 4)}，无需重查`);
                }

                if (scope !== null && scope !== ctx.chartScope) {
                    // 只切图表维度：数据早就在表里，不发请求
                    ctx.applyChartScope(scope);
                    messages.push(`图表已切到「${CHART_SCOPE_LABELS[String(scope)]}」（数据未重新查询）`);
                }

                return messages.length > 0 ? messages.join('；') : '条件没有变化';
            },
        },
        /*
         * 不报 ready：挂载即可用。
         *
         * 快照里没有数据行（只有列目录与行数），列定义是页面常量。
         * 拿「接口回来没有」当就绪条件，会让 agent 的导航等一个它用不到的东西。
         */
    };
}
