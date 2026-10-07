import { createContext, useContext } from 'react';

/**
 * 标签页对外能力：由 MainLayout 注入，业务页面通过 useTabs() 取用。
 */
export interface TabsApi {
  /**
   * 按 View 打开（或激活）一个页面标签，效果等同于点击左侧菜单。
   *
   * @param view   菜单的 View 字段，如 'V0005_V0010_V0214'。
   *               菜单树里找不到时会退化成用 View 本身当标签名，页面组件仍按 registry 的规则解析。
   * @param params 传给目标页面的参数，页面组件从 props.params 取。
   *               用同一个 view 但 params 不同再次打开时，页面会被重新挂载（而非只更新 props），
   *               所以页面直接拿它当初始值即可，不需要写监听。
   */
  openView: (view: string, params?: Record<string, unknown>) => void;
}

export const TabsContext = createContext<TabsApi | null>(null);

/**
 * 在任意业务页面里做跨页面跳转：
 *
 *   const { openView } = useTabs();
 *   openView('V0005_V0010_V0214', { keyword: 'X001' });
 *
 * 为什么走 Context 而不是 react-router：本项目的多标签页是 MainLayout 自己用 state 管的
 * （openTabs / activeTab），路由只服务 /login，跳页面必须落到 MainLayout 的 openTab 上，
 * 所以直接把那个能力透出来，不绕路由。
 */
export function useTabs(): TabsApi {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error('useTabs 必须在 MainLayout 内部使用');
  }
  return ctx;
}
