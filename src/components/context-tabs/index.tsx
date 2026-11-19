/**
 * 带右键批量关闭菜单的页签容器（主界面与工作台文件面板共用）。
 *
 * 收敛的行为（原先散在主界面里）：
 * - 右键菜单：关闭当前 / 左侧 / 右侧 / 其他 / 全部，按位置与可关闭性禁用；
 * - X 按钮单个关闭；激活页被关时落点：fallbackKey → 右邻 → 左邻 → 首个；
 * - keep-alive：renderContent 的结果按 key 缓存，切页签不重挂载；
 *   关闭即清缓存，重开按新状态重建；openTab(rebuild) 强制清缓存；
 * - Dropdown 关闭后会把焦点还给被右键的页签并触发 onChange，
 *   若它刚被关掉要挡住，否则激活项落到不存在的 key 上。
 *
 * 状态由组件持有，外部通过 ref 命令式操作 + onChange 拿镜像渲染周边界面
 * （菜单高亮、窗口标题等）。本文件按项目约定只导出组件（类型除外）。
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Dropdown, Tabs } from 'antd';
import type { MenuProps } from 'antd';

/** 页签最小契约：key 唯一；其余字段由使用方扩展 */
export type ContextTabMeta = {
  key: string;
};

export type ContextTabsHandle<T extends ContextTabMeta> = {
  /** 打开（或激活）页签；已存在时整体替换 meta，rebuild 清掉内容缓存强制重建 */
  openTab: (meta: T, options?: { rebuild?: boolean; activate?: boolean }) => void;
  /** 只改 meta 不动内容缓存（改标题之类） */
  updateTab: (key: string, patch: Partial<T>) => void;
  closeTabs: (keys: string[], fallbackKey?: string) => void;
  setActive: (key: string) => void;
  /** 整体重置（组织切换之类），清空内容缓存 */
  reset: (tabs: T[], activeKey?: string) => void;
  getTabs: () => T[];
  getActiveKey: () => string;
};

type ContextTabsProps<T extends ContextTabMeta> = {
  initialTabs: T[];
  initialActiveKey?: string;
  /** 不可关闭的页签（主界面的工作台）；默认全部可关闭 */
  isClosable?: (tab: T) => boolean;
  /** 暂时隐藏的页签 key（状态与内容缓存保留，只是不渲染）；激活页被隐藏时落到最后一个可见页 */
  hiddenKeys?: string[];
  renderLabel: (tab: T) => React.ReactNode;
  renderContent: (tab: T) => React.ReactNode;
  /** 页签集合 / 激活项变化后的镜像，供外部渲染周边界面 */
  onChange?: (tabs: T[], activeKey: string) => void;
  className?: string;
};

