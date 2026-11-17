/**
 * 附件预览的跨层通道。
 *
 * 工作台（WorkbenchLayout）在右侧挂了文件浏览面板时，由它提供本 Context：
 * 对话里的附件点击 → openFile → 面板内嵌 iframe 预览，不再跳新窗口。
 * 独立路由 /agent 没有 Provider，useAgentFilePreview 返回 null，
 * 附件保持原来的 window.open 行为。
 */

import { createContext, useContext } from 'react';

export type AgentFilePreviewTarget = {
  /** 后端给的原始地址（/ws/files/<id> 相对地址或绝对地址），由面板负责解析与取内容 */
  url: string;
  name?: string;
};

export type AgentFilePreviewApi = {
  openFile: (target: AgentFilePreviewTarget) => void;
};

export const AgentFilePreviewContext = createContext<AgentFilePreviewApi | null>(null);

export function useAgentFilePreview(): AgentFilePreviewApi | null {
  return useContext(AgentFilePreviewContext);
}
