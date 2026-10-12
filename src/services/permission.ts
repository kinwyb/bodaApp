import type {DesktopMenu, UserMenu} from '@/api';
import {pickByEnv} from '@/utils';

/**
 * 菜单权限的业务逻辑层：接口调用在 @/api（powerApi），
 * 这里只做纯计算 —— 权限树过滤、索引构建、菜单形态判断。
 */

/**
 * 菜单是否可作为导航项：先排除按钮节点，再按当前环境取对应的开关。
 *
 * 后端每个菜单节点同时带 `Debug` / `Release` 两个标记，就是给「调试期」与
 * 「发布期」准备的两份清单：
 *   - 调试环境按 `Debug` —— 标了调试的菜单都能点进去，哪怕还没发布
 *   - 发布环境按 `Release` —— 只出现正式放出的菜单
 *
 * 当前处于哪个环境由 @/utils 的 APP_ENV 决定（默认 dev 走 debug、打包走 release）。
 */
export function isNavigableMenu(node: DesktopMenu): boolean {
  if (node.IsAction) return false;
  return pickByEnv({ debug: true, release: node.Release });
}

/** 将 View 路径按下划线拆分成层级，例如 V0005_V0010 -> ["V0005", "V0010"] */
export function splitViewPath(view: string): string[] {
  return view.split('_').filter(Boolean);
}

export interface PermissionIndex {
  /** 用户权限菜单中的 id 集合 */
  ids: Set<number>;
}

/** 把权限树拍平成 id 索引 */
export function buildPermissionIndex(nodes: UserMenu[]): PermissionIndex {
  const ids = new Set<number>();
  const walk = (list: UserMenu[]) => {
    list.forEach((node) => {
      ids.add(node.id);
      if (node.children) walk(node.children);
    });
  };
  walk(nodes);
  return {ids};
}

/** 菜单/按钮是否有权限：权限 id 命中 ViewID 即为有权限 */
function hasPermission(node: DesktopMenu, index: PermissionIndex): boolean {
  return index.ids.has(node.ViewID);
}

/** 单个按钮权限项 */
export interface MenuActionItem {
  /** 按钮 MenuCode，可直接用于 hasButton 判断 */
  menuCode: string;
  /** 按钮名，如 编辑 / 删除 */
  name: string;
  /** 按钮 View 路径，如 V0005_V0010_V0214 */
  view: string;
  viewId: number;
  /** 当前用户是否有权限 */
  allowed: boolean;
}

export interface MenuPermissionResult {
  /** 过滤后的可见菜单树 */
  tree: DesktopMenu[];
  /** 菜单 View -> 该菜单下的按钮权限列表 */
  actions: Map<string, MenuActionItem[]>;
}

/**
 * 用用户权限交集系统菜单树：权限 id 命中 ViewID 即为有权限。
 * - 菜单节点：有权限，或存在有权限的子菜单时保留
 * - 按钮节点：同样按 ViewID 命中判断，未命中则不授权
 */
export function applyMenuPermission(system: DesktopMenu[], index: PermissionIndex): MenuPermissionResult {
  const actions = new Map<string, MenuActionItem[]>();

  const filterNodes = (nodes: DesktopMenu[]): DesktopMenu[] => {
    const result: DesktopMenu[] = [];
    nodes.forEach((node) => {
      // 按钮节点不进入导航树；它们的权限在上面 actionChildren 处已单独判定
      if (node.IsAction) return;
      const permitted = hasPermission(node, index);
      const actionChildren = (node.Children ?? []).filter((child) => child.IsAction);
      if (actionChildren.length) {
        actions.set(
          node.View,
          actionChildren.map((child) => ({
            menuCode: child.MenuCode,
            name: child.MenuName,
            view: child.View,
            viewId: child.ViewID,
            allowed: hasPermission(child, index),
          })),
        );
      }
      const children = node.Children ? filterNodes(node.Children) : [];
      if (permitted || children.length > 0) {
        result.push({...node, Children: children.length ? children : null});
      }
    });
    return result;
  };

  return {tree: filterNodes(system), actions};
}