function ContextTabsInner<T extends ContextTabMeta>(
  {
    initialTabs,
    initialActiveKey,
    isClosable,
    hiddenKeys,
    renderLabel,
    renderContent,
    onChange,
    className,
  }: ContextTabsProps<T>,
  ref: React.Ref<ContextTabsHandle<T>>,
) {
  const [tabs, setTabs] = useState<T[]>(initialTabs);
  const [activeKey, setActiveKey] = useState(initialActiveKey ?? initialTabs[0]?.key ?? '');

  // 关闭逻辑永远基于「当下」：右键菜单 onClick 被 memo 缓存，闭包会拿旧值
  const tabsRef = useRef(tabs);
  const activeRef = useRef(activeKey);
  const instances = useRef<Map<string, React.ReactNode>>(new Map());

  const hidden = useMemo(() => new Set(hiddenKeys ?? []), [hiddenKeys]);
  const visibleTabs = useMemo(() => tabs.filter((tab) => !hidden.has(tab.key)), [tabs, hidden]);
  /** 激活页被隐藏时（如文件页签停靠到右栏）主界面落到最后一个可见页 */
  const effectiveActive = hidden.has(activeKey)
    ? (visibleTabs[visibleTabs.length - 1]?.key ?? '')
    : activeKey;

  useEffect(() => {
    tabsRef.current = tabs;
    activeRef.current = activeKey;
    onChange?.(visibleTabs, effectiveActive);
  }, [tabs, activeKey, visibleTabs, effectiveActive, onChange]);

  const closable = useCallback((tab: T) => (isClosable ? isClosable(tab) : true), [isClosable]);

  /** 关闭一批页签；激活页被关时按 fallbackKey → 右邻 → 左邻 → 首个 落点 */
  const closeTabs = useCallback(
    (keys: string[], fallbackKey?: string) => {
      const prev = tabsRef.current;
      const closing = new Set(keys.filter((key) => prev.some((tab) => tab.key === key && closable(tab))));
      if (closing.size === 0) return;
      const next = prev.filter((tab) => !closing.has(tab.key));
      closing.forEach((key) => instances.current.delete(key));
      // 同步刷新 ref：紧接着 Dropdown 关闭触发的 onChange 守卫要立刻看到新集合
      tabsRef.current = next;
      setTabs(next);
      const currentActive = activeRef.current;
      if (closing.has(currentActive)) {
        const visibleNext = next.filter((tab) => !hidden.has(tab.key));
        const survived = fallbackKey ? visibleNext.find((tab) => tab.key === fallbackKey) : undefined;
        const index = prev.findIndex((tab) => tab.key === currentActive);
        const neighbor = visibleNext[Math.min(index, visibleNext.length - 1)];
        const pick = (survived ?? neighbor ?? visibleNext[0])?.key ?? '';
        activeRef.current = pick;
        setActiveKey(pick);
      }
    },
    [closable, hidden],
  );

  const openTab = useCallback((meta: T, options?: { rebuild?: boolean; activate?: boolean }) => {
    if (options?.rebuild) instances.current.delete(meta.key);
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.key === meta.key);
      if (index < 0) return [...prev, meta];
      const next = [...prev];
      next[index] = meta;
      return next;
    });
    if (options?.activate === false) return;
    activeRef.current = meta.key;
    setActiveKey(meta.key);
  }, []);

  const updateTab = useCallback((key: string, patch: Partial<T>) => {
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.key === key);
      if (index < 0) return prev;
      const next = [...prev];
      next[index] = { ...prev[index], ...patch };
      return next;
    });
  }, []);

  const setActive = useCallback((key: string) => {
    if (!tabsRef.current.some((tab) => tab.key === key)) return;
    activeRef.current = key;
    setActiveKey(key);
  }, []);

  const reset = useCallback((next: T[], nextActive?: string) => {
    instances.current.clear();
    tabsRef.current = next;
    setTabs(next);
    const pick = nextActive ?? next[0]?.key ?? '';
    activeRef.current = pick;
    setActiveKey(pick);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      openTab,
      updateTab,
      closeTabs,
      setActive,
      reset,
      getTabs: () => tabsRef.current,
      getActiveKey: () => activeRef.current,
    }),
    [openTab, updateTab, closeTabs, setActive, reset],
  );

  /** 右键菜单动作：按右键页签的位置算出要关闭的集合 */
  const handleContextAction = useCallback(
    (tabKey: string, action: string) => {
      const current = tabsRef.current;
      const index = current.findIndex((tab) => tab.key === tabKey);
      if (index < 0) return;
      switch (action) {
        case 'close':
          closeTabs([tabKey]);
          break;
        case 'closeLeft':
          closeTabs(current.slice(0, index).map((tab) => tab.key), tabKey);
          break;
        case 'closeRight':
          closeTabs(current.slice(index + 1).map((tab) => tab.key), tabKey);
          break;
        case 'closeOthers':
          closeTabs(current.filter((tab) => tab.key !== tabKey).map((tab) => tab.key), tabKey);
          break;
        case 'closeAll':
          closeTabs(current.map((tab) => tab.key), tabKey);
          break;
      }
    },
    [closeTabs],
  );

  /** 右键菜单：按位置与可关闭性禁用不可用的动作 */
  const contextMenu = useCallback(
    (tabKey: string): MenuProps => {
      // 渲染期用 state（ref 要到 effect 才同步，菜单禁用态会慢一拍）
      const current = tabs;
      const index = current.findIndex((tab) => tab.key === tabKey);
      const target = current[index];
      const canClose = target ? closable(target) : false;
      return {
        items: [
          { key: 'close', label: '关闭当前标签', disabled: !canClose },
          {
            key: 'closeLeft',
            label: '关闭左侧标签',
            disabled: !current.slice(0, index).some(closable),
          },
          { key: 'closeRight', label: '关闭右侧标签', disabled: index >= current.length - 1 },
          {
            key: 'closeOthers',
            label: '关闭其他标签',
            disabled: !current.some((tab) => tab.key !== tabKey && closable(tab)),
          },
          { type: 'divider' },
          { key: 'closeAll', label: '关闭全部标签', disabled: !current.some(closable) },
        ],
        onClick: ({ key: action }) => handleContextAction(tabKey, action),
      };
    },
    [tabs, closable, handleContextAction],
  );

  /** 右键菜单关闭后 Dropdown 还焦点触发 onChange：刚被关掉的 key 要挡住 */
  const handleChange = useCallback((key: string) => {
    if (tabsRef.current.some((tab) => tab.key === key)) {
      activeRef.current = key;
      setActiveKey(key);
    }
  }, []);

  const handleEdit = useCallback(
    (targetKey: string | React.MouseEvent | React.KeyboardEvent, action: 'add' | 'remove') => {
      if (action !== 'remove') return;
      closeTabs([targetKey as string]);
    },
    [closeTabs],
  );

  const items = useMemo(
    () =>
      visibleTabs.map((meta) => {
        let node = instances.current.get(meta.key);
        if (!node) {
          node = renderContent(meta);
          instances.current.set(meta.key, node);
        }
        return {
          key: meta.key,
          label: (
            <Dropdown menu={contextMenu(meta.key)} trigger={['contextMenu']}>
              <span className="context-tab-label">{renderLabel(meta)}</span>
            </Dropdown>
          ),
          closable: closable(meta),
          children: node,
        };
      }),
    [visibleTabs, renderContent, renderLabel, contextMenu, closable],
  );

  return (
    <Tabs
      className={className}
      type="editable-card"
      hideAdd
      activeKey={effectiveActive}
      onChange={handleChange}
      onEdit={handleEdit}
      items={items}
      destroyOnHidden={false}
    />
  );
}

/** 泛型 forwardRef：保留使用方自己的页签 meta 类型 */
const ContextTabs = forwardRef(ContextTabsInner) as <T extends ContextTabMeta>(
  props: ContextTabsProps<T> & { ref?: React.Ref<ContextTabsHandle<T>> },
) => React.ReactElement;

export default ContextTabs;
