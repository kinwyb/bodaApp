/**
 * V0326（周生产数据）/ V0332（织造机型周数据）/ V0372（月生产数据）共用的业务常量与纯函数。
 *
 * 三个页面在旧客户端里是同一套骨架（`Views/V0018/V0326.cs` 及其两个变体）：
 * 固定「周/月」三列 + 按组织（义乌/越南）展开的指标列，数据来自同一个接口
 * `/bi/productionWeekDate/query`（V0332 例外，走 SQL 直查）。组织、指标、格式化、
 * 行透视这些完全一致的部分集中在这里，页面与各自的界面桥共用同一份。
 *
 * 放在父级目录而非某个页面目录下，是因为三处都要用（先例：`V0120/bonusColumns.ts`）。
 * 本文件只放常量与纯函数，不导出组件、不调 hook。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import {SUMMARY_ROW_KEY} from '@/components/grid-table';
import type {ProductionWeekData} from '@/api';
import {toNumberOrZero, toStringOrEmpty} from '@/utils';

/** 生产报表的组织：id 是后端组织主键，prefix 是旧客户端拼列名用的前缀（YW/VN） */
export type ProductionOrg = {
    id: string;
    name: string;
    prefix: string;
};

/**
 * 报表不展示的组织关键词：名称里含「山西」的组织一律排除（需求：山西组织不需要）。
 * 既用于过滤接口收到的组织列表，也作为 PRODUCTION_ORGS 不再收录山西的依据。
 */
export const EXCLUDED_ORG_NAME_KEYWORD = '山西';

/** 组织名称是否命中排除关键词（含「山西」即排除） */
export function isExcludedOrgName(name: unknown): boolean {
    return toStringOrEmpty(name).includes(EXCLUDED_ORG_NAME_KEYWORD);
}

/**
 * 生产组织，顺序 = 旧客户端 `orgTag = { "YW", "VN" }` 的列顺序（山西已按需求排除）。
 * 义乌对应旧客户端的 OrgID.BJ（棒杰），越南 = OrgID.VN。
 */
export const PRODUCTION_ORGS: readonly ProductionOrg[] = [
    {id: '0001E610000000KO20VW', name: '义乌', prefix: 'YW'},
    {id: '0001E610000000KWHO9D', name: '越南', prefix: 'VN'},
];

/** 指标定义：顺序与旧客户端 `initTable()` 里 addColumn 的顺序一致 */
export type ProductionMetric = {
    field: string;
    title: string;
    dataType: 'int' | 'double';
    /** 比率/效率类：接口给百分数原值，入表除以 100，显示 P1（一位小数百分数），汇总取平均 */
    percent: boolean;
    /** 界面派生指标（旧客户端 UnboundExpression），接口不返回 */
    computed?: boolean;
};

/** 字段名以 Rate / Efficiency 结尾的就是比率类（旧客户端两处判断都是这个规则） */
export function isPercentField(field: string): boolean {
    return field.endsWith('Rate') || field.endsWith('Efficiency');
}

export const PRODUCTION_METRICS: readonly ProductionMetric[] = [
    // 织造
    {field: 'ZZZZTotalNum', title: '织造产量', dataType: 'int', percent: false},
    {field: 'ZZZZCPNum', title: '织造次品数', dataType: 'int', percent: false},
    {field: 'ZZCPRate', title: '织造次品率', dataType: 'double', percent: true},
    {field: 'ZZWorkHours', title: '织造产出工时', dataType: 'double', percent: false},
    {field: 'ZZEfficiency', title: '织造产出效率', dataType: 'double', percent: true},
    {field: 'ZZUtilizationRate', title: '织造机台利用率', dataType: 'double', percent: true},
    // 染色
    {field: 'FZRSTotalWeight', title: '染厂产量(KG)', dataType: 'double', percent: false},
    {field: 'FZRSFXCount', title: '染厂返修缸/次', dataType: 'int', percent: false},
    {field: 'FZRSCPNum', title: '分检染色次品数', dataType: 'int', percent: false},
    {field: 'FZFJRSRate', title: '分检染色次品率', dataType: 'double', percent: true},
    // 缝制
    {field: 'FZFJTotalNum', title: '分检数', dataType: 'int', percent: false},
    {field: 'FZFJCPNum_ZZ', title: '分检织造次品数', dataType: 'int', percent: false},
    {field: 'FZFJCPRate', title: '分检织造次品率', dataType: 'double', percent: true},
    {field: 'FZFZTotalNum', title: '缝制产量', dataType: 'int', percent: false},
    {field: 'FZFZCPNum', title: '缝制次品数', dataType: 'int', percent: false},
    {field: 'FZFQCRate', title: '缝制次品率', dataType: 'double', percent: true},
    {field: 'FZFZRate', title: '缝制生产效率', dataType: 'double', percent: true},
    {field: 'FZFZWorkHours', title: '缝制产出工时', dataType: 'double', percent: false},
    // 缝制单件工时 = 产出工时 / 缝制产量 * 60（分钟），旧客户端 UnboundExpression
    {field: 'FZOneWt', title: '缝制单件工时', dataType: 'double', percent: false, computed: true},
    {field: 'FZBZNum', title: '包装入库数', dataType: 'int', percent: false},
    {field: 'FZBZOutNum', title: '成品出库', dataType: 'int', percent: false},
];

