/**
 * V0372（月生产数据）列定义：页面与界面桥共用。
 *
 * 与周生产数据同一套指标、同一套组织单选（义乌/越南/全部，短名不显示组织全名）：
 * - 选「全部」：按指标分组（ShowBands=true），列头仍是「指标(组织)」（旧客户端如此）；
 * - 选单个组织：不分组，列头「指标(组织)」；
 * - 只展示选中组织的列，顺序固定 义乌 → 越南。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import {PRODUCTION_METRICS, PRODUCTION_ORGS, buildMetricLeaf, buildPeriodColumns} from '../productionShared';

/** 行主键：隐藏字段，值 = 月名（不用可见列 WeekName，避免统计行泄漏 __summary__） */
export const MONTH_PRODUCTION_ROW_KEY = '_rowKey';

/** orgId 为空串 = 全部组织（与 V0326/V0332 的组织单选口径一致） */
export function buildMonthProductionColumns(orgId: string): AppColumnDef[] {
    const showAll = orgId === '';
    const visibleOrgs = showAll ? PRODUCTION_ORGS : PRODUCTION_ORGS.filter((org) => org.id === orgId);
    const period = buildPeriodColumns('month', showAll);
    const leaves = (metric: (typeof PRODUCTION_METRICS)[number]): AppColumnDef[] =>
        visibleOrgs.map((org) =>
            buildMetricLeaf(metric, org, `${metric.title}(${org.name})`, MONTH_PRODUCTION_ROW_KEY, 150));
    if (showAll) {
        return [
            ...period,
            ...PRODUCTION_METRICS.map((metric): AppColumnDef => ({
                title: metric.title,
                children: leaves(metric),
            })),
        ];
    }
    return [...period, ...PRODUCTION_METRICS.flatMap(leaves)];
}
