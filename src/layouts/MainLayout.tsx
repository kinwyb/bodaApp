import React, { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Layout, Menu, Button, Tabs, theme, Avatar, Dropdown, Typography, Input, Spin } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  ClusterOutlined,
  ControlOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  DesktopOutlined,
  FileOutlined,
  FolderOutlined,
  FundOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ScheduleOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth-context';
import { usePermission } from '../store/permission-context';
import { TabsContext, type TabsApi } from '../store/tabs';
import type { DesktopMenu } from '../api';
import { isNavigableMenu } from '../services';
import Dashboard from '../pages/Dashboard';
import { resolveView } from '../pages/registry';
import type { ViewTrailItem } from '../pages/types';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

type AntdMenuItems = NonNullable<MenuProps['items']>;

interface TabMeta {
  key: string;
  label: string;
  trail: ViewTrailItem[];
  /** 带参数跳转时携带的入参；点菜单打开的是普通标签，没有这个字段 */
  params?: Record<string, unknown>;
}

const HOME_TAB: TabMeta = { key: 'dashboard', label: '工作台', trail: [] };

const iconByMenuName: Record<string, React.ReactNode> = {
  基础资料: <DatabaseOutlined />,
  工艺管理: <ToolOutlined />,
  计划管理: <ScheduleOutlined />,
  生产管理: <ClusterOutlined />,
  报表管理: <BarChartOutlined />,
  MIS管理: <DesktopOutlined />,
  NC: <ApiOutlined />,
  APS: <DeploymentUnitOutlined />,
  系统设置: <SettingOutlined />,
  销售治理: <ShopOutlined />,
  生产治理: <ControlOutlined />,
  经营治理: <FundOutlined />,
};

/** 按关键字过滤菜单树，命中的节点保留整棵子树，否则只保留匹配的孩子 */
function filterMenuTree(nodes: DesktopMenu[], keyword: string): DesktopMenu[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return nodes;
  const result: DesktopMenu[] = [];
  nodes.forEach((node) => {
    if (!isNavigableMenu(node)) return;
    if (node.MenuName.toLowerCase().includes(kw)) {
      result.push(node);
      return;
    }
    const children = node.Children ? filterMenuTree(node.Children, keyword) : [];
    if (children.length) {
      result.push({ ...node, Children: children });
    }
  });
  return result;
}

function buildMenuItems(nodes: DesktopMenu[], depth: number): AntdMenuItems {
  return nodes
    .filter(isNavigableMenu)
    .map((node) => {
      const childItems = node.Children ? buildMenuItems(node.Children, depth + 1) : [];
      const hasChildren = childItems.length > 0;
      const icon =
        depth === 0
          ? iconByMenuName[node.MenuName] ?? <AppstoreOutlined />
          : hasChildren
            ? <FolderOutlined />
            : <FileOutlined />;
      return {
        key: node.View,
        icon,
        label: node.MenuName,
        children: hasChildren ? childItems : undefined,
      };
    });
}

function collectSubmenuKeys(nodes: DesktopMenu[], keys: string[] = []): string[] {
  nodes
    .filter(isNavigableMenu)
    .forEach((node) => {
      if (node.Children && node.Children.length) {
        keys.push(node.View);
        collectSubmenuKeys(node.Children, keys);
      }
    });
  return keys;
}

