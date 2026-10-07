import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import {
  ApiError,
  applyMenuPermission,
  buildPermissionIndex,
  powerService,
  type MenuActionItem,
  type DesktopMenu,
} from '../services';

export interface PermissionContextValue {
  /** 菜单权限是否加载中 */
  loading: boolean;
  /** 按权限过滤后的可见菜单树 */
  menu: DesktopMenu[];
  /** 菜单 View -> 该菜单的按钮权限 */
  actions: Map<string, MenuActionItem[]>;
  /** 系统菜单中的按钮节点：MenuCode -> 节点 */
  buttons: Map<string, DesktopMenu>;
  /** 按按钮 MenuCode 判断是否有权限 */
  hasButton: (menuCode: string) => boolean;
  /** 按页面 View 判断菜单权限 */
  hasMenu: (view: string) => boolean;
}

const PermissionContext = createContext<PermissionContextValue | null>(null);

export function usePermission(): PermissionContextValue {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermission 必须在 PermissionProvider 内使用');
  }
  return context;
}

export const PermissionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<DesktopMenu[]>([]);
  const [permittedIds, setPermittedIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [systemRes, permissionRes] = await Promise.all([
          powerService.desktopMenu(),
          powerService.userMenus(),
        ]);
        if (cancelled) return;
        setSystem(systemRes.data);
        setPermittedIds(buildPermissionIndex(permissionRes.data).ids);
      } catch (error) {
        if (!cancelled) {
          message.error(error instanceof ApiError ? error.message : '加载菜单权限失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const value = useMemo<PermissionContextValue>(() => {
    const { tree, actions } = applyMenuPermission(system, { ids: permittedIds });

    // MenuCode / View -> 是否授权，授权规则为「权限 id 命中 ViewID」
    const buttons = new Map<string, DesktopMenu>();
    const allowedByCode = new Map<string, boolean>();
    const allowedByView = new Map<string, boolean>();

    const walk = (nodes: DesktopMenu[]) => {
      nodes.forEach((node) => {
        allowedByView.set(node.View, permittedIds.has(node.ViewID));
        if (node.IsAction) {
          buttons.set(node.MenuCode, node);
          allowedByCode.set(node.MenuCode, permittedIds.has(node.ViewID));
          return;
        }
        if (node.Children) walk(node.Children);
      });
    };
    walk(system);

    return {
      loading,
      menu: tree,
      actions,
      buttons,
      hasButton: (menuCode: string) => allowedByCode.get(menuCode) ?? false,
      hasMenu: (view: string) => allowedByView.get(view) ?? false,
    };
  }, [loading, permittedIds, system]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
};
