/**
 * 工作台右侧的「文件浏览」面板：agent 工作区目录树 + file-viewer 预览 iframe。
 *
 * 预览引擎是独立部署的 file-viewer 官方静态站（零依赖 iframe 集成，见
 * scripts/setup-file-viewer.mjs），本面板只做三件事：
 * 1. 目录树：GET /ws/agents 系列接口懒加载（只读，不提供任何写入口）；
 * 2. 取内容：带 token 把文件拉成 Blob（附件与目录树文件同一条路）；
 * 3. 投递：iframe.html?from=<origin>&name=<文件名> 加载后 postMessage(Blob)。
 *
 * 为什么走 Blob 而不是 ?url=：后端 ws 服务不处理 CORS，viewer 服务跨源拉
 * 文件会被浏览器拦；工作台同源代理取好再递过去，鉴权与跨域一并解决。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Spin, Tag, Tooltip, Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import {
  CloseOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import {
  AgentFileError,
  fetchWorkspaceFile,
  fileErrorMessage,
  fileViewerFrameUrl,
  fileViewerOrigin,
  listWorkspaceAgents,
  listWorkspaceDir,
  resolveAgentFileUrl,
  workspaceFileUrl,
} from '../pages/agent/files';
import type { AgentFilePreviewTarget, WorkspaceAgent, WorkspaceEntry } from '../pages/agent/files';
import { agentTransportMode } from '../pages/agent/transport';

/** 目录树节点：key 就是容器路径，entry/root 用来区分文件、目录与根 */
type FileTreeNode = TreeDataNode & {
  entry?: WorkspaceEntry;
  isRoot?: boolean;
};

/** 当前预览的文件；seq 驱动 iframe 重挂载（换文件必须重新走 load → postMessage） */
type CurrentFile = {
  seq: number;
  name: string;
  blob: Blob;
  downloadUrl?: string;
};

type FileLoadError = {
  message: string;
  /** 拉取失败（如外网附件跨域）时保留原链接，用户仍可新窗口打开 */
  fallbackUrl?: string;
};

/** 目录在前、同类按名字排（后端已排过，这里兜底保证一致观感） */
function sortEntries(items: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...items].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function entryToNode(entry: WorkspaceEntry): FileTreeNode {
  // 软链接不跟随（后端同样拒绝越界读取）：目录不可展开，文件不可预览
  const usable = !entry.symlink;
  return {
    key: entry.path,
    title: entry.name,
    icon: entry.isDir ? <FolderOutlined /> : <FileOutlined />,
    isLeaf: !entry.isDir || !usable,
    // 目录也要可选：antd 对 selectable:false 的节点不派发 onSelect，
    // 整行点击展开目录（见 handleSelect）就失效了；选中态由 selectedKeys 控制，只落在文件上
    selectable: usable,
    disabled: !usable,
    entry,
  };
}

/** 把懒加载到的子节点挂回树里（按 key 递归找父节点） */
function attachChildren(
  nodes: FileTreeNode[],
  key: React.Key,
  children: FileTreeNode[],
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.key === key) return { ...node, children };
    if (node.children) {
      return { ...node, children: attachChildren(node.children as FileTreeNode[], key, children) };
    }
    return node;
  });
}

