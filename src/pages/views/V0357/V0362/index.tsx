/**
 * V0357_V0362 生产基地分析
 *
 * 旧客户端 `Views/V0357/V0362.cs`：继承 QuickBI，行为在共用组件 `@/components/quick-bi`。
 * 差异点：主过程 Query_kpi_production_base；没有 focusedData / initMergeColumn 重写，
 * 构造函数里 detailMergeColumnSort 固定为 [日期]、dColumnType 固定三个数值列 ——
 * 所以 detailProfile 对所有指标返回同一份档案。
 */
import React from 'react';
import {QuickBIPage, type QuickBIConfig, type QuickBIDetailProfile} from '@/components/quick-bi';
import type {ViewPageProps} from '@/pages/types';
import {PAGE_GUIDE} from './bridged';

const ATTENDANCE_PROFILE: QuickBIDetailProfile = {
    doubleFields: ['应岗人数', '缺勤人数', '迟到人数'],
    mergeColumnSort: ['日期'],
};

const CONFIG: QuickBIConfig = {
    caption: '生产基地分析',
    summary: PAGE_GUIDE.summary,
    mainProcedure: 'Query_kpi_production_base',
    detailProcedure: 'Query_kpi_production_base_detail',
    detailColumnMode: 'text',
    detailProfile: () => ATTENDANCE_PROFILE,
};

const ProductionBaseAnalysisPage: React.FC<ViewPageProps> = (props) => <QuickBIPage {...props} config={CONFIG}/>;

export default ProductionBaseAnalysisPage;