/** 周名：`2025第03周`（旧客户端 `string.Format("{0}第{1}周", WeekYear, WeekNum.ToString("00"))`） */
export function weekPeriodName(d: ProductionWeekData): string {
    return `${toNumberOrZero(d.WeekYear)}第${String(toNumberOrZero(d.WeekNum)).padStart(2, '0')}周`;
}

/** 月名：`2025-03`（旧客户端月数据用 `WeekNum - 60` 还原月份） */
export function monthPeriodName(d: ProductionWeekData): string {
    return `${toNumberOrZero(d.WeekYear)}-${String(toNumberOrZero(d.WeekNum) - 60).padStart(2, '0')}`;
}

/**
 * 接口返回 → 表格行（旧客户端 `dataParse` 的透视）：
 * 每周一行，`Datas[组织ID][指标]` 摊平成 `前缀+指标` 列；比率类除以 100；
 * 派生指标 FZOneWt 在这里算好。接口没给的字段保持缺失（显示空白）。
 */
export function buildProductionRows(
    list: ProductionWeekData[],
    periodName: (d: ProductionWeekData) => string,
): Array<Record<string, unknown>> {
    return list.map((d) => {
        const row: Record<string, unknown> = {
            WeekName: periodName(d),
            WeekStartDate: d.WeekStartDate ?? '',
            WeekEndDate: d.WeekEndDate ?? '',
        };
        // 行主键用隐藏字段：GridTable 会把统计行的主键写成 __summary__，
        // 若主键落在可见列（WeekName）上，统计行就会把 __summary__ 显示出来
        row['_rowKey'] = row['WeekName'];
        for (const org of PRODUCTION_ORGS) {
            const data = d.Datas?.[org.id];
            if (!data) continue;
            for (const metric of PRODUCTION_METRICS) {
                if (metric.computed) continue;
                const raw = data[metric.field];
                if (raw === null || raw === undefined) continue;
                const value = toNumberOrZero(raw);
                row[org.prefix + metric.field] = metric.percent ? value / 100 : value;
            }
            const total = toNumberOrZero(data['FZFZTotalNum']);
            const hours = toNumberOrZero(data['FZFZWorkHours']);
            row[org.prefix + 'FZOneWt'] = total === 0 ? 0 : (hours / total) * 60;
        }
        return row;
    });
}

/** 数值列的显示形态：int 整数 / double 一位小数 / percent 一位小数百分数 */
export type ProductionNumberKind = 'int' | 'double' | 'percent';

/**
 * 指标列的 fieldFormat，还原旧客户端两条显示规则：
 * - `CustomDrawCell`：组织列的 0 / 0.0 / 0.0% 一律画成空白；
 * - 单元格 double 是 `0.0`（一位小数），底部合计行是 `0.#`（去掉多余的 0），
 *   比率列单元格与合计行都是 `P1`（一位小数百分数）。
 */
export function productionFieldFormat(
    field: string,
    kind: ProductionNumberKind,
    rowKey: string,
): (record: Record<string, unknown>) => string {
    return (record) => {
        const raw = record[field];
        if (raw === null || raw === undefined || raw === '') return '';
        const value = toNumberOrZero(raw);
        if (value === 0) return '';
        if (kind === 'percent') return `${(value * 100).toFixed(1)}%`;
        if (kind === 'int') return value.toFixed(0);
        const isSummary = record[rowKey] === SUMMARY_ROW_KEY;
        return isSummary ? String(parseFloat(value.toFixed(1))) : value.toFixed(1);
    };
}

/**
 * 固定「日期」带区：周（名/开始/结束）或月（名/开始/结束）。
 * grouped 时包一层「日期」标题组 —— 对应旧客户端 `ShowBands = true` 时出现的 gridBand1。
 */
