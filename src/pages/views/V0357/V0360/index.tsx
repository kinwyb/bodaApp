/**
 * V0357_V0360 研发分析
 *
 * 旧客户端 `Views/V0357/V0360.cs` 只有 48 行：继承 QuickBI 基类，配置三个存储过程。
 * 行为全部在共用组件 `@/components/quick-bi`（对应 C# Views/Dialog/QuickBI.cs），
 * 这里只声明本页的差异点。V0360 未重写 focusedData / detailColumnType / initMergeColumn，
 * 所以没有 detailProfile（明细不做类型强化 / 合计 / 合并）。
 */
import React from 'react';
import {QuickBIPage, type QuickBIConfig} from '@/components/quick-bi';
import type {ViewPageProps} from '@/pages/types';
import {PAGE_GUIDE} from './bridged';

const CONFIG: QuickBIConfig = {
    caption: '研发分析',
    summary: PAGE_GUIDE.summary,
    mainProcedure: 'Query_kpi_CRDC',
    detailProcedure: 'Query_kpi_CRDC_detail',
};

const RnDAnalysisPage: React.FC<ViewPageProps> = (props) => <QuickBIPage {...props} config={CONFIG}/>;

export default RnDAnalysisPage;
