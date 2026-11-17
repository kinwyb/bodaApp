/**
 * 工作台右侧的「文件浏览」面板：agent 工作区目录树 + 多文件页签预览。
 *
 * 预览引擎是独立部署的 file-viewer 官方静态站（零依赖 iframe 集成，见
 * scripts/setup-file-viewer.mjs），本面板只做三件事：
 * 1. 目录树：GET /ws/agents 系列接口懒加载（只读，不提供任何写入口）；
 * 2. 取内容：带 token 把文件拉成 Blob（附件与目录树文件同一条路）；
 * 3. 投递：桥接页 boda-bridge.html 回 ready 后 postMessage(Blob)，见 files/viewer.ts。
 *
 * 每个打开的文件是一个页签（ContextTabs，与主界面同一套右键批量关闭 / keep-alive），
 * 切页签不卸载 iframe，滚动位置与渲染状态保留；关闭即释放。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Button, Empty, Select, Spin, Tag, Tooltip, Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import {
  CloseOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import ContextTabs, { type ContextTabsHandle } from '../components/context-tabs';
import { useFilesDock, type FileTab } from '../store/files-dock-context';
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
import type { WorkspaceAgent, WorkspaceEntry } from '../pages/agent/files';
import { agentTransportMode } from '../pages/agent/transport';

/** 目录树节点：key 就是容器路径，entry/root 用来区分文件、目录与根 */
type FileTreeNode = TreeDataNode & {
  entry?: WorkspaceEntry;
  isRoot?: boolean;
};

/**
 * 页签内容通过 context 读「当下」的 meta：ContextTabs 的 keep-alive 缓存持有
 * 元素身份不变，props 传 meta 会让 blob 异步到达后子树不更新；context 变化
 * 能穿透缓存元素触发消费方重渲染。
 */
const FileTabsContext = createContext<{ tabs: FileTab[]; active: string }>({ tabs: [], active: '' });

