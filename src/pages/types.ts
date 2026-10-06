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
}

/** 业务页面组件类型 */
export type ViewComponent = React.ComponentType<ViewPageProps>;
