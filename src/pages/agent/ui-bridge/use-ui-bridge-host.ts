import { useEffect, useLayoutEffect, useRef } from 'react';
import { registerPageHost, registerWorkbenchHost } from './store';
import type { UIBridgeHost, UIWorkbenchHost } from './types';

/**
 * 业务页面注册自己：agent 就能观察并操作这一页。
 *
 * 页面只负责「怎么描述自己」和「命令怎么执行」，校验、回执、rev 都在桥里。
 * 内部用 ref 持有最新的 host 对象：React 每次渲染都会重建闭包，桥通过 getter 读取，
 * 所以不必为了更新描述而反复注册。
 */
export function useUIBridgeHost(view: string, host: UIBridgeHost): void {
  const ref = useRef(host);

  /*
   * 每次渲染后用最新的 host 覆盖 ref。
   *
   * 用 layout effect 而不是 useEffect：它在 DOM 提交后、浏览器绘制前同步执行，
   * 所以操作完成后紧接着取的快照能读到刚提交的那一版状态，而不是上一版。
   */
  useLayoutEffect(() => {
    ref.current = host;
  });

  // 注册的是 getter 而不是宿主对象本身，所以宿主换了也不用重新注册
  useEffect(() => registerPageHost(view, () => ref.current), [view]);
}

/**
 * 工作台注册全局能力，挂在 MainLayout 上。
 *
 * 它回答的是「你在哪、能去哪」：用户停在主页、没进任何业务页面时，agent 靠它才知道
 * 有哪些页面可以打开。页面级宿主只回答「这一页怎么操作」。
 */
export function useWorkbenchBridge(host: UIWorkbenchHost): void {
  const ref = useRef(host);

  useLayoutEffect(() => {
    ref.current = host;
  });

  useEffect(() => registerWorkbenchHost(() => ref.current), []);
}
