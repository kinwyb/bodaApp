import { useEffect, useLayoutEffect, useRef } from 'react';
import { registerUIBridgeHost } from './store';
import type { UIBridgeHost } from './types';

/**
 * 把当前页面注册为界面桥宿主，agent 就能观察并操作它。
 *
 * 页面只负责「怎么描述自己」和「命令怎么执行」，校验、回执、rev 都在桥里。
 * 内部用 ref 持有最新的 host 对象：React 每次渲染都会重建闭包，
 * 桥通过 getter 读取，所以不必为了更新描述而反复注册。
 */
export function useUIBridgeHost(host: UIBridgeHost): void {
  const ref = useRef(host);

  /*
   * 每次渲染后用最新的 host 覆盖 ref：桥通过 getter 读它，拿到的永远是最新闭包。
   *
   * 用 layout effect 而不是 useEffect：它在 DOM 提交后、浏览器绘制前同步执行，
   * 所以操作完成后紧接着取的快照能读到刚提交的那一版状态，而不是上一版。
   */
  useLayoutEffect(() => {
    ref.current = host;
  });

  // 只注册一次。注册的是 getter 而不是宿主对象本身，所以宿主换了也不用重新注册
  useEffect(() => registerUIBridgeHost(() => ref.current), []);
}
