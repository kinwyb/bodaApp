import { createContext, useContext, useEffect } from 'react';

/**
 * 页签标题作用域：页面用它改「自己所在页签」的标题。
 *
 * 为什么需要它：页签标题现在是运行时可变的（订单详情页要显示订单号），
 * 而标题存在 MainLayout 的 state 里 —— 页面得有个渠道把「我要显示成什么」告诉外面。
 * 每个页签渲染时套一层 Provider，页面拿到的就是**自己那个页签**的作用域，
 * 不会串到别的页签上。
 *
 * ⚠️ 本模块**只导出非组件**（context + hook），所以 Vite 不会给它注入刷新边界，
 * 改这里不会引发 "Could not Fast Refresh" 警告。
 */
export interface TabTitleScope {
  /** 当前页签的唯一 key（与 MainLayout 内部一致） */
  tabKey: string;
  /** 页签的默认标题（菜单名）—— 页面拼标题时用得上，不用自己知道菜单叫什么 */
  baseLabel: string;
  /**
   * 设置当前页签的标题。
   *
   * - 传字符串 → 页签文字与窗口标题都变成它；
   * - 传 `undefined` → 恢复成菜单名（页面数据没了、筛选清空了，就用它还原）。
   */
  setTitle: (title: string | undefined) => void;
}

export const TabTitleContext = createContext<TabTitleScope | null>(null);

/**
 * 在页面里取「设置自己页签标题」的能力。
 *
 *   const { setTitle, baseLabel } = useTabTitle();
 *   useEffect(() => {
 *     setTitle(orderCode ? `${baseLabel} · ${orderCode}` : undefined);
 *   }, [orderCode]);
 */
export function useTabTitle(): TabTitleScope {
  const ctx = useContext(TabTitleContext);
  if (!ctx) {
    throw new Error('useTabTitle 必须在页签内容内使用');
  }
  return ctx;
}

/**
 * 按数据内容设置页签标题（数据变了标题就跟着变）。
 *
 *   const { baseLabel } = useTabTitle();
 *   usePageTitle(orderCode ? `${baseLabel} · ${orderCode}` : undefined);
 *
 * 传 `undefined` → 恢复成菜单名。
 */
export function usePageTitle(title: string | undefined): void {
  const { setTitle } = useTabTitle();
  useEffect(() => {
    setTitle(title);
  }, [setTitle, title]);
}

