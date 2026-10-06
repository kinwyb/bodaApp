import React, { useMemo } from 'react';
import { Button } from 'antd';
import { usePermission } from '@/store/permission';
import { AuthButton } from './Permission';

export interface CommandItem {
  key: string;
  /** 按钮文字 */
  label: string;
  /** 按钮图标，建议 18px 左右的线性图标 */
  icon: React.ReactNode;
  /**
   * 该命令在系统菜单里声明的按钮名（如 新增 / 编辑 / 删除）。
   * 填了就按权限显隐，未声明则整个按钮不渲染。
   */
  permission?: string;
  /** 直接指定按钮 MenuCode，优先级高于 permission */
  menuCode?: string;
  danger?: boolean;
  disabled?: boolean;
  /** 是否在该按钮前插入竖分割线 */
  dividerBefore?: boolean;
  onClick?: () => void;
}

export interface CommandBarProps {
  /** 当前页面 View，用于解析按钮权限；不传则不过滤权限 */
  view?: string;
  items: CommandItem[];
  className?: string;
}

/**
 * 桌面端风格的命令条：图标在上、文字在下，图标加大，支持权限过滤。
 *
 * <CommandBar view={view} items={[
 *   { key: 'add', label: '新增', icon: <PlusOutlined />, permission: '新增', onClick },
 * ]} />
 */
export const CommandBar: React.FC<CommandBarProps> = ({ view, items, className }) => {
  const { actions } = usePermission();
  const actionItems = useMemo(() => (view ? actions.get(view) ?? [] : []), [actions, view]);

  const rendered = items.flatMap((item) => {
    const action = item.permission
      ? actionItems.find((entry) => entry.name === item.permission)
      : undefined;
    // 声明了权限名但菜单里没有对应按钮 → 视为无权限，整个按钮不渲染
    if (item.permission && !action && !item.menuCode) return [];

    const menuCode = item.menuCode ?? action?.menuCode;
    const parts: React.ReactNode[] = [];
    if (item.dividerBefore) {
      parts.push(<span key={`${item.key}-divider`} className="command-bar-divider" />);
    }
    const common = {
      className: 'command-item',
      icon: item.icon,
      danger: item.danger,
      disabled: item.disabled,
      onClick: item.onClick,
    };
    parts.push(
      menuCode ? (
        <AuthButton key={item.key} menuCode={menuCode} {...common}>
          {item.label}
        </AuthButton>
      ) : (
        <Button key={item.key} type="text" {...common}>
          {item.label}
        </Button>
      ),
    );
    return parts;
  });

  return <div className={className ? `command-bar ${className}` : 'command-bar'}>{rendered}</div>;
};
