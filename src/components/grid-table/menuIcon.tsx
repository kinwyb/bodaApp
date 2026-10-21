import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GridTableMenuItem } from './menu';

/** GridTable 菜单图标（`MenuListItem.icon` 的形态） */
export interface MenuIcon {
  width?: number;
  height?: number;
  svg: string;
}

/**
 * GridTable 菜单图标：`MenuListItem.icon` 要的是**字符串**，而 antd 图标是 React 组件，
 * 中间差一次「渲染成 HTML 字符串」—— 就是这里做的事。
 *
 * ```tsx
 * import { DeleteOutlined } from '@ant-design/icons';
 * import { toMenuIcon } from '@/components/grid-table/menuIcon';
 *
 * const MENU_ICON_DELETE = toMenuIcon(<DeleteOutlined />);
 * // 菜单项：{ text: '删除行', menuKey: 'deleteRow', icon: MENU_ICON_DELETE }
 * ```
 *
 * 在**模块级**定义常量时调用一次即可，不在渲染路径上。
 *
 * 尺寸与颜色都不用管：antd 图标自带 `width="1em" height="1em"`（跟随菜单项字号）
 * 与 `fill="currentColor"`（跟随文字色，鼠标高亮菜单项时会一起变）。
 * 想单独调大小就给图标传 style：`toMenuIcon(<DeleteOutlined style={{fontSize: 18}} />)`。
 *
 * ⚠️ 产出里会带一层 antd 自己的 `<span class="anticon">`（@visactor/vtable 把它塞进菜单项的
 * 图标容器里，显示不受影响），所以 **`icon.width` / `icon.height` 不生效** ——
 * @visactor/vtable 是把这两个值写到图标容器的第一个子元素上，而第一个子元素是那个 span、
 * 不是 svg。要改尺寸请用上面的 style 写法。
 */
export function toMenuIcon(icon: ReactElement): MenuIcon {
  return { svg: renderToStaticMarkup(icon) };
}

/**
 * 空白占位图标：尺寸与 antd 图标一致（1em），但没有内容，完全透明。
 *
 * 用途是**对齐**：@visactor/vtable 把图标单独占一列，同一份菜单里若有的项有图标、有的没有，
 * 没图标的项文字就会顶到最左边，看起来错位。给这些项补上这个占位即可。
 * 一般不用手写，交给 `alignMenuIcons` 自动补。
 */
export const BLANK_MENU_ICON: MenuIcon = {
  svg: '<svg width="1em" height="1em" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"></svg>',
};

/**
 * 给菜单里「没有图标」的项补上空白占位，让同一份菜单的文字左右对齐。
 *
 * ```ts
 * contextMenuItems: ({ rowKey }) => alignMenuIcons([
 *     { text: '新增行', menuKey: 'appendRow' },
 *     { text: '删除行', menuKey: 'deleteRow', icon: MENU_ICON_DELETE },
 * ]);
 * // 「新增行」会自动补上 BLANK_MENU_ICON，与「删除行」的文字对齐
 * ```
 *
 * 几个刻意的行为：
 * - **整份菜单一个图标都没有时原样返回** —— 没有图标可对齐，补上去反而多一层空 DOM；
 * - 字符串菜单项会被转成对象（字符串项没法挂 icon），文本与 menuKey 都等于该字符串；
 * - `{type:'split'}` 分隔线与 `{type:'title'}` 分组标题不参与（它们本来就不显示图标）。
 *
 * 注意它只处理**一层**：有 `children` 的子菜单要另外传进去处理。
 */
export function alignMenuIcons(items: GridTableMenuItem[]): GridTableMenuItem[] {
  const hasIcon = items.some(
    (item) => typeof item === 'object' && Boolean(item.icon?.svg),
  );
  // 全都没图标，本来就是对不齐的那一侧，不必多此一举
  if (!hasIcon) return items;
  return items.map((item) => {
    if (typeof item === 'string') return { text: item, menuKey: item, icon: BLANK_MENU_ICON };
    if (item.type === 'split' || item.type === 'title') return item;
    return item.icon?.svg ? item : { ...item, icon: BLANK_MENU_ICON };
  });
}

