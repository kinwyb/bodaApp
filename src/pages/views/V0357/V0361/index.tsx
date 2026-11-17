/**
 * V0357_V0361 财务分析
 *
 * 旧客户端 `Views/V0357/V0361.cs`：继承 QuickBI，行为在共用组件 `@/components/quick-bi`。
 * 差异点：主过程 Query_kpi_finance；focusedData 按指标记 zbType 1~10，
 * dColumnType / initMergeColumn 按 zbType 取数值列与合并层级。
 * 注意：本页 initMergeColumn **没有调 sumColumn** —— 明细不做合计，只合并。
 */
import React from 'react';
import {QuickBIPage, type QuickBIConfig, type QuickBIDetailProfile} from '@/components/quick-bi';
import type {ViewPageProps} from '@/pages/types';
import {PAGE_GUIDE} from './bridged';

/** zbType 1/2/3/5 共用的合并层级 */
const PERIOD_MERGE = ['年份', '月/季度', '渠道', '部门/组'];
/** zbType 6~10（各厂小时成本）共用的数值列与合并层级 */
const HOUR_COST_FIELDS = ['在产工时', '本期成本', '小时成本'];
const HOUR_COST_MERGE = ['组织', '年份', '月份', '工厂', '项目'];

function detailProfile(kpi: string): QuickBIDetailProfile | undefined {
    switch (kpi) {
        case '销售量增长率':
            return {doubleFields: ['上期销售量', '本期销售量', '利润'], mergeColumnSort: PERIOD_MERGE};
        case '销售单价变动率':
            return {doubleFields: ['上期销售单价', '本期销售单价'], mergeColumnSort: PERIOD_MERGE};
        case '业绩增长率':
            return {doubleFields: ['上期业绩', '本期业绩'], mergeColumnSort: PERIOD_MERGE};
        case '成本变动率':
            return {doubleFields: ['上期成本', '本期成本'], mergeColumnSort: ['组织', '年份', '月份']};
        case '毛利率变动率':
            // zbType=5：dColumnType 没有分支（全字符串），只有合并
            return {mergeColumnSort: PERIOD_MERGE};
        case '织造厂小时成本':
        case '棒杰厂小时成本':
        case '姗娥厂小时成本':
        case '内销厂小时成本':
        case '预生产后道小时成本':
            return {doubleFields: HOUR_COST_FIELDS, mergeColumnSort: HOUR_COST_MERGE};
        default:
            return undefined;
    }
}

const CONFIG: QuickBIConfig = {
    caption: '财务分析',
    summary: PAGE_GUIDE.summary,
    mainProcedure: 'Query_kpi_finance',
    detailProcedure: 'Query_kpi_finance_detail',
    detailColumnMode: 'text',
    detailProfile,
};

const FinanceAnalysisPage: React.FC<ViewPageProps> = (props) => <QuickBIPage {...props} config={CONFIG}/>;

export default FinanceAnalysisPage;