/** 单个页签的内容：加载态 / 错误态 / 预览 iframe（ready 后投一次 Blob） */
const FileTabFrame: React.FC<{ tabKey: string }> = ({ tabKey }) => {
  const { tabs } = useContext(FileTabsContext);
  const tab = tabs.find((item) => item.key === tabKey);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const blob = tab?.blob;

  useEffect(() => {
    if (!blob) return;
    const target = fileViewerOrigin();
    let posted = false;
    const post = () => {
      if (posted) return;
      posted = true;
      iframeRef.current?.contentWindow?.postMessage(blob, target);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== target) return;
      // 多页签同时挂载：只认自己这个 iframe 里桥接页发回的 ready
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: string } | null;
      if (data && data.type === 'boda-viewer-ready') post();
    };
    window.addEventListener('message', onMessage);
    // 桥接页自身 15s 必回 ready；兜底只防信号丢失
    const fallback = window.setTimeout(post, 16000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(fallback);
    };
  }, [blob]);

  if (!tab) return null;
  if (tab.error) {
    return (
      <div className="workbench-files-preview-status">
        <Alert
          type="error"
          showIcon
          message={tab.error.message}
          action={
            tab.error.fallbackUrl ? (
              <Button
                size="small"
                onClick={() => window.open(tab.error!.fallbackUrl, '_blank', 'noopener,noreferrer')}
              >
                新窗口打开
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  if (!blob) {
    return (
      <div className="workbench-files-preview-status">
        <Spin />
        <span className="workbench-files-preview-status-text">读取文件…</span>
      </div>
    );
  }
  return (
    <iframe
      ref={iframeRef}
      className="workbench-files-frame"
      title={`预览：${tab.name}`}
      src={fileViewerFrameUrl(tab.name)}
    />
  );
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
  /** 右栏宿主：取消固定；主页签宿主不传（页签与工作台同级不可关闭，不显示关闭按钮） */
  onClose?: () => void;
}> = ({ onClose }) => {
  // agent / 附件 / 停靠态 / 页签存档都走 context：keep-alive 缓存的元素身份不变，
  // props 传值会让异步到达的附件/_blob 更新不进子树，context 能穿透缓存
  const {
    agent,
    attachment,
    docked,
    canDock,
    setDocked,
    tabs: storedTabs,
    active: storedActive,
    onTabsChange,
  } = useFilesDock();
  const mock = agentTransportMode() === 'mock';

  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(agent);

  const [treeData, setTreeData] = useState<FileTreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<React.Key[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  const tabsRef = useRef<ContextTabsHandle<FileTab>>(null);
  const [mirror, setMirror] = useState<{ tabs: FileTab[]; active: string }>({
    tabs: storedTabs,
    active: storedActive,
  });
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

  /** 页签镜像：下载按钮 / 空态 / 目录树选中都从这里读 */
  const handleTabsChange = useCallback(
    (tabs: FileTab[], active: string) => {
      setMirror({ tabs, active });
      // 存档提升到工作台：面板在主页面 / 右栏之间换宿主重挂载时恢复页签
      onTabsChange(tabs, active);
      const current = tabs.find((tab) => tab.key === active);
      setSelectedKeys(current?.workspacePath ? [current.workspacePath] : []);
    },
    [onTabsChange],
  );

  /** 异步取内容写回页签；页签可能已被关掉，updateTab 对不存在的 key 自动忽略 */
  const loadIntoTab = useCallback(
    (key: string, load: () => Promise<{ blob: Blob; downloadUrl?: string }>, fallbackUrl?: string) => {
      load()
        .then(({ blob, downloadUrl }) => {
          tabsRef.current?.updateTab(key, { blob, downloadUrl, error: undefined });
        })
        .catch((error: unknown) => {
          tabsRef.current?.updateTab(key, {
            error: { message: fileErrorMessage(error), fallbackUrl },
          });
        });
    },
    [],
  );

  // 对话附件：父层每次点击都给新对象；同一附件重复点只激活已有页签
  useEffect(() => {
    if (!attachment) return;
    const resolved = resolveAgentFileUrl(attachment.url);
    const handle = tabsRef.current;
    if (!resolved || !handle) return;
    const key = `att:${attachment.url}`;
    const name = attachment.name || resolved.split('?')[0].split('/').pop() || '附件';
    if (handle.getTabs().some((tab) => tab.key === key)) handle.setActive(key);
    else handle.openTab({ key, name });
    loadIntoTab(
      key,
      async () => {
        const response = await fetch(resolved);
        if (!response.ok) {
          throw new AgentFileError(`文件服务返回 ${response.status}`, `http_${response.status}`);
        }
        return {
          blob: await response.blob(),
          downloadUrl: resolveAgentFileUrl(attachment.url, { download: true }),
        };
      },
      resolved,
    );
  }, [attachment, loadIntoTab]);

  /** 目录树懒加载 */
  const loadTreeData = useCallback(async (node: FileTreeNode) => {
    const owner = agentRef.current;
    if (!owner) return;
    try {
      const dir = await listWorkspaceDir(owner, String(node.key));
      // 加载期间切了 agent：丢弃，避免把上一个 agent 的目录挂进来
      if (owner !== agentRef.current) return;
      setTreeData((prev) => attachChildren(prev, node.key, sortEntries(dir.items).map(entryToNode)));
    } catch (error) {
      setAgentsError(fileErrorMessage(error));
      // 标记已加载，防止 antd 对同一节点反复重试
      setLoadedKeys((prev) => [...prev, node.key]);
    }
  }, []);

  /** 点文件 → 开页签预览；点目录/根 → 展开收起（整行可点，不只小箭头） */
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
      const handle = tabsRef.current;
      if (!handle) return;
      const key = `ws:${owner}:${entry.path}`;
      if (handle.getTabs().some((tab) => tab.key === key)) {
        handle.setActive(key);
        return;
      }
      handle.openTab({ key, name: entry.name, workspacePath: entry.path });
      loadIntoTab(key, async () => ({
        blob: await fetchWorkspaceFile(owner, entry.path),
        downloadUrl: workspaceFileUrl(owner, entry.path, { download: true }),
      }));
    },
    [loadIntoTab],
  );

  const handleRefresh = useCallback(() => {
    void loadAgents();
    resetTree(rootNodes);
  }, [loadAgents, resetTree, rootNodes]);

  const renderTabContent = useCallback((tab: FileTab) => <FileTabFrame tabKey={tab.key} />, []);
  const renderTabLabel = useCallback((tab: FileTab) => tab.name, []);

  const agentOptions = useMemo(
    () => agents.map((item) => ({ value: item.name, label: item.name })),
    [agents],
  );
  const activeTab = mirror.tabs.find((tab) => tab.key === mirror.active);

  return (
    <div className="workbench-files-panel">
      <div className="workbench-files-header">
        <span className="workbench-files-title">文件浏览</span>
        <Tag className="workbench-files-readonly">只读</Tag>
        <Select
          size="small"
          className="workbench-files-agent"
          value={selectedAgent || undefined}
          onChange={setSelectedAgent}
          options={agentOptions}
          placeholder="选择 agent"
          popupMatchSelectWidth={200}
          disabled={mock || agents.length === 0}
        />
        <span className="workbench-files-spacer" />
        {canDock ? (
          <Tooltip title={docked ? '取消固定，返回主界面' : '固定到右侧'}>
            <Button
              type="text"
              size="small"
              icon={docked ? <PushpinFilled /> : <PushpinOutlined />}
              onClick={() => setDocked(!docked)}
            />
          </Tooltip>
        ) : null}
        <Tooltip title="刷新目录">
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleRefresh} />
        </Tooltip>
        <Tooltip title="下载当前文件">
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            disabled={!activeTab?.downloadUrl}
            href={activeTab?.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
          />
        </Tooltip>
        {onClose ? (
          <Tooltip title="取消固定">
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
          </Tooltip>
        ) : null}
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
          <FileTabsContext.Provider value={mirror}>
            <ContextTabs
              ref={tabsRef}
              className={`workbench-files-tabs${mirror.tabs.length === 0 ? ' workbench-files-tabs-empty' : ''}`}
              initialTabs={storedTabs}
              initialActiveKey={storedActive || undefined}
              renderLabel={renderTabLabel}
              renderContent={renderTabContent}
              onChange={handleTabsChange}
            />
          </FileTabsContext.Provider>
          {mirror.tabs.length === 0 ? (
            <div className="workbench-files-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="从左侧目录或对话附件选择文件"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default WorkbenchFilePanel;
