import { http } from '../request';

/** 系统整体菜单节点，对应 /menus 返回结构 */
export interface DesktopMenu {
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
  Children: DesktopMenu[] | null;
  UseOrgs: string;
}

/** 用户权限菜单节点，对应 /user/menus 返回结构 */
export interface UserMenu {
  id: number;
  label: string;
  ParentMenuID: number;
  ParentMenu: string;
  children: UserMenu[] | null;
  RequestAddress?: string;
  RequestMethod?: string;
  EnableLog?: boolean;
  Enable?: boolean;
  IsAction?: boolean;
  Release?: boolean;
}

/**
 * 权限域的接口封装。菜单树的过滤与权限计算等业务逻辑在 @/services（permission.ts），
 * 这里只负责请求与响应类型。
 */
export const powerApi = {
  /** 获取系统整体菜单树 */
  desktopMenu: () => http.get<DesktopMenu[]>('/power/desktopMenu'),
  /** 获取当前用户的权限菜单 */
  userMenus: () => http.get<UserMenu[]>('/power/user/menu'),
};
