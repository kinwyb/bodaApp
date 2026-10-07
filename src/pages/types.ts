import type React from 'react';

/** 从根到当前菜单的层级，用于面包屑 */
export interface ViewTrailItem {
  /** 菜单的 View 路径，如 V0005_V0010 */
  view: string;
  /** 菜单名 */
  name: string;
}

/** 所有业务页面的统一入参 */
export interface ViewPageProps {
  /** 当前页面路径，即菜单的 View 字段，如 V0005_V0010 */
  view: string;
  /** 菜单层级 */
  trail: ViewTrailItem[];
  /**
   * 跳转进来时携带的参数，来源见 `useTabs().openView(view, params)`。
   * 用同一个 View 但参数不同再次打开时，页面组件会被重新挂载（而不是只更新 props），
   * 所以页面直接拿它做初始值即可，不用写监听。
   */
  params?: Record<string, unknown>;
}

/** 业务页面组件类型 */
export type ViewComponent = React.ComponentType<ViewPageProps>;
