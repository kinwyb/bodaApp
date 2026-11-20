/**
 * V0332（织造机型周数据）列定义：页面与界面桥共用。
 *
 * 旧客户端是**两级列带**且始终显示（ShowBands 未关）：
 * 「12寸(机台总数)」→「产出效率 / 机台利用率」→ 组织列「义乌(机台数)」。
 * 括号里的机台数来自数据（DataField = MZMachineCount 的行），查回数据后才有；
 * 组织切换只影响叶子列的显隐（全部 = 两地都显示）。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import type {Translate} from '@/i18n';
import {buildPeriodColumns, PRODUCTION_ORGS, productionFieldFormat} from '../productionShared';

/** 行主键：隐藏字段，值 = 周名（不用可见列 WeekName，避免统计行泄漏 __summary__） */
export const MACHINE_WEEK_ROW_KEY = '_rowKey';

/** 机型尺寸（寸）：旧客户端 machineSize 列表 */
export const MACHINE_SIZES: readonly string[] = ['12', '13', '14', '15', '16', '17', '18', '19', '20', '21'];

/** 每个机型下的两个指标（都是比率类：百分数显示、汇总取平均） */
const MACHINE_METRICS: ReadonlyArray<{ field: string; title: string }> = [
    {field: 'MZEfficiency', title: '产出效率'},
    {field: 'MZUtilizationRate', title: '机台利用率'},
];

/** 机台数：机型尺寸 → 组织前缀 → 台数（SQL 里 MZMachineCount 行透视而来） */
export type MachineCounts = Record<string, Partial<Record<string, number>>>;

/** orgId 为空串 = 全部组织 */
export function buildMachineWeekColumns(
    orgId: string,
    counts: MachineCounts,
    t: Translate,
): AppColumnDef[] {
    const visibleOrgs = orgId === '' ? PRODUCTION_ORGS : PRODUCTION_ORGS.filter((org) => org.id === orgId);
    const period = buildPeriodColumns('week', true, t);
    // 未知组织（不在两地之内）时旧客户端所有数据列都隐藏，只剩固定列
    if (visibleOrgs.length === 0) return period;
    const sizeGroups: AppColumnDef[] = MACHINE_SIZES.map((size) => {
        const sizeCounts = counts[size];
        const total = sizeCounts
            ? Object.values(sizeCounts).reduce<number>((sum, count) => sum + (count ?? 0), 0)
            : undefined;
        return {
            title: total !== undefined
                ? t('{size}寸({count})', {vars: {size, count: total}})
                : t('{size}寸', {vars: {size}}),
            children: MACHINE_METRICS.map((metric): AppColumnDef => ({
                title: t(metric.title),
                children: visibleOrgs.map((org) => {
                    const field = org.prefix + metric.field + size;
                    const count = sizeCounts?.[org.prefix];
                    return {
                        field,
                        title: count !== undefined ? `${t(org.name)}(${count})` : t(org.name),
                        width: 100,
                        minWidth: 80,
                        dataType: 'double' as const,
                        sortable: true,
                        aggregate: 'avg' as const,
                        fieldFormat: productionFieldFormat(field, 'percent', MACHINE_WEEK_ROW_KEY),
                    };
                }),
            })),
        };
    });
    return [...period, ...sizeGroups];
}
