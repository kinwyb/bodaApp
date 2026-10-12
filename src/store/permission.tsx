import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import { ApiError, powerApi, type DesktopMenu } from '../api';
import {
  applyMenuPermission,
  buildPermissionIndex,
  collectAllViewIds,
  SUPER_ADMIN_USER_ID,
  type MenuActionItem,
} from '../services';
import { useAuth } from './auth';

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
  const { userInfo } = useAuth();
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<DesktopMenu[]>([]);
  const [permittedIds, setPermittedIds] = useState<Set<number>>(() => new Set());

  /**
   * 实际生效的权限集合。
   *
   * 超级管理员按「全集」算（见 SUPER_ADMIN_USER_ID）—— 这里刻意只**换集合**，
   * 不另写一套过滤分支：菜单树过滤、按钮权限判断共用下面同一条计算路径，
   * 就不会出现「菜单放行了、按钮没放行」这类两处逻辑漂移。
   *
   * UserID 来自 /login/userInfo（每次启动由 token 换取），前端改不了：
   * 启动校验期间不渲染主界面，校验成功后立刻被接口数据覆盖，改缓存无效。
   */
  const effectiveIds = useMemo(
    () => (userInfo?.UserID === SUPER_ADMIN_USER_ID ? collectAllViewIds(system) : permittedIds),
    [userInfo?.UserID, permittedIds, system],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [systemRes, permissionRes] = await Promise.all([
          powerApi.desktopMenu(),
          powerApi.userMenus(),
        ]);
        if (cancelled) return;
        setSystem(systemRes.data ?? []);
        setPermittedIds(buildPermissionIndex(permissionRes.data ?? []).ids);
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
    const { tree, actions } = applyMenuPermission(system, { ids: effectiveIds });

    // MenuCode / View -> 是否授权，授权规则为「权限 id 命中 ViewID」
    const buttons = new Map<string, DesktopMenu>();
    const allowedByCode = new Map<string, boolean>();
    const allowedByView = new Map<string, boolean>();

    const walk = (nodes: DesktopMenu[]) => {
      nodes.forEach((node) => {
        allowedByView.set(node.View, effectiveIds.has(node.ViewID));
        if (node.IsAction) {
          buttons.set(node.MenuCode, node);
          allowedByCode.set(node.MenuCode, effectiveIds.has(node.ViewID));
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
  }, [effectiveIds, loading, system]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
};
