/**
 * V0357_V0358 供应链分析
 *
 * 旧客户端 `Views/V0357/V0358.cs`：继承 QuickBI，行为在共用组件 `@/components/quick-bi`。
 * 差异点：主过程 Query_kpi_supply_chain（组织参数键是 OrgPk）；
 * focusedData 按指标记 zbType（销售业绩=1 / 织造工厂设备稼动率=2），
 * detailColumnType / initMergeColumn / sumColumn 按 zbType 分支 → 这里合成 detailProfile。
 */
import React from 'react';
import {QuickBIPage, type QuickBIConfig, type QuickBIDetailProfile} from '@/components/quick-bi';
import type {ViewPageProps} from '@/pages/types';
import {PAGE_GUIDE} from './bridged';

/** zbType=1 销售业绩：销售毛率按 P2 百分比显示，不参与合计 */
const SALES_PERFORMANCE: QuickBIDetailProfile = {
    doubleFields: ['实发数量', '本币无税金额', '销售毛利', '销售毛率'],
    sumFields: ['实发数量', '本币无税金额', '销售毛利'],
    percentFields: ['销售毛率'],
    mergeColumnSort: ['月份', '渠道', '部门/组'],
};

/** zbType=2 织造工厂设备稼动率 */
const UTILIZATION: QuickBIDetailProfile = {
    doubleFields: ['正品产量', '下机工时h'],
    sumFields: ['正品产量', '下机工时h'],
    mergeColumnSort: ['年月', '厂别'],
};

function detailProfile(kpi: string): QuickBIDetailProfile | undefined {
    if (kpi === '销售业绩') return SALES_PERFORMANCE;
    if (kpi === '织造工厂设备稼动率') return UTILIZATION;
    return undefined;
}

const CONFIG: QuickBIConfig = {
    caption: '供应链分析',
    summary: PAGE_GUIDE.summary,
    mainProcedure: 'Query_kpi_supply_chain',
    orgArgKey: 'OrgPk',
    detailProcedure: 'Query_kpi_supply_chain_detail',
    detailColumnMode: 'text',
    detailProfile,
};

const SupplyChainAnalysisPage: React.FC<ViewPageProps> = (props) => <QuickBIPage {...props} config={CONFIG}/>;

export default SupplyChainAnalysisPage;
