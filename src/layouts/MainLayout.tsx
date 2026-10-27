import React, {Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {MenuProps} from 'antd';
import {Avatar, Button, Dropdown, Input, Layout, Menu, Spin, Tabs, theme, Typography} from 'antd';
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
import {useNavigate} from 'react-router-dom';
import {useAuth} from '../store/auth-context';
import {usePermission} from '../store/permission-context';
import {type TabsApi, TabsContext} from '../store/tabs';
import {buildTabKey, instanceOfParams, sameParams} from '../store/tab-key';
import {TabTitleContext, type TabTitleScope} from '../store/tab-title-context';
import type {DesktopMenu} from '../api';
import {isNavigableMenu} from '../services';
import Dashboard from '../pages/Dashboard';
import {resolveView} from '../pages/registry';
import {isBridgedView, useWorkbenchBridge} from '../pages/agent/ui-bridge';
import type {UINavItem} from '../pages/agent/protocol';
import type {ViewTrailItem} from '../pages/types';
import {isDebugEnv} from "@/utils";

const {Header, Sider, Content} = Layout;
const {Text} = Typography;

type AntdMenuItems = NonNullable<MenuProps['items']>;

/**
 * 菜单节点的基础信息：标签名与面包屑层级。
 * 不含页签 key —— key 是「运行时」的，见 tab-key.ts。
 */
interface MenuMeta {
    label: string;
    trail: ViewTrailItem[];
}

/**
 * 一个页签的完整信息。
 *
 * - `key`：页签唯一标识（`view` 或 `view::实例标识`），见 tab-key.ts；
 * - `view`：菜单 View，用来解析页面组件（registry）与面包屑；
 * - `label`：菜单名，页签标题的默认值；
 * - `customTitle`：页面运行时指定的标题（优先于 label），见 useTabTitle。
 */
interface TabMeta {
    key: string;
    view: string;
    label: string;
    customTitle?: string;
    trail: ViewTrailItem[];
    params?: Record<string, unknown>;
}

/** 页签上显示的文字：页面自定义过就用自定义的 */
function displayTitle(meta: TabMeta): string {
    return meta.customTitle ?? meta.label;
}

const HOME_TAB: TabMeta = {key: 'dashboard', view: '', label: '工作台', trail: []};


const iconByMenuName: Record<string, React.ReactNode> = {
    基础资料: <DatabaseOutlined/>,
    工艺管理: <ToolOutlined/>,
    计划管理: <ScheduleOutlined/>,
    生产管理: <ClusterOutlined/>,
    报表管理: <BarChartOutlined/>,
    MIS管理: <DesktopOutlined/>,
    NC: <ApiOutlined/>,
    APS: <DeploymentUnitOutlined/>,
    系统设置: <SettingOutlined/>,
    销售治理: <ShopOutlined/>,
    生产治理: <ControlOutlined/>,
    经营治理: <FundOutlined/>,
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
            result.push({...node, Children: children});
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
                    ? iconByMenuName[node.MenuName] ?? <AppstoreOutlined/>
                    : hasChildren
                        ? <FolderOutlined/>
                        : <FileOutlined/>;
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
    const {userInfo, logout} = useAuth();
    const {token: {colorBgContainer}} = theme.useToken();
    const {menu: menuTree, loading: menuLoading} = usePermission();

    const [collapsed, setCollapsed] = useState(false);
    const [menuKeyword, setMenuKeyword] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [openKeys, setOpenKeys] = useState<string[]>([]);
    const [openTabs, setOpenTabs] = useState<TabMeta[]>([HOME_TAB]);
    const [activeTab, setActiveTab] = useState(HOME_TAB.key);

    const tabInstances = useRef<Map<string, React.ReactNode>>(new Map());

    /** View -> 菜单元数据（标签名 + 从根到当前的层级，用于面包屑） */
    const menuMetaMap = useMemo(() => {
        const map = new Map<string, MenuMeta>();
        const walk = (nodes: DesktopMenu[], trail: ViewTrailItem[]) => {
            nodes.forEach((node) => {
                if (node.IsAction) {
                    if (node.Children) walk(node.Children, trail);
                    return;
                }
                const nextTrail = [...trail, {view: node.View, name: node.MenuName}];
                map.set(node.View, {label: node.MenuName, trail: nextTrail});
                if (node.Children) walk(node.Children, nextTrail);
            });
        };
        walk(menuTree, []);
        return map;
    }, [menuTree]);

    const displayTree = useMemo(() => filterMenuTree(menuTree, menuKeyword), [menuTree, menuKeyword]);
    const menuItems = useMemo(() => buildMenuItems(displayTree, 0), [displayTree]);

    /**
     * 界面桥用的导航清单：权限过滤后的菜单，**只留已接入界面桥的页面**，平铺成 {view, title, trail}。
     *
     * 用菜单的 View 与名称而不是 URL：模型按业务名称选页面，猜 URL 对它没有意义
     * （页面解析走 `resolveView` 的「精确命中 → 逐级取祖先 → 兜底列表页」规则）。
     *
     * 为什么过滤：没接桥的页面（通用列表页 ViewPage 就是）agent 打开后既看不到数据、
     * 也执行不了任何命令，列出来只会让它白跑一趟。判定依据是页面目录下有没有 `bridged.ts`。
     */
    const navItems = useMemo<UINavItem[]>(
        () =>
            [...menuMetaMap.entries()]
                .filter(([view]) => isBridgedView(view))
                .map(([view, meta]) => ({
                    view,
                    title: meta.label,
                    trail: meta.trail.map((item) => item.name),
                })),
        [menuMetaMap],
    );

    /**
     * 左侧菜单的高亮项：**用 view**（菜单项的 key），不是页签 key。
     * 页签 key 可能带 `::实例标识` 后缀，同一个菜单可以同时开着好几个页签，
     * 高亮的是它们共同的菜单节点。
     */
    const activeView = useMemo(() => {
        const active = openTabs.find((tab) => tab.key === activeTab);
        return active?.view ?? '';
    }, [openTabs, activeTab]);

    /**
     * 打开（或激活）一个页签。
     *
     * 同一个 key 再次打开时：
     * - 参数没变 → 只激活，不动页面状态与标题；
     * - 参数变了 → 换参数并重建页面（否则页面内部还拿着旧参数）。
     */
    const openTab = useCallback(
        (meta: TabMeta) => {
            setOpenTabs((prev) => {
                const index = prev.findIndex((tab) => tab.key === meta.key);
                if (index < 0) return [...prev, meta];
                const current = prev[index];
                if (sameParams(current.params, meta.params)) {
                    // 显式传了标题就以它为准；没传则保留页面自己设的标题
                    if (meta.customTitle === undefined || meta.customTitle === current.customTitle) {
                        return prev;
                    }
                    const next = [...prev];
                    next[index] = {...current, customTitle: meta.customTitle};
                    return next;
                }
                // 参数变了，丢掉这个页面的元素缓存，否则会复用带旧参数的旧元素
                tabInstances.current.delete(meta.key);
                const next = [...prev];
                next[index] = {
                    ...current,
                    params: meta.params,
                    // 标题一并重置：页面会重新挂载、由它自己按新数据再设一次
                    // （留着旧标题会出现「标题还是上一单的号、内容已经是新单」的错位）
                    customTitle: meta.customTitle,
                };
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
     *
     * 页签怎么区分（见 store/tab-key.ts）：
     * - 菜单点进来的：实例标识为空 → key 就是 view，**同一菜单永远只有一个页签**；
     * - 代码 openView 的：实例标识 = 参数指纹（或业务指定的 tabKey）
     *   → 参数一样是同一个页签，参数不一样各开一个，可以同时看几张单子。
     */
    const tabsApi = useMemo<TabsApi>(
        () => ({
            openView: (view, params, options) => {
                // 菜单树里有就用它的标签名与面包屑，没有就退化成 View 本身
                const menuMeta = menuMetaMap.get(view);
                const instance = options?.tabKey ?? instanceOfParams(params);
                openTab({
                    key: buildTabKey(view, instance),
                    view,
                    label: menuMeta?.label ?? view,
                    customTitle: options?.title,
                    trail: menuMeta?.trail ?? [],
                    params,
                });
            },
        }),
        [openTab, menuMetaMap],
    );

    /*
     * 界面桥（工作台级）：把「你在哪、能去哪」交给 agent。
     *
     * 常驻在这里而不是业务页里 —— 用户停在主页、没进任何业务页面时，
     * agent 也能被正确告知工作台状态与可打开的页面。页面里注册的是另一半
     * （这一页能做什么、怎么操作）。
     */
    useWorkbenchBridge({
        currentView: () => activeView,
        navigation: () => navItems,
        // 菜单里有没有这一项（不论接没接桥）：桥用它把 navigate 的失败原因说准
        canOpen: (view) => menuMetaMap.has(view),
        openView: (view, params) => tabsApi.openView(view, params),
    });

    const handleMenuClick = useCallback(
        (info: { key: string }) => {
            isDebugEnv && console.log(info);
            const menuMeta = menuMetaMap.get(info.key);
            // 菜单进来的实例标识为空 → 永远是「view」这一个页签，已开着就只激活
            if (menuMeta) {
                openTab({
                    key: buildTabKey(info.key, ''),
                    view: info.key,
                    label: menuMeta.label,
                    trail: menuMeta.trail,
                });
            }
            // 选中菜单后收起搜索并还原完整菜单树
            setSearchOpen(false);
            setMenuKeyword('');
        },
        [openTab, menuMetaMap],
    );

    /**
     * 页面运行时改写自己页签的标题（订单号之类），见 store/tab-title-context.ts。
     * 只改 openTabs 里的那一项，页面元素缓存不动 → 不会导致页面重挂载。
     */
    const setTabTitle = useCallback((tabKey: string, title: string | undefined) => {
        setOpenTabs((prev) => {
            const index = prev.findIndex((tab) => tab.key === tabKey);
            if (index < 0) return prev;
            const current = prev[index];
            if (current.customTitle === title) return prev;
            const next = [...prev];
            next[index] = {...current, customTitle: title};
            return next;
        });
    }, []);


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
        navigate('/login', {replace: true});
    }, [logout, navigate]);

    const userMenuItems = useMemo(
        () => ({
            items: [
                {key: 'logout', icon: <LogoutOutlined/>, label: '退出登录', onClick: handleLogout},
            ],
        }),
        [handleLogout],
    );

    const renderTabContent = useCallback(
        (meta: TabMeta) => {
            let node = tabInstances.current.get(meta.key);
            if (!node) {
                if (meta.key === HOME_TAB.key) {
                    node = <Dashboard/>;
                } else {
                    // 页面组件按 **view** 解析（页签 key 可能带 `::实例标识` 后缀，不是 View 路径）
                    const PageComponent = resolveView(meta.view);
                    // 作用域绑定到「本页签自己的 key」：页面改标题时只改自己那个页签，不会串到别的页签
                    const scope: TabTitleScope = {
                        tabKey: meta.key,
                        baseLabel: meta.label,
                        setTitle: (title: string | undefined) => setTabTitle(meta.key, title),
                    };
                    node = (
                        <TabTitleContext.Provider value={scope}>
                            <Suspense
                                // key 带上参数：业务指定了 tabKey 时，同一个页签可能被换成另一组参数，
                                // 带上参数才能强制重建，让页面拿到新参数
                                // （不然 React 会复用组件实例，只更新 props，页面内部的初始状态还是旧的）
                                key={`${meta.key}::${JSON.stringify(meta.params ?? null)}`}
                                fallback={
                                    <div style={{textAlign: 'center', padding: '48px 0'}}>
                                        <Spin/>
                                    </div>
                                }
                            >
                                <PageComponent view={meta.view} trail={meta.trail} params={meta.params}/>
                            </Suspense>
                        </TabTitleContext.Provider>
                    );
                }
                tabInstances.current.set(meta.key, node);
            }
            return node;
        },
        [setTabTitle],
    );

    const tabItems = useMemo(
        () =>
            openTabs.map((meta) => ({
                key: meta.key,
                label: displayTitle(meta),
                closable: meta.key !== HOME_TAB.key,
                children: renderTabContent(meta),
            })),
        [openTabs, renderTabContent],
    );

    /**
     * 窗口标题跟着当前页签走。
     *
     * 桌面壳那边（MyGo）默认让原生窗口标题跟随页面的 `<title>`（没注册阻止逻辑），
     * 所以这里改 document.title 就同时改了浏览器标签页与桌面窗口标题。
     */
    useEffect(() => {
        const active = openTabs.find((tab) => tab.key === activeTab);
        const title = active ? displayTitle(active) : '';
        document.title = title ? `${title} - bodaWay` : 'bodaWay';
    }, [openTabs, activeTab]);


    return (
        <Layout style={{height: '100%', overflow: 'hidden'}}>
            <Sider
                className="main-sider"
                trigger={null}
                collapsible
                collapsed={collapsed}
                theme="light"
                width={220}
                style={{borderRight: '1px solid #f0f0f0', boxShadow: '1px 0 4px rgba(0,0,0,0.04)'}}
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
                        <div style={{textAlign: 'center', padding: '24px 0'}}>
                            <Spin size="small"/>
                        </div>
                    ) : (
                        <Menu
                            theme="light"
                            mode="inline"
                            items={menuItems}
                            selectedKeys={activeView ? [activeView] : []}
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
                            prefix={<SearchOutlined/>}
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
                            icon={<SearchOutlined/>}
                            style={{justifyContent: collapsed ? 'center' : 'flex-start'}}
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
                    <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                        <Button
                            type="text"
                            icon={collapsed ? <MenuUnfoldOutlined/> : <MenuFoldOutlined/>}
                            onClick={() => setCollapsed(!collapsed)}
                        />
                        <Button type="text" icon={<HomeOutlined/>} onClick={() => openTab(HOME_TAB)}/>
                    </div>
                    <Dropdown menu={userMenuItems} placement="bottomRight">
                        <div style={{cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8}}>
                            <Avatar size="small" icon={<UserOutlined/>}/>
                            <Text>{userInfo?.EmpName ?? userInfo?.EmpID ?? ''}</Text>
                        </div>
                    </Dropdown>
                </Header>
                <Content style={{margin: 4, overflow: 'hidden'}}>
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
