import { createContext, useContext } from 'react';
import type { MenuActionItem } from '../services';
import type { DesktopMenu } from '../api';

/**
 * 菜单权限上下文与消费 Hook。
 *
 * 为什么不跟 PermissionProvider 放一个文件：React Fast Refresh 要求「一个模块要么只导出组件，
 * 要么完全不导出组件」。usePermission 是小写函数，会被判定成非组件导出 —— 与 PermissionProvider
 * 同处一个模块时，每次改动都会让该模块的刷新边界失效（控制台报
 * "Could not Fast Refresh ("usePermission" export is incompatible)"）并退化成整页刷新。
 * 拆到本模块后这里没有任何组件导出，Vite 不会给它注入刷新边界。
 */
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

export const PermissionContext = createContext<PermissionContextValue | null>(null);

export function usePermission(): PermissionContextValue {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermission 必须在 PermissionProvider 内使用');
  }
  return context;
}
