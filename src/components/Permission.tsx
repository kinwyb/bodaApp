import React from 'react';
import { Button } from 'antd';
import type { ButtonProps } from 'antd';
import { usePermission } from '../store/permission-context';

export interface PermissionProps {
  /** 按钮的 MenuCode */
  menuCode?: string;
  /** 菜单/按钮的 View 路径 */
  view?: string;
  /** 无权限时展示的内容，默认什么都不渲染 */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 声明式权限包裹：在需要控制的元素外面套一层即可，
 * 无权限时整个子树不渲染。
 *
 * <Permission menuCode="AA8141B0-..."><Button>新增</Button></Permission>
 */
export const Permission: React.FC<PermissionProps> = ({
  menuCode,
  view,
  fallback = null,
  children,
}) => {
  const { hasButton, hasMenu } = usePermission();
  const allowed = menuCode ? hasButton(menuCode) : view ? hasMenu(view) : true;
  return <>{allowed ? children : fallback}</>;
};

export type AuthButtonProps = ButtonProps & {
  /** 按钮的 MenuCode，命中权限才渲染 */
  menuCode?: string;
  /** 按钮的 View 路径，命中权限才渲染 */
  view?: string;
};

/**
 * 自带权限判断的按钮，用法与 antd Button 完全一致，只多一个 menuCode。
 *
 * <AuthButton menuCode="AA8141B0-...">新增</AuthButton>
 */
export const AuthButton: React.FC<AuthButtonProps> = ({ menuCode, view, ...rest }) => {
  const { hasButton, hasMenu } = usePermission();
  const allowed = menuCode ? hasButton(menuCode) : view ? hasMenu(view) : true;
  if (!allowed) return null;
  return <Button {...rest} />;
};
