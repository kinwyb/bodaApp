/**
 * 物料 → 「这个物料能用哪些辅助属性项」（`vfree1` / `vfree4` / …）的**同步缓存**。
 *
 * 为什么需要它：`canEditCell` 必须同步返回 boolean（返回 Promise 会被当成 truthy，
 * 等于全部放行），而这份数据只能问后端（`/nc/material/queryUseVFree`）。
 * 原来是在 `onSelectedChange` 里现取现写进行对象，但**选中和双击是同一个动作** ——
 * 请求还没回来，`canEditCell` 就已经被问完了，于是第一次双击永远被拦下
 * （日志里先两条 `canuse:undefined`，再双击才有值）。
 *
 * 现在改成「按物料预取 + 内存缓存」：
 * - 行数据 / 物料一变就 `primeUseVFrees` 预热，双击时基本必然命中；
 * - `canEditCell` 只查 Map（同步、O(1)），**不读行对象**（行会被重新派生、也会被
 *   `useEditableRows` 换掉，挂在上面的东西说没就没）；
 * - 万一没命中，`ensureUseVFrees` 顺手补一次（去重 + 失败冷却），下次双击即可编辑。
 *
 * 缓存值统一转小写，与列字段的比对口径（`field.toLowerCase().replace('name','')`）一致。
 */
import {ncMaterialApi} from '@/api/modules/nc/material.ts';

/** 取到过的结果（可能为空数组：这个物料哪个辅助属性都不能用） */
const cache = new Map<string, string[]>();
/** 正在飞的请求：同一物料只发一次 */
const pending = new Map<string, Promise<string[] | null>>();
/** 失败时间：渲染路径会反复问，别把失败刷成请求风暴 */
const failedAt = new Map<string, number>();
const FAIL_COOLDOWN_MS = 5000;
/** 批量预热时的并发上限（一张矩阵可能几十行，逐行同时发太脏） */
const BATCH_SIZE = 4;

/** 取到过就返回数组；**没取到过返回 `undefined`**（调用方据此决定拦下还是放行） */
export function readUseVFrees(materialVID: string): string[] | undefined {
    return cache.get(materialVID);
}

/**
 * 确保缓存里有这个物料的结果。
 *
 * 命中缓存 / 已在飞的请求 / 刚失败过（冷却期内）都会立即返回，
 * **不会**因为判定函数被重复调用而重复发请求。
 */
export function ensureUseVFrees(materialVID: string): Promise<string[] | null> {
    const id = materialVID.trim();
    if (!id) return Promise.resolve(null);
    const cached = cache.get(id);
    if (cached) return Promise.resolve(cached);
    const running = pending.get(id);
    if (running) return running;
    const failedTime = failedAt.get(id);
    if (failedTime !== undefined && Date.now() - failedTime < FAIL_COOLDOWN_MS) {
        return Promise.resolve(null);
    }
    const task = fetchUseVFrees(id).finally(() => {
        pending.delete(id);
    });
    pending.set(id, task);
    return task;
}

/**
 * 批量预热：给一批行（或一批物料 VID）里还没取过的那些发请求。
 *
 * 走「分批 + 批内并发」，批与批之间串行 —— 行数再多也只有 4 个请求同时在飞。
 * 失败不抛：缓存里没有就是「不知道」，判定会保守拦下，冷却过后再试。
 */
export function primeUseVFrees(materialVIDs: Iterable<string>): void {
    const todo: string[] = [];
    const seen = new Set<string>();
    for (const raw of materialVIDs) {
        const id = String(raw ?? '').trim();
        if (!id || seen.has(id) || cache.has(id) || pending.has(id)) continue;
        const failedTime = failedAt.get(id);
        if (failedTime !== undefined && Date.now() - failedTime < FAIL_COOLDOWN_MS) continue;
        seen.add(id);
        todo.push(id);
    }
    if (todo.length === 0) return;
    void (async () => {
        for (let i = 0; i < todo.length; i += BATCH_SIZE) {
            await Promise.all(todo.slice(i, i + BATCH_SIZE).map((id) => ensureUseVFrees(id)));
        }
    })();
}

async function fetchUseVFrees(materialVID: string): Promise<string[] | null> {
    try {
        const result = await ncMaterialApi.useVFree(materialVID);
        const list = (result.data ?? []).map((item) => String(item).toLowerCase());
        cache.set(materialVID, list);
        failedAt.delete(materialVID);
        return list;
    } catch {
        // 不弹提示：这是判定用的旁路数据，失败了只是这一格改不了
        failedAt.set(materialVID, Date.now());
        return null;
    }
}
