/**
 * V0326（周生产数据）列定义：页面与界面桥共用。
 *
 * 列是**动态**的，随组织切换变化（旧客户端 `tableShow()`）：
 * - 选「全部」：每个指标一个标题组，组内两列（义乌/越南），列头只显示组织名；
 * - 选单个组织：指标不带标题组，列头是「指标(组织)」，只保留该组织的列。
 * 固定列（周/周开始/周结束）在「全部」时包一层「日期」标题组（ShowBands=true）。
 */
import type {AppColumnDef} from '@/components/grid-table/columnBuilder';
import type {Translate} from '@/i18n';
import {
    PRODUCTION_METRICS,
    PRODUCTION_ORGS,
    buildMetricLeaf,
    buildPeriodColumns,
} from '../productionShared';

/** 行主键：隐藏字段，值 = 周名（一年内唯一）。不用 WeekName 本身，见 productionShared 的说明 */
export const WEEK_PRODUCTION_ROW_KEY = '_rowKey';

/** orgId 为空串 = 全部组织 */
export function buildWeekProductionColumns(orgId: string, t: Translate): AppColumnDef[] {
    const showAll = orgId === '';
    const visibleOrgs = showAll ? PRODUCTION_ORGS : PRODUCTION_ORGS.filter((org) => org.id === orgId);
    const period = buildPeriodColumns('week', showAll, t);
    if (showAll) {
        return [
            ...period,
            ...PRODUCTION_METRICS.map((metric): AppColumnDef => ({
                title: t(metric.title),
                children: visibleOrgs.map((org) =>
                    buildMetricLeaf(metric, org, t(org.name), WEEK_PRODUCTION_ROW_KEY, 90)),
            })),
        ];
    }
    return [
        ...period,
        ...PRODUCTION_METRICS.flatMap((metric) =>
            visibleOrgs.map((org) =>
                buildMetricLeaf(metric, org, `${t(metric.title)}(${t(org.name)})`, WEEK_PRODUCTION_ROW_KEY, 150))),
    ];
}