const WorkbenchFilePanel: React.FC<{
  /** 对话当前选中的 agent（顶栏切换时同步过来） */
  agent: string;
  /** 对话里点开的附件；null 表示还没点过 */
  attachment: AgentFilePreviewTarget | null;
  onClose: () => void;
}> = ({ agent, attachment, onClose }) => {
  const mock = agentTransportMode() === 'mock';

  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(agent);

  const [treeData, setTreeData] = useState<FileTreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<React.Key[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  const [current, setCurrent] = useState<CurrentFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<FileLoadError | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** 请求序号：切 agent / 连点文件时丢弃过期响应 */
  const fileSeqRef = useRef(0);
  const agentRef = useRef(selectedAgent);
  useEffect(() => {
    agentRef.current = selectedAgent;
  }, [selectedAgent]);

  const roots = useMemo(
    () => agents.find((item) => item.name === selectedAgent)?.roots ?? [],
    [agents, selectedAgent],
  );

  const rootNodes = useMemo<FileTreeNode[]>(
    () =>
      roots.map((root) => ({
        key: root.container,
        title: root.exists ? root.container : `${root.container}（未创建）`,
        icon: <FolderOutlined />,
        isLeaf: false,
        selectable: root.exists,
        disabled: !root.exists,
        isRoot: true,
      })),
    [roots],
  );

  /** 重置目录树（切 agent / 刷新）：展开、加载、选中状态一起清 */
  const resetTree = useCallback((nodes: FileTreeNode[]) => {
    setTreeData(nodes);
    setExpandedKeys([]);
    setLoadedKeys([]);
    setSelectedKeys([]);
  }, []);

  const loadAgents = useCallback(async () => {
    if (mock) return;
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const list = await listWorkspaceAgents();
      setAgents(list);
      setSelectedAgent((currentAgent) => currentAgent || list[0]?.name || '');
    } catch (error) {
      // 404 = 服务端没开 websocket.agent_files，给出配置提示而不是网络错误
      setAgentsError(
        error instanceof AgentFileError && error.code === 'http_404'
          ? '后端未开启文件浏览（需配置 websocket.agent_files = true）'
          : fileErrorMessage(error),
      );
    } finally {
      setAgentsLoading(false);
    }
  }, [mock]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  // 对话顶栏切换 agent → 面板跟随
  useEffect(() => {
    if (agent) setSelectedAgent(agent);
  }, [agent]);

  // agent 变化 → 根列表变化 → 重建树
  useEffect(() => {
    resetTree(rootNodes);
  }, [rootNodes, resetTree]);

  /**
   * 统一展示一份新文件（附件与目录树共用）。
   * seq 用调用方持有的请求序号：这里不能再自增，否则调用方 finally 里的
   * 「仍是最新请求」判断永远不成立，loading 就收不掉了。
   */
  const showFile = useCallback((seq: number, name: string, blob: Blob, downloadUrl?: string) => {
    setCurrent({ seq, name, blob, downloadUrl });
    setFileError(null);
  }, []);

  // 对话附件：父层每次点击都给新对象，这里跟着取内容
  useEffect(() => {
    if (!attachment) return;
    const resolved = resolveAgentFileUrl(attachment.url);
    if (!resolved) return;
    const seq = ++fileSeqRef.current;
    setFileLoading(true);
    setFileError(null);
    setSelectedKeys([]);
    fetch(resolved)
      .then(async (response) => {
        if (!response.ok) throw new AgentFileError(`文件服务返回 ${response.status}`, `http_${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (seq !== fileSeqRef.current) return;
        const name = attachment.name || resolved.split('?')[0].split('/').pop() || '附件';
        showFile(seq, name, blob, resolveAgentFileUrl(attachment.url, { download: true }));
      })
      .catch((error: unknown) => {
        if (seq !== fileSeqRef.current) return;
        setFileError({
          message: error instanceof Error ? error.message : '附件读取失败',
          fallbackUrl: resolved,
        });
      })
      .finally(() => {
        if (seq === fileSeqRef.current) setFileLoading(false);
      });
  }, [attachment, showFile]);

  /** 目录树懒加载 */
  const loadTreeData = useCallback(
    async (node: FileTreeNode) => {
      const owner = agentRef.current;
      if (!owner) return;
      try {
        const dir = await listWorkspaceDir(owner, String(node.key));
        // 加载期间切了 agent：丢弃，避免把上一个 agent 的目录挂进来
        if (owner !== agentRef.current) return;
        setTreeData((prev) => attachChildren(prev, node.key, sortEntries(dir.items).map(entryToNode)));
      } catch (error) {
        setFileError({ message: fileErrorMessage(error) });
        // 标记已加载，防止 antd 对同一节点反复重试
        setLoadedKeys((prev) => [...prev, node.key]);
      }
    },
    [],
  );

  /** 点文件 → 取内容预览；点目录/根 → 展开收起（整行可点，不只小箭头） */
  const handleSelect = useCallback(
    (_keys: React.Key[], info: { node: FileTreeNode }) => {
      const node = info.node;
      const entry = node.entry;
      if (!entry || entry.isDir || node.isRoot) {
        if (node.disabled) return;
        setExpandedKeys((prev) =>
          prev.includes(node.key) ? prev.filter((key) => key !== node.key) : [...prev, node.key],
        );
        return;
      }
      if (entry.symlink) return;
      const owner = agentRef.current;
      const seq = ++fileSeqRef.current;
      setSelectedKeys([node.key]);
      setFileLoading(true);
      setFileError(null);
      fetchWorkspaceFile(owner, entry.path)
        .then((blob) => {
          if (seq !== fileSeqRef.current) return;
          showFile(seq, entry.name, blob, workspaceFileUrl(owner, entry.path, { download: true }));
        })
        .catch((error: unknown) => {
          if (seq !== fileSeqRef.current) return;
          setFileError({ message: fileErrorMessage(error) });
        })
        .finally(() => {
          if (seq === fileSeqRef.current) setFileLoading(false);
        });
    },
    [showFile],
  );

  const handleRefresh = useCallback(() => {
    void loadAgents();
    resetTree(rootNodes);
  }, [loadAgents, resetTree, rootNodes]);

  const handleAgentChange = useCallback((name: string) => {
    setSelectedAgent(name);
  }, []);

  /**
   * Blob 投递：等桥接页的 ready 信号再投，且只投一次。
   *
   * 不能在 iframe load 事件投：demo 的消息监听器在 App 异步挂载后才注册，
   * load 时投出去会丢（表现为壳加载成功但内容空白）。桥接页与 demo 同源、
   * 轮询 DOM 判定挂载完成后回 boda-viewer-ready，这里收到才投。
   * 16s 兜底投一次（桥接页自身 15s 必回 ready；兜底只防信号丢失）。
   */
  useEffect(() => {
    if (!current) return;
    const target = fileViewerOrigin();
    const blob = current.blob;
    let posted = false;
    const post = () => {
      if (posted) return;
      posted = true;
      iframeRef.current?.contentWindow?.postMessage(blob, target);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== target) return;
      const data = event.data as { type?: string } | null;
      if (data && data.type === 'boda-viewer-ready') post();
    };
    window.addEventListener('message', onMessage);
    const fallback = window.setTimeout(post, 16000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(fallback);
    };
  }, [current]);

  const agentOptions = useMemo(
    () => agents.map((item) => ({ value: item.name, label: item.name })),
    [agents],
  );

  return (
    <div className="workbench-files-panel">
      <div className="workbench-files-header">
        <span className="workbench-files-title">文件浏览</span>
        <Tag className="workbench-files-readonly">只读</Tag>
        <Select
          size="small"
          className="workbench-files-agent"
          value={selectedAgent || undefined}
          onChange={handleAgentChange}
          options={agentOptions}
          placeholder="选择 agent"
          popupMatchSelectWidth={200}
          disabled={mock || agents.length === 0}
        />
        <span className="workbench-files-spacer" />
        <Tooltip title="刷新目录">
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleRefresh} />
        </Tooltip>
        <Tooltip title="下载当前文件">
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            disabled={!current?.downloadUrl}
            href={current?.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
          />
        </Tooltip>
        <Tooltip title="收起面板">
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
        </Tooltip>
      </div>

      <div className="workbench-files-body">
        <div className="workbench-files-tree">
          {mock ? (
            <Alert type="info" showIcon message="演示模式没有文件服务" />
          ) : agentsError ? (
            <Alert type="warning" showIcon message={agentsError} />
          ) : agentsLoading && agents.length === 0 ? (
            <div className="workbench-files-tree-loading">
              <Spin size="small" />
            </div>
          ) : treeData.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可浏览的目录" />
          ) : (
            <Tree
              showIcon
              blockNode
              treeData={treeData}
              loadData={loadTreeData}
              expandedKeys={expandedKeys}
              loadedKeys={loadedKeys}
              selectedKeys={selectedKeys}
              onExpand={(keys) => setExpandedKeys(keys)}
              onLoad={(keys) => setLoadedKeys(keys)}
              onSelect={handleSelect}
            />
          )}
        </div>

        <div className="workbench-files-preview">
          {fileLoading ? (
            <div className="workbench-files-preview-status">
              <Spin />
              <span className="workbench-files-preview-status-text">读取文件…</span>
            </div>
          ) : fileError ? (
            <div className="workbench-files-preview-status">
              <Alert
                type="error"
                showIcon
                message={fileError.message}
                action={
                  fileError.fallbackUrl ? (
                    <Button
                      size="small"
                      onClick={() => window.open(fileError.fallbackUrl, '_blank', 'noopener,noreferrer')}
                    >
                      新窗口打开
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : current ? (
            <iframe
              key={current.seq}
              ref={iframeRef}
              className="workbench-files-frame"
              title={`预览：${current.name}`}
              src={fileViewerFrameUrl(current.name)}
            />
          ) : (
            <div className="workbench-files-preview-status">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="从左侧目录或对话附件选择文件"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkbenchFilePanel;
