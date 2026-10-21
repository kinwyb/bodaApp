import { stableStringify } from '@/utils';

/**
 * 页签标识（tab key）的计算规则。
 *
 * 一个 View 可以开**多个页签**（比如同时看几张预订单），靠的就是这里：
 * 页签 key = `view` + `::` + 实例标识，实例标识决定「算同一个页签还是新页签」。
 *
 * 三条规则（与业务约定一致）：
 *
 * 1. **从左侧菜单进来** → 实例标识为空 → key 就是 view 本身。
 *    菜单永远只对应一个页签：已经开着了就只激活，不重开。
 * 2. **代码 `openView(view, params)`** → 实例标识 = params 的稳定指纹。
 *    参数一样 → 同一个页签（只激活）；参数不一样 → 各开一个页签。
 * 3. **业务自己指定**（`openView(view, params, { tabKey })`）→ 实例标识 = 业务传的 key。
 *    相同 key 视为同一页，不同 key 视为不同页 —— 判断参数麻烦时用这个。
 *
 * 指纹用「键排序后的序列化」而不是 `JSON.stringify`：
 * 前者对 `{a:1,b:2}` 与 `{b:2,a:1}` 给出同样的结果（参数一样就该是同一个页签），
 * 后者会按插入顺序拼，两个页签就白开了。
 */

/** params 的实例指纹；没有参数（或空对象）时返回空串 —— 即「菜单进来的那个页签」 */
export function instanceOfParams(params?: Record<string, unknown>): string {
  if (!params) return '';
  if (Object.keys(params).length === 0) return '';
  return stableStringify(params);
}

/** 页签唯一 key：实例标识为空时就是 view 本身 */
export function buildTabKey(view: string, instance: string): string {
  return instance ? `${view}::${instance}` : view;
}

/**
 * 两份 params 是否「一样」（按值比较，不是按引用）。
 *
 * 按引用比较会把「同一个意思、重新 new 出来的对象」当成变了 —— 页签会被误判成要重建。
 */
export function sameParams(
  a?: Record<string, unknown>,
  b?: Record<string, unknown>,
): boolean {
  return stableStringify(a ?? null) === stableStringify(b ?? null);
}
