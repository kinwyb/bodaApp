/**
 * 图标映射：把「业务 key」翻译成图标组件。
 *
 * 单独作为组件存在（而不是导出 { key: <Icon /> } 对象），是为了守住
 * 「.tsx 只导出组件」这条 Fast Refresh 规则。
 */

import React from 'react';
import {
  AlertOutlined,
  ApiOutlined,
  BarChartOutlined,
  BoxPlotFilled,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FundOutlined,
  HistoryOutlined,
  LineChartOutlined,
  LinkOutlined,
  PieChartOutlined,
  ScheduleOutlined,
  SearchOutlined,
  StockOutlined,
  ToolOutlined,
} from '@ant-design/icons';

/** 欢迎页快捷指令的图标：先认配置里的图标名，再认业务 key，最后落默认文档图标 */
export const PromptIcon: React.FC<{ name: string }> = ({name}) => {
    switch (name) {
        case 'delivery':
        case 'schedule':
            return <ScheduleOutlined/>;
        case 'capacity':
        case 'bar-chart':
            return <BarChartOutlined/>;
        case 'report':
        case 'file-text':
            return <FileTextOutlined/>;
        case 'material':
        case 'database':
            return <DatabaseOutlined/>;
        case 'line-chart':
            return <LineChartOutlined/>;
        case 'pie-chart':
            return <PieChartOutlined/>;
        case 'alert':
            return <AlertOutlined/>;
        case 'tool':
            return <ToolOutlined/>;
        case 'check':
            return <CheckCircleOutlined/>;
        case 'clock':
            return <ClockCircleOutlined/>;
        case 'search':
            return <SearchOutlined/>;
        case 'stockout':
            return <StockOutlined/>;
        case 'fundout':
            return <FundOutlined/>;
        case 'boxplot':
            return <BoxPlotFilled/>;
        default:
            return <FileTextOutlined/>;
    }
};

/** 能力卡片的图标 */
export const CapabilityIcon: React.FC<{ name: string }> = ({name}) => {
    switch (name) {
        case 'sql':
            return <DatabaseOutlined/>;
        case 'tool':
            return <ApiOutlined/>;
        case 'history':
            return <HistoryOutlined/>;
        default:
            return <LinkOutlined/>;
    }
};
