/**
 * 文件收发出口（HTTP 上传 / 下载 / 地址解析）。
 *
 * 组件只从这里取，不直接 import client.ts —— 以后加「拖拽上传」「粘贴图片」
 * 之类的入口时，改动收敛在这一层。
 */

export {
  AgentFileError,
  MAX_AGENT_UPLOAD_SIZE,
  agentFilesBaseUrl,
  deleteAgentFile,
  fileErrorMessage,
  listAgentFiles,
  resolveAgentFileUrl,
  uploadAgentFile,
} from './client';
export type { UploadOptions } from './client';
export {
  agentWorkspaceBaseUrl,
  fetchWorkspaceFile,
  listWorkspaceAgents,
  listWorkspaceDir,
  workspaceFileUrl,
} from './workspace';
export type { WorkspaceAgent, WorkspaceDir, WorkspaceEntry, WorkspaceRoot } from './workspace';
export { AgentFilePreviewContext, useAgentFilePreview } from './preview';
export type { AgentFilePreviewApi, AgentFilePreviewTarget } from './preview';
export { fileViewerBaseUrl, fileViewerFrameUrl, fileViewerOrigin } from './viewer';
