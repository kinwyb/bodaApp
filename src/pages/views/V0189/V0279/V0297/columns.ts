import type {AppColumnDef} from '@/components/grid-table/columnBuilder.ts';

/**
 * V0189_V0279_V0297（计划管理 > 月份汇总）的列定义。
 *
 * 两张表共用同一套「4 个产地 × 2 个口径」的列，所以用工厂生成 —— 抄两份必然会漂移
 * （旧客户端就是两套 `BandedGridColumn`，连表头文案都得在 `Localizer` 里各写一遍）。
 *
 * 三处与 C# 的对应关系：
 * - `GridBand`（全部 / 义乌 / 越南 / 山西）→ 标题组 `{title, children}`；
 * - 列上 `GridColumnSummaryItem(Sum)` → `aggregate: 'sum'`（底部统计行 + 组行汇总自动算）；
 * - `CustomDrawCell` 里把 `0` 改写成空白 → `fieldFormat` 返回空串。
 *   这一条是业务口径：**0 和「没有排产」在这张表上是同一件事**，显示出来只是噪点。
 */

/** 4 个产地：带区标题 + 字段前缀（与 C# 的 `gridBand2..5` / `All/Yw/Vn/Sx` 一致） */
const PREFIXES = [
    {title: '全部', prefix: 'All'},
    {title: '义乌', prefix: 'Yw'},
    {title: '越南', prefix: 'Vn'},
    {title: '山西', prefix: 'Sx'},
] as const;

/**
 * 数量列。
 *
 * `dataType: 'int'` 会自动右对齐并按整数渲染（金额那种 `0.00` 在这里没有意义）；
 * `width: 78` 是因为一屏要排 9 列（月份 + 4 组 × 2）。
 */
function qtyColumn(field: string, title: string): AppColumnDef {
    return {
        field,
        title,
        width: 78,
        dataType: 'int',
        aggregate: 'sum',
        sortable: false,
        filterType: 'text',
        fieldFormat: (record: Record<string, unknown>) => {
            const value = record[field];
            if (value === null || value === undefined || value === '') return '';
            // 0 显示空白：与旧客户端 `CustomDrawCell` 的 `DisplayText == "0"` 判断一致
            return Number(value) === 0 ? '' : value;
        },
    };
}

/** 「全部 / 义乌 / 越南 / 山西」四个带区（每个带 预排数 + 下单数） */
function regionGroups(): AppColumnDef[] {
    return PREFIXES.map(({title, prefix}) => ({
        title,
        children: [
            qtyColumn(`${prefix}YPQty`, '预排数'),
            qtyColumn(`${prefix}XDQty`, '下单数'),
        ],
    }));
}

/**
 * 月份汇总表（对应 `bandedGridView1`）。
 *
 * `ZHMonth` 是月份维度、也是图表 X 轴，所以给 `sortable: 'asc'`：
 * 后端已按月份排好，但用户点一下表头就能反序看。
 */
export const MONTH_SUMMARY_COLUMNS: AppColumnDef[] = [
    {field: 'ZHMonth', title: '月份', width: 92, sortable: 'asc', filterType: 'enum'},
    ...regionGroups(),
];

/**
 * 部门汇总表（对应 `bandedGridView2`）。
 *
 * 与月份汇总的差别有三处：
 * 1. 多「部门」列；
 * 2. **按月份分组** —— C# 里 `GroupCount = 1` + `SortInfo`（按月份升序）
 *    + `GroupFooterShowMode.VisibleAlways` + `GroupSummary`（8 个数量列求和），
 *    对应列上的 `group: true`（一进来就分组）与 `aggregate: 'sum'`（组行合计）。
 *    注意**不是** `groupable`：C# 那边 `ShowGroupPanel = false`，没有「让你自己挑分组」的面板；
 * 3. 同一月份会有多行（每部门一行）—— 这是分组维度的差别，不是重复数据。
 */
export const DEPARTMENT_SUMMARY_COLUMNS: AppColumnDef[] = [
    // group: true 让表格一进来就按月份聚成组行，组行显示 8 列合计（来自每列的 aggregate: 'sum'）
    {field: 'ZHMonth', title: '月份', width: 92, sortable: 'asc', group: true, filterType: 'enum'},
    {field: 'Department', title: '部门', width: 110, filterType: 'enum'},
    ...regionGroups(),
];
