/**
 * agent 工作区浏览（HTTP，只读）。
 *
 * 对齐 buibuiCodex/core/ws/server/agentfiles.go：
 *
 *	GET {ws路径}/agents                     可浏览的 agent 及各自的根（/workspace、/tmp）
 *	GET {ws路径}/agents/{agent}/files?path= 列目录（path 为空用第一个根）
 *	GET {ws路径}/agents/{agent}/file?path=  读文件（?download=1 另存，?meta=1 元信息）
 *
 * 与 files/client.ts 的区别：那边是附件中转站（按 fileID、有 TTL），
 * 这边是 agent 的真实工作目录（按容器路径寻址）。后端也提供写接口，
 * 但工作台的文件面板是**只读**的 —— 这里刻意只封装 GET。
 *
 * 注意：该能力默认关闭，需要服务端配置 websocket.agent_files = true；
 * 未开启时端点返回 404，界面据此提示而不是当成网络错误。
 */

import { resolveAgentToken } from '../transport';
import { AgentFileError, agentFilesBaseUrl, toFileError } from './client';

/** 一个可浏览的根（容器视角）；exists=false 表示 agent 还没跑过、目录未创建 */
export type WorkspaceRoot = {
  container: string;
  exists: boolean;
};

export type WorkspaceAgent = {
  name: string;
  roots: WorkspaceRoot[];
};

/** 目录项 / 文件元信息，path 始终是容器路径 */
export type WorkspaceEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  /** 毫秒时间戳 */
  modTime: number;
  mime?: string;
  symlink?: boolean;
  mode?: string;
};

export type WorkspaceDir = {
  agent: string;
  path: string;
  parent?: string;
  roots: WorkspaceRoot[];
  items: WorkspaceEntry[];
};

/**
 * 工作区端点 base。与附件端点同源同前缀：{ws路径}/files → {ws路径}/agents。
 * 直接复用 agentFilesBaseUrl 的推导（显式配置 / dev 代理 / ws 地址推导 / 桌面代理），
 * 只把末段 files 换成 agents —— 桌面 Go 代理转发整个 /ws/ 前缀，天然覆盖。
 */
export function agentWorkspaceBaseUrl(): string {
  const filesBase = agentFilesBaseUrl();
  if (!filesBase) return '';
  const cut = filesBase.lastIndexOf('/');
  return cut > 0 ? `${filesBase.slice(0, cut)}/agents` : '/ws/agents';
}

function authHeaders(): Record<string, string> {
  const token = resolveAgentToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw toFileError(response.status, await response.text());
  return (await response.json()) as T;
}

/** 列出可浏览的 agent 与根；404（未开启 agent_files）也走 AgentFileError */
export async function listWorkspaceAgents(): Promise<WorkspaceAgent[]> {
  const base = agentWorkspaceBaseUrl();
  if (!base) return [];
  const payload = await getJSON<{ agents?: WorkspaceAgent[] }>(base);
  return payload?.agents ?? [];
}

/** 列目录；path 省略时后端用第一个根 */
export async function listWorkspaceDir(agent: string, path?: string): Promise<WorkspaceDir> {
  const base = agentWorkspaceBaseUrl();
  if (!base) throw new AgentFileError('未配置文件服务地址', 'unsupported');
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const query = params.toString();
  return getJSON<WorkspaceDir>(
    `${base}/${encodeURIComponent(agent)}/files${query ? `?${query}` : ''}`,
  );
}

/** 工作区文件的浏览器直用地址（?token=，供下载链接等设不了请求头的场景） */
export function workspaceFileUrl(
  agent: string,
  path: string,
  options: { download?: boolean } = {},
): string {
  const base = agentWorkspaceBaseUrl();
  const params = new URLSearchParams({ path });
  const token = resolveAgentToken();
  if (token) params.set('token', token);
  if (options.download) params.set('download', '1');
  return `${base}/${encodeURIComponent(agent)}/file?${params.toString()}`;
}

/** 取文件内容 Blob（带 Authorization 头，交给预览 iframe） */
export async function fetchWorkspaceFile(agent: string, path: string): Promise<Blob> {
  const base = agentWorkspaceBaseUrl();
  if (!base) throw new AgentFileError('未配置文件服务地址', 'unsupported');
  const params = new URLSearchParams({ path });
  const response = await fetch(`${base}/${encodeURIComponent(agent)}/file?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw toFileError(response.status, await response.text());
  return response.blob();
}
