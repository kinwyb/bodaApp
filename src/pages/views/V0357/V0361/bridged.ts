/**
 * V0357_V0361（财务分析）的接桥标记。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定
 * （见 `src/pages/agent/ui-bridge/bridged.ts`，glob 只扫 views 下各页面目录的 bridged.ts）。
 * 桥的实现是 QuickBI 共用层 `@/components/quick-bi/bridge`，由 QuickBIPage 按本页
 * config 装配 —— 这里转导出工厂与类型，标记与实现各司其职。
 *
 * PAGE_GUIDE.summary 是页面功能描述的单一事实来源：菜单描述脚本从本文件提取它
 * 生成 description.md，index.tsx 把它传进 QuickBIConfig 给共用桥作 guide.summary。
 */
export const PAGE_GUIDE = {
    summary: '财务分析：按年份与组织查看各业务单元(销售分析,成本分析,利润分析)的 KPI 指标在各月份的完成情况；点某个月份单元格可展开该指标的明细',
};

export {createQuickBIBridge, type QuickBIBridgeContext, type QuickBIQuery} from '@/components/quick-bi/bridge';
