import { useEffect, useLayoutEffect, useRef } from 'react';
import { isDebugEnv } from '@/utils';
import { bridgedViewPaths, isBridgedView } from './bridged';
import { registerDialogHost, registerPageHost, registerWorkbenchHost } from './store';
import type { UIBridgeHost, UIDialogHost, UIWorkbenchHost } from './types';

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
  useEffect(() => {
    /*
     * 开发期兜底：页面接了桥，但目录下没建 `bridged.ts`。
     *
     * 这种情况下功能全都在，唯独工作台的导航清单里看不到这一页 —— agent 不会自己撞上来，
     * 人也就不会发现漏了标记。宁可在控制台吵一句。
     */
    if (isDebugEnv && !isBridgedView(view)) {
      console.error(
        `[ui-bridge] ${view} 注册了界面桥，但它的页面目录下没有 bridged.ts，` +
          `因此不会出现在 agent 的可导航清单里。已接入的页面：${bridgedViewPaths().join(', ') || '（无）'}`,
      );
    }
    return registerPageHost(view, () => ref.current);
  }, [view]);
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

/**
 * 弹窗注册自己：**只在打开期间生效**，关闭后页面自己的动作表就回来。
 *
 * 弹窗的字段、动作、提交语义都留在弹窗自己的文件里，页面不必替它转述 ——
 * 否则一个页面上有五个弹窗，页面文件里就得写五份字段映射与处理函数。
 */
export function useUIBridgeDialog(view: string, host: UIDialogHost, open: boolean): void {
  const ref = useRef(host);

  useLayoutEffect(() => {
    ref.current = host;
  });

  useLayoutEffect(() => {
    if (!open) return;
    // 后注册者生效：同时只该有一个弹窗打开，所以「后」就是「最上面那个」
    return registerDialogHost(view, () => ref.current);
  }, [view, open]);
}