export function buildPeriodColumns(kind: 'week' | 'month', grouped: boolean): AppColumnDef[] {
    const [nameTitle, startTitle, endTitle] =
        kind === 'week' ? ['周', '周开始', '周结束'] : ['月', '月开始', '月结束'];
    const leaves: AppColumnDef[] = [
        {field: 'WeekName', title: nameTitle, width: 110, minWidth: 90, sortable: true, filterType: 'text'},
        {field: 'WeekStartDate', title: startTitle, width: 100, minWidth: 90, dataType: 'date', sortable: true, filterType: 'date'},
        {field: 'WeekEndDate', title: endTitle, width: 100, minWidth: 90, dataType: 'date', sortable: true, filterType: 'date'},
    ];
    return grouped ? [{title: '日期', children: leaves}] : leaves;
}

/** 一个「指标 × 组织」叶子列：汇总方式、显示格式、筛选都按旧客户端的列配置来 */
export function buildMetricLeaf(
    metric: ProductionMetric,
    org: ProductionOrg,
    title: string,
    rowKey: string,
    width: number,
): AppColumnDef {
    const field = org.prefix + metric.field;
    const kind: ProductionNumberKind = metric.percent ? 'percent' : metric.dataType;
    return {
        field,
        title,
        width,
        minWidth: 80,
        dataType: metric.dataType,
        sortable: true,
        filterType: 'number',
        aggregate: metric.percent ? 'avg' : 'sum',
        fieldFormat: productionFieldFormat(field, kind, rowKey),
    };
}

/** 指标列的业务提示（界面桥 columnHints 用）：组织 × 指标逐一生成 */
export function productionColumnHints(): Record<string, string> {
    const hints: Record<string, string> = {
        WeekName: '周期名（周：2025第03周；月：2025-03）；行主键 _rowKey 与其同值',
        WeekStartDate: '周期开始日期 YYYY-MM-DD',
        WeekEndDate: '周期结束日期 YYYY-MM-DD',
    };
    for (const org of PRODUCTION_ORGS) {
        for (const metric of PRODUCTION_METRICS) {
            hints[org.prefix + metric.field] =
                `${org.name}·${metric.title}` +
                (metric.percent ? '，百分数（如 85.5%）' : '') +
                (metric.computed ? '，界面派生：缝制产出工时/缝制产量*60（分钟）' : '');
        }
    }
    return hints;
}

/**
 * 织造明细弹窗的数值显示：最多两位小数、去掉多余的 0（旧客户端合计行格式 `{0:0.##}`）。
 * 弹窗单元格在旧客户端没有显式格式（double 原样输出），这里统一按 0.## 收敛，
 * 避免长小数撑爆列宽；数值本身不变。
 */
export function trimmedDoubleFormat(field: string): (record: Record<string, unknown>) => string {
    return (record) => {
        const raw = record[field];
        if (raw === null || raw === undefined || raw === '') return '';
        return String(parseFloat(toNumberOrZero(raw).toFixed(2)));
    };
}

/**
 * 按列上的 aggregate 生成底部统计行，语义对齐旧客户端的 SummaryItem：
 * - Sum：空值不参与（等价于按 0 累加）；
 * - Average：**只统计有值的行**（DevExpress 忽略 DBNull），缺数据的周不会把均值拉低。
 *
 * 组件内置的 avg 会把缺值当 0 计入分母，与旧客户端不一致，所以这几个页面
 * 显式传 summary 接管统计行。列动态变化时随 columns 一起重建。
 */
export function buildSummaryFromColumns(
    columns: AppColumnDef[],
): (records: Array<Record<string, unknown>>) => Record<string, unknown> {
    const leaves: Array<{field: string; type: 'sum' | 'avg'}> = [];
    const walk = (defs: AppColumnDef[]): void => {
        for (const def of defs) {
            if ('children' in def) {
                walk(def.children);
            } else if (def.aggregate === 'sum' || def.aggregate === 'avg') {
                leaves.push({field: def.field, type: def.aggregate});
            }
        }
    };
    walk(columns);
    return (records) => {
        const summary: Record<string, unknown> = {};
        for (const {field, type} of leaves) {
            let total = 0;
            let count = 0;
            for (const row of records) {
                const raw = row[field];
                if (raw === null || raw === undefined || raw === '') continue;
                total += toNumberOrZero(raw);
                count += 1;
            }
            summary[field] = type === 'avg' ? (count === 0 ? 0 : total / count) : total;
        }
        return summary;
    };
}
