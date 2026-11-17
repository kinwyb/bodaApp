/**
 * V0357_V0359 营销(含销管)分析
 *
 * 旧客户端 `Views/V0357/V0359.cs`：继承 QuickBI，行为在共用组件 `@/components/quick-bi`。
 * 差异点：主过程 Query_kpi_marketing_center（组织参数键是 OrgPk）；
 * detailColumnType 的数值列名单对所有指标固定（dColumnType 不看 zbType），
 * 合计与合并层级按指标分支（initMergeColumn 的 zbType 1~4）。
 */
import React from 'react';
import {QuickBIPage, type QuickBIConfig, type QuickBIDetailProfile} from '@/components/quick-bi';
import type {ViewPageProps} from '@/pages/types';
import {PAGE_GUIDE} from './bridged';

/** C# doubleFieldName：不随指标变化的数值列名单 */
const DOUBLE_FIELDS = ['上期销售额', '本期销售额', '上期销售量', '本期销售量', '数量', '销售毛利', '销售收入', '销售目标'];

function detailProfile(kpi: string): QuickBIDetailProfile | undefined {
    switch (kpi) {
        case '销售额增长率':
            return {doubleFields: DOUBLE_FIELDS, sumFields: ['上期销售额', '本期销售额'], mergeColumnSort: ['年份', '月/季度', '渠道']};
        case '销售量增长率':
            return {doubleFields: DOUBLE_FIELDS, sumFields: ['上期销售量', '本期销售量'], mergeColumnSort: ['年份', '月/季度', '渠道']};
        case '毛利率':
            return {doubleFields: DOUBLE_FIELDS, sumFields: ['数量', '销售毛利', '销售收入'], mergeColumnSort: ['年月', '渠道']};
        case '销售人员业绩完成率':
            return {doubleFields: DOUBLE_FIELDS, sumFields: ['数量', '销售收入', '销售目标'], mergeColumnSort: ['年月', '渠道']};
        default:
            // 其余指标：C# zbType=0，没有合计/合并，但数值列名单仍生效
            return {doubleFields: DOUBLE_FIELDS};
    }
}

const CONFIG: QuickBIConfig = {
    caption: '营销(含销管)分析',
    summary: PAGE_GUIDE.summary,
    mainProcedure: 'Query_kpi_marketing_center',
    orgArgKey: 'OrgPk',
    detailProcedure: 'Query_kpi_marketing_center_detail',
    detailColumnMode: 'text',
    detailProfile,
};

const MarketingAnalysisPage: React.FC<ViewPageProps> = (props) => <QuickBIPage {...props} config={CONFIG}/>;

export default MarketingAnalysisPage;