const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const { userInfo, logout } = useAuth();
  const { token: { colorBgContainer } } = theme.useToken();
  const { menu: menuTree, loading: menuLoading } = usePermission();

  const [collapsed, setCollapsed] = useState(false);
  const [menuKeyword, setMenuKeyword] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [openTabs, setOpenTabs] = useState<TabMeta[]>([HOME_TAB]);
  const [activeTab, setActiveTab] = useState(HOME_TAB.key);

  const tabInstances = useRef<Map<string, React.ReactNode>>(new Map());

  /** View -> Tab 元数据，含从根到当前的层级，用于面包屑 */
  const tabMetaMap = useMemo(() => {
    const map = new Map<string, TabMeta>();
    const walk = (nodes: DesktopMenu[], trail: ViewTrailItem[]) => {
      nodes.forEach((node) => {
        if (node.IsAction) {
          if (node.Children) walk(node.Children, trail);
          return;
        }
        const nextTrail = [...trail, { view: node.View, name: node.MenuName }];
        map.set(node.View, { key: node.View, label: node.MenuName, trail: nextTrail });
        if (node.Children) walk(node.Children, nextTrail);
      });
    };
    walk(menuTree, []);
    return map;
  }, [menuTree]);

  const displayTree = useMemo(() => filterMenuTree(menuTree, menuKeyword), [menuTree, menuKeyword]);
  const menuItems = useMemo(() => buildMenuItems(displayTree, 0), [displayTree]);

  const openTab = useCallback(
    (meta: TabMeta) => {
      setOpenTabs((prev) => {
        const index = prev.findIndex((tab) => tab.key === meta.key);
        if (index < 0) return [...prev, meta];
        // 已经开着：只有参数变了才替换，否则原样返回（避免无谓的重渲染）
        if (prev[index].params === meta.params) return prev;
        // 参数变了，丢掉这个页面的元素缓存，否则会复用带旧参数的旧元素
        tabInstances.current.delete(meta.key);
        const next = [...prev];
        next[index] = meta;
        return next;
      });
      setActiveTab(meta.key);
      const ancestors = meta.trail.slice(0, -1).map((item) => item.view);
      if (ancestors.length) {
        setOpenKeys((prev) => Array.from(new Set([...prev, ...ancestors])));
      }
    },
    [],
  );

  /**
   * 暴露给业务页面的跳转能力，见 store/tabs.tsx。
   * 页面只依赖「传 View + 参数」这个抽象，不关心底层的标签页状态怎么存 ——
   * 所以将来若把标签页改成 URL 驱动，只需换掉这里的实现，页面代码不用动。
   */
  const tabsApi = useMemo<TabsApi>(
    () => ({
      openView: (view, params) => {
        // 菜单树里有就用它（标签名、面包屑都在这儿），没有就退化成 View 本身
        const meta = tabMetaMap.get(view) ?? { key: view, label: view, trail: [] };
        openTab({ ...meta, params });
      },
    }),
    [openTab, tabMetaMap],
  );

  const handleMenuClick = useCallback(
    (info: { key: string }) => {
      const meta = tabMetaMap.get(info.key);
      if (meta) openTab(meta);
      // 选中菜单后收起搜索并还原完整菜单树
      setSearchOpen(false);
      setMenuKeyword('');
    },
    [openTab, tabMetaMap],
  );

  const handleTabEdit = useCallback(
    (targetKey: string | React.MouseEvent | React.KeyboardEvent, action: 'add' | 'remove') => {
      if (action !== 'remove') return;
      const key = targetKey as string;
      if (key === HOME_TAB.key) return;
      setOpenTabs((prev) => {
        const next = prev.filter((tab) => tab.key !== key);
        if (next.length === 0) return prev;
        tabInstances.current.delete(key);
        if (activeTab === key) {
          const index = prev.findIndex((tab) => tab.key === key);
          setActiveTab(next[Math.min(index, next.length - 1)].key);
        }
        return next;
      });
    },
    [activeTab],
  );

  const handleMenuSearch = useCallback(
    (value: string) => {
      setMenuKeyword(value);
      if (value.trim()) {
        setOpenKeys(collectSubmenuKeys(filterMenuTree(menuTree, value)));
      }
    },
    [menuTree],
  );

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const userMenuItems = useMemo(
    () => ({
      items: [
        { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
      ],
    }),
    [handleLogout],
  );

  const renderTabContent = useCallback(
    (meta: TabMeta) => {
      let node = tabInstances.current.get(meta.key);
      if (!node) {
        if (meta.key === HOME_TAB.key) {
          node = <Dashboard />;
        } else {
          const PageComponent = resolveView(meta.key);
          node = (
            <Suspense
              // key 带上参数指纹：同一个 View 用不同参数再次打开时强制重建，让页面拿到新参数
              // （不然 React 会复用组件实例，只更新 props，页面内部的初始状态还是旧的）
              key={`${meta.key}::${JSON.stringify(meta.params ?? null)}`}
              fallback={
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <Spin />
                </div>
              }
            >
              <PageComponent view={meta.key} trail={meta.trail} params={meta.params} />
            </Suspense>
          );
        }
        tabInstances.current.set(meta.key, node);
      }
      return node;
    },
    [],
  );

  const tabItems = useMemo(
    () =>
      openTabs.map((meta) => ({
        key: meta.key,
        label: meta.label,
        closable: meta.key !== HOME_TAB.key,
        children: renderTabContent(meta),
      })),
    [openTabs, renderTabContent],
  );

  return (
    <Layout style={{ height: '100%', overflow: 'hidden' }}>
      <Sider
        className="main-sider"
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="light"
        width={220}
        style={{ borderRight: '1px solid #f0f0f0', boxShadow: '1px 0 4px rgba(0,0,0,0.04)' }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: collapsed ? 16 : 18,
            fontWeight: 700,
            letterSpacing: 1,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            color: '#1890ff',
            borderBottom: '1px solid #f0f0f0',
            flex: '0 0 auto',
          }}
        >
          {collapsed ? 'BW' : 'BodaWay'}
        </div>
        <div className="main-sider-menu">
          {menuLoading ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Spin size="small" />
            </div>
          ) : (
            <Menu
              theme="light"
              mode="inline"
              items={menuItems}
              selectedKeys={[activeTab]}
              openKeys={openKeys}
              onOpenChange={setOpenKeys}
              onClick={handleMenuClick}
            />
          )}
        </div>
        <div className="main-sider-footer">
          {searchOpen && !collapsed ? (
            <Input
              autoFocus
              allowClear
              size="small"
              placeholder="搜索菜单"
              prefix={<SearchOutlined />}
              value={menuKeyword}
              onChange={(event) => handleMenuSearch(event.target.value)}
              onBlur={() => {
                if (!menuKeyword) setSearchOpen(false);
              }}
            />
          ) : (
            <Button
              type="text"
              block
              icon={<SearchOutlined />}
              style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
              onClick={() => {
                if (collapsed) setCollapsed(false);
                setSearchOpen(true);
              }}
            >
              {collapsed ? undefined : '菜单搜索'}
            </Button>
          )}
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 16px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            zIndex: 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Button type="text" icon={<HomeOutlined />} onClick={() => openTab(HOME_TAB)} />
          </div>
          <Dropdown menu={userMenuItems} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <Text>{userInfo?.EmpName ?? userInfo?.EmpID ?? ''}</Text>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 4, overflow: 'hidden' }}>
          {/* 页面组件通过 useTabs() 拿跳转能力，所以 Provider 要包住 Tabs 的内容 */}
          <TabsContext.Provider value={tabsApi}>
            <div className="main-content-panel">
              <Tabs
                className="main-tabs"
                type="editable-card"
                hideAdd
                activeKey={activeTab}
                onChange={setActiveTab}
                onEdit={handleTabEdit}
                items={tabItems}
                destroyOnHidden={false}
              />
            </div>
          </TabsContext.Provider>
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
