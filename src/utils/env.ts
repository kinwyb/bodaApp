/**
 * 应用运行环境：区分「开发调试」与「正式发布」。
 *
 * 为什么不用 `import.meta.env.DEV`：那个只回答「这个包是不是 dev server 起的」，
 * 没法表达「我在开发机上想跑一遍正式环境的流程」。业务上真正要区分的是
 * **代码流程走哪一支**（比如菜单按 Debug 还是 Release 筛、要不要显示调试入口），
 * 所以这里给一个可显式覆盖的全局环境值：
 *
 *   - 默认按构建目标推导：`npm run dev` → debug，`npm run build` → release
 *   - 需要覆盖时在 .env 里写 `VITE_APP_ENV=release`（或 debug）
 *
 * 用法：
 *   import { APP_ENV, isDebugEnv, pickByEnv } from '@/utils';
 *
 *   if (isDebugEnv) { ... }                        // 只关心是不是调试环境
 *   return pickByEnv({ debug: a, release: b });    // 按环境取不同值
 */

/** 运行环境：debug = 开发调试，release = 正式发布 */
export type AppEnv = 'debug' | 'release';

function resolveAppEnv(): AppEnv {
  const configured = import.meta.env.VITE_APP_ENV;
  if (configured === 'debug' || configured === 'release') return configured;
  return import.meta.env.DEV ? 'debug' : 'release';
}

/**
 * 当前运行环境。模块加载时确定，之后不会变 ——
 * 所以引用它不用放在 effect / 依赖数组里。
 */
export const APP_ENV: AppEnv = resolveAppEnv();

/**
 * 是否是开发调试环境。
 * 刻意做成布尔常量而不是 `isDebugEnv()` 函数：调用点写 `if (isDebugEnv)` 更顺，
 * 且打包时能被静态折叠，正式产物里不会留下运行时判断。
 */
export const isDebugEnv: boolean = APP_ENV === 'debug';

/** 是否是正式发布环境 */
export const isReleaseEnv: boolean = APP_ENV === 'release';

/**
 * 按环境二选一，省掉调用点各写一遍三元表达式。
 *
 *   return pickByEnv({ debug: node.Debug, release: node.Release });
 *
 * 两个分支都求值（是普通函数参数，不是回调）—— 所以别把有副作用的表达式塞进来，
 * 那种场景请直接写 `if (isDebugEnv)`。
 */
export function pickByEnv<T>(options: { debug: T; release: T }): T {
  return isDebugEnv ? options.debug : options.release;
}
