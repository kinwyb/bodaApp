import { createContext, useContext } from 'react';

/**
 * 打开页签时的可选参数。
 */
export interface OpenViewOptions {
  /**
   * 业务自定义的页签区分键。
   *
   * 默认按 `params` 的指纹区分（参数一样 → 同一个页签；参数不一样 → 各开一个）。
   * 当「判断参数」不方便时（比如参数里塞了时间戳、随机数），
   * 业务可以自己传一个稳定的 key：**相同 key 视为同一页，不同 key 视为不同页**。
   */
  tabKey?: string;
  /**
   * 页签标题。不传则用菜单名。
   *
   * 页面拿到数据后还能自己改（见 `useTabTitle`）—— 这里的值只是「打开时的初始标题」，
   * 页面若随后改了标题，以页面改的为准。
   */
  title?: string;
}

/**
 * 标签页对外能力：由 MainLayout 注入，业务页面通过 useTabs() 取用。
 */
export interface TabsApi {
  /**
   * 按 View 打开（或激活）一个页面标签，效果等同于点击左侧菜单。
   *
   * @param view    菜单的 View 字段，如 'V0005_V0010_V0214'。
   *                菜单树里找不到时会退化成用 View 本身当标签名，页面组件仍按 registry 的规则解析。
   * @param params  传给目标页面的参数，页面组件从 props.params 取。
   *                **参数一样 → 同一个页签**（只激活，不重建页面）；
   *                **参数不一样 → 各开一个页签**，可以同时看几张单子。
   * @param options 可选：自定义页签区分键与初始标题。
   */
  openView: (
    view: string,
    params?: Record<string, unknown>,
    options?: OpenViewOptions,
  ) => void;
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
