import { http } from '../request';

/** 系统整体菜单节点，对应 /menus 返回结构 */
export interface MenuNode {
  MenuCode: string;
  ParentMenuCode: string;
  MenuID: number;
  /** 页面路径，按 "_" 分割成层级，例如 V0005_V0010_V0214 */
  View: string;
  ViewID: number;
  MenuName: string;
  Debug: boolean;
  Release: boolean;
  SortIndex: number;
  /** true 表示按钮权限（新增/保存/删除等），不作为导航菜单 */
  IsAction: boolean;
  Children: MenuNode[] | null;
  UseOrgs: string;
}

/** 用户权限菜单节点，对应 /user/menus 返回结构 */
export interface UserMenuPermission {
  id: number;
  label: string;
  ParentMenuID: number;
  ParentMenu: string;
  children: UserMenuPermission[] | null;
  RequestAddress?: string;
  RequestMethod?: string;
  EnableLog?: boolean;
  Enable?: boolean;
  IsAction?: boolean;
}

/** 菜单是否可作为导航项 */
export function isNavigableMenu(node: MenuNode): boolean {
  return !node.IsAction;
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
export function buildPermissionIndex(nodes: UserMenuPermission[]): PermissionIndex {
  const ids = new Set<number>();
  const walk = (list: UserMenuPermission[]) => {
    list.forEach((node) => {
      ids.add(node.id);
      if (node.children) walk(node.children);
    });
  };
  walk(nodes);
  return { ids };
}

/** 菜单/按钮是否有权限：权限 id 命中 ViewID 即为有权限 */
function hasPermission(node: MenuNode, index: PermissionIndex): boolean {
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
  tree: MenuNode[];
  /** 菜单 View -> 该菜单下的按钮权限列表 */
  actions: Map<string, MenuActionItem[]>;
}

/**
 * 用用户权限交集系统菜单树：权限 id 命中 ViewID 即为有权限。
 * - 菜单节点：有权限，或存在有权限的子菜单时保留
 * - 按钮节点：同样按 ViewID 命中判断，未命中则不授权
 */
export function applyMenuPermission(system: MenuNode[], index: PermissionIndex): MenuPermissionResult {
  const actions = new Map<string, MenuActionItem[]>();

  const filterNodes = (nodes: MenuNode[]): MenuNode[] => {
    const result: MenuNode[] = [];
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
        result.push({ ...node, Children: children.length ? children : null });
      }
    });
    return result;
  };

  return { tree: filterNodes(system), actions };
}

export const menuService = {
  /** 获取系统整体菜单树 */
  tree: () => http.get<MenuNode[]>('/menus'),
  /** 获取当前用户的权限菜单 */
  userMenus: () => http.get<UserMenuPermission[]>('/user/menus'),
};
