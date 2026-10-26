/**
 * 图标映射：把「业务 key」翻译成图标组件。
 *
 * 单独作为组件存在（而不是导出 { key: <Icon /> } 对象），是为了守住
 * 「.tsx 只导出组件」这条 Fast Refresh 规则。
 */

import React from 'react';
import {
  ApiOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LinkOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';

/** 欢迎页快捷指令的图标 */
export const PromptIcon: React.FC<{ name: string }> = ({ name }) => {
  switch (name) {
    case 'delivery':
      return <ScheduleOutlined />;
    case 'capacity':
      return <BarChartOutlined />;
    case 'report':
      return <FileTextOutlined />;
    case 'material':
      return <DatabaseOutlined />;
    default:
      return <FileTextOutlined />;
  }
};

/** 能力卡片的图标 */
export const CapabilityIcon: React.FC<{ name: string }> = ({ name }) => {
  switch (name) {
    case 'sql':
      return <DatabaseOutlined />;
    case 'tool':
      return <ApiOutlined />;
    case 'history':
      return <HistoryOutlined />;
    default:
      return <LinkOutlined />;
  }
};
