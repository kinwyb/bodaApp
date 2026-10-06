import React from 'react';
import { Breadcrumb } from 'antd';
import type { ViewTrailItem } from '@/pages/types';

export interface PageBreadcrumbProps {
  /** 从根到当前菜单的层级 */
  trail?: ViewTrailItem[];
  className?: string;
}

/**
 * 页面面包屑：独立控件，由页面自行决定是否渲染与位置。
 *
 * <PageBreadcrumb trail={trail} />
 */
export const PageBreadcrumb: React.FC<PageBreadcrumbProps> = ({ trail, className }) => {
  if (!trail || trail.length === 0) return null;
  return (
    <Breadcrumb
      className={className ? `page-breadcrumb ${className}` : 'page-breadcrumb'}
      style={{ marginBottom: 12 }}
      items={trail.map((item) => ({ title: item.name }))}
    />
  );
};
