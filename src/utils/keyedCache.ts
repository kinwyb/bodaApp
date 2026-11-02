/**
 * 「按 key 缓存一份异步取回来的值」的小工具：**同步读 + 请求去重 + 失败冷却 + 容量上限**。
 *
 * 用途：渲染路径上必须同步回答（例如 `canEditCell`），而数据只能问后端 ——
 * 于是先查内存缓存，没命中就异步取回来放进缓存，下次同步读。
 *
 * 为什么**必须有容量上限**：这种缓存是模块级的（生命周期跟着页面走，不跟某个组件走），
 * 没有上限就是「用户用得越多、条目越多」，一天下来能攒到几千条，绝大多数再也不会被读到。
 * 这里按 **LRU** 淘汰（`read` / `put` 命中的条目移到队尾），上限一满就丢最久没用的那条 ——
 * 丢掉的代价只是下次重新取一次，比单调涨内存划算得多。淘汰时**连失败记录一起删**，
 * 否则「查过但查不到的 key」会单独攒成一份只增不减的表。
 *
 * 三张表的语义：
 * - `read(key)` → 取到过就返回，`undefined` 表示**不知道**（调用方据此决定放行还是拦下）；
 * - `put(key, value)` → 直接登记一份现成的值（例如接口已经把这份数据一起返回了），不发请求；
 * - `ensure(key, hint?)` → 保证缓存里有：命中直接给、正在飞的请求复用、刚失败过的冷却期内给 `null`。
 *
 * `hint` 是给 `load` 的第二参数（目前用来传物料编码：有编码就按编码查，只有主键才按主键查）。
 * 注意请求去重只认 key —— 同一个 key 正在飞时，后来的 hint 会被忽略（先到先得）。
 */

export interface KeyedAsyncCacheOptions<V> {
    /**
     * 实际取数。返回 `null` 表示**这次没取到**（不当成「值为空」缓存下来）：
     * 调用方会吃一次冷却，过后再试。
     */
    load: (key: string, hint?: string) => Promise<V | null>;
    /** 最多存多少条，超出按最久没读过的淘汰。默认 500 */
    maxEntries?: number;
    /** 取数失败后多久内不再重试（毫秒）。默认 5000 */
    failCooldownMs?: number;
}

export interface KeyedAsyncCache<V> {
    /** 取到过就返回；**没取到过返回 `undefined`**（值本身可以是空数组） */
    read: (key: string) => V | undefined;
    /** 有没有取到过（不改变使用顺序） */
    has: (key: string) => boolean;
    /** 直接登记一份现成的值 */
    put: (key: string, value: V) => void;
    /** 保证缓存里有：命中返回、在飞复用、失败冷却返回 `null` */
    ensure: (key: string, hint?: string) => Promise<V | null>;
    /** 清空（含失败记录与在飞请求登记） */
    clear: () => void;
    /** 当前条目数（自测 / 排查用） */
    size: () => number;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_FAIL_COOLDOWN_MS = 5000;

export function createKeyedAsyncCache<V>({
                                            load,
                                            maxEntries = DEFAULT_MAX_ENTRIES,
                                            failCooldownMs = DEFAULT_FAIL_COOLDOWN_MS,
                                        }: KeyedAsyncCacheOptions<V>): KeyedAsyncCache<V> {
    const cache = new Map<string, V>();
    /** 正在飞的请求：同一 key 只发一次 */
    const pending = new Map<string, Promise<V | null>>();
    /** 失败时间：渲染路径会反复问，别把失败刷成请求风暴 */
    const failedAt = new Map<string, number>();

    /** 标记为「最近用过」：Map 保持插入序，删了重插就排到队尾 */
    const touch = (key: string): void => {
        const value = cache.get(key);
        if (value === undefined) return;
        cache.delete(key);
        cache.set(key, value);
    };

    /** 超出上限就丢最久没用的那条；失败记录一并清掉，免得单独攒成一份泄漏 */
    const trim = (): void => {
        while (cache.size > maxEntries) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) return;
            cache.delete(oldest);
            failedAt.delete(oldest);
        }
    };

    const read = (key: string): V | undefined => {
        const value = cache.get(key);
        if (value !== undefined) touch(key);
        return value;
    };

    const put = (key: string, value: V): void => {
        cache.delete(key);
        cache.set(key, value);
        failedAt.delete(key);
        trim();
    };

    const ensure = (key: string, hint?: string): Promise<V | null> => {
        const cached = read(key);
        if (cached !== undefined) return Promise.resolve(cached);
        const running = pending.get(key);
        if (running) return running;
        const failedTime = failedAt.get(key);
        if (failedTime !== undefined && Date.now() - failedTime < failCooldownMs) {
            return Promise.resolve(null);
        }
        const task = load(key, hint)
            .then((value) => {
                if (value === null) {
                    failedAt.set(key, Date.now());
                    return null;
                }
                put(key, value);
                return value;
            })
            .catch(() => {
                // 不往外抛：调用方多半在判定路径上，失败了只是这一格暂时用不了
                failedAt.set(key, Date.now());
                return null;
            })
            .finally(() => {
                pending.delete(key);
            });
        pending.set(key, task);
        return task;
    };

    return {
        read,
        has: (key) => cache.has(key),
        put,
        ensure,
        clear: () => {
            cache.clear();
            pending.clear();
            failedAt.clear();
        },
        size: () => cache.size,
    };
}
