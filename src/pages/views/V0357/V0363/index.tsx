/**
 * V0357_V0363 战略中心分析
 *
 * 旧客户端 `Views/V0357/V0363.cs`：继承 QuickBI，行为在共用组件 `@/components/quick-bi`。
 * 差异点：主过程 Query_kpi_strategic_center；focusedData 只对「销售额」记 zbType=1，
 * 该指标的明细强化数值列、合计并按 年月→渠道→部门/组 合并；其余指标无档案。
 */
import React from 'react';
import {QuickBIPage, type QuickBIConfig, type QuickBIDetailProfile} from '@/components/quick-bi';
import type {ViewPageProps} from '@/pages/types';
import {PAGE_GUIDE} from './bridged';

const SALES_PROFILE: QuickBIDetailProfile = {
    doubleFields: ['数量', '本币无税金额'],
    sumFields: ['数量', '本币无税金额'],
    mergeColumnSort: ['年月', '渠道', '部门/组'],
};

const CONFIG: QuickBIConfig = {
    caption: '战略中心分析',
    summary: PAGE_GUIDE.summary,
    mainProcedure: 'Query_kpi_strategic_center',
    detailProcedure: 'Query_kpi_strategic_center_detail',
    detailColumnMode: 'text',
    detailProfile: (kpi) => (kpi === '销售额' ? SALES_PROFILE : undefined),
};

const StrategicCenterAnalysisPage: React.FC<ViewPageProps> = (props) => <QuickBIPage {...props} config={CONFIG}/>;

export default StrategicCenterAnalysisPage;
