/**
 * 「哪些页面接入了界面桥」的判定。
 *
 * 事实来源是**文件存在**：页面目录下有没有 `bridged.ts`。
 *
 * 为什么是这个方案（另外两条都试过，都不成立）：
 * - **运行时探测行不通**：页面级宿主挂载即注册、卸载即注销（见 store.ts），
 *   而导航清单恰恰是在「还没进目标页」时求值的 —— 那时目标页根本没注册，探测不到。
 * - **会话内累计行不通**：只能记住「本次打开过的页面」，重启就没了，
 *   且页面取消接入后旧记录会一直留着。
 * - **手工清单行不通**：接了桥还得记得登记，漏一次就是「页面明明能用、模型却看不见」的静默故障。
 * 文件存在是唯一既静态、又和代码同生共死的信号。
 *
 * 取 glob 的 key 就够（不 eager、不 import）：eager 会把每个 `bridged.ts` 及其依赖
 * 打进主包，页面分包就白拆了；`?raw` 则是把源码字符串塞进产物，更糟。
 */

import { resolveViewPath } from '@/pages/registry';

/** 只取 key：这里要的是「文件在不在」，不是它的内容 */
const BRIDGE_MARKERS = import.meta.glob('../../views/**/bridged.ts');

/**
 * glob key -> View 前缀。
 *
 * `../../views/V0189/V0279/V0280/bridged.ts` -> `V0189_V0279_V0280`，
 * 与 registry.ts 的 `viewFromPath` 是同一条规则（目录层级拼 View）。
 */
function toViewPrefix(path: string): string {
  return path
    .replace(/^.*\/views\//, '')
    .replace(/\/bridged\.ts$/, '')
    .split('/')
    .join('_');
}

/** 已接入界面桥的页面路径（目录拼成的 View 前缀） */
const BRIDGED_PREFIXES = new Set(Object.keys(BRIDGE_MARKERS).map(toViewPrefix));

/**
 * 这个 view 实际解析到的页面，是否声明了接入界面桥。
 *
 * 判的是「**解析到的那个目录**有没有标记」，不是「任意祖先目录有标记」：
 * resolveView 会逐级向上取祖先，若父目录也建了 `bridged.ts`，
 * 子目录自己没接桥也会被算成已接入 —— 那就把「只能打开、不能操作」的页面放回导航里了。
 */
export function isBridgedView(view: string): boolean {
  const path = resolveViewPath(view);
  return path !== null && BRIDGED_PREFIXES.has(path);
}

/** 已接入的页面路径清单（调试与开发期断言用） */
export function bridgedViewPaths(): string[] {
  return [...BRIDGED_PREFIXES].sort();
}
