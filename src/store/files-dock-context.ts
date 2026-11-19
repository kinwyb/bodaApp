/**
 * 工作台「文件浏览」的停靠状态与页签存档。
 *
 * 文件浏览默认是主界面里的一个普通页签（和「工作台」并列）；点「固定到右侧」
 * 后整块停靠在 agent 旁边的右栏，主界面页签变成占位提示。同一时刻只挂载一个
 * 面板实例（主页签 XOR 右栏），切换宿主会重挂载，所以打开的页签（含 Blob）
 * 提升到 WorkbenchLayout 存档，重挂载时原样恢复。
 *
 * 独立路由 /app 没有 Provider：默认值即「不可停靠、无 agent 上下文」，
 * 文件页签仍可作为普通页面使用。
 */

import { createContext, useContext } from 'react';
import type { AgentFilePreviewTarget } from '../pages/agent/files';

export type AgentFilePreviewRequest = {
  id: number;
  targets: AgentFilePreviewTarget[];
  activateFirst: boolean;
};

/** 一个预览页签；blob 异步到达，未到之前页签内显示加载态 */
export type FileTab = {
  key: string;
  name: string;
  blob?: Blob;
  error?: { message: string; fallbackUrl?: string };
  downloadUrl?: string;
  /** 工作区来源的容器路径：切页签时同步目录树选中 */
  workspacePath?: string;
};

export type FilesDockState = {
  /** 对话当前 agent（目录树跟随）；无工作台上下文时为空串 */
  agent: string;
  /** 对话里点开/自动打开的附件批次 */
  previewRequests: AgentFilePreviewRequest[];
  /** 面板处理完一批后回执，避免重复开页签 */
  ackPreviewRequests: (ids: number[]) => void;
  /** 是否停靠在右栏 */
  docked: boolean;
  /** 是否提供停靠能力（仅工作台） */
  canDock: boolean;
  setDocked: (docked: boolean) => void;
  /** 页签存档：面板重挂载时恢复 */
  tabs: FileTab[];
  active: string;
  onTabsChange: (tabs: FileTab[], active: string) => void;
};

const noop = () => {};

export const FilesDockContext = createContext<FilesDockState>({
  agent: '',
  previewRequests: [],
  ackPreviewRequests: noop,
  docked: false,
  canDock: false,
  setDocked: noop,
  tabs: [],
  active: '',
  onTabsChange: noop,
});

export function useFilesDock(): FilesDockState {
  return useContext(FilesDockContext);
}
