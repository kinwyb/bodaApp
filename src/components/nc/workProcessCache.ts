/**
 * 基本工序档案（`GET /nc/workProcess`）的**全量缓存**。
 *
 * 为什么需要它：工序**没有**「按编码 / 名称查一条」的接口，只有全量列表。于是
 * 「用户在格子里敲编码回车」这件事只能在本地的全量列表里筛 —— 每敲一次就拉一遍列表，
 * 几百条档案、来回改单会打很多次请求。
 *
 * 四个读口：
 * - `readWorkProcesses`：取到过就返回；**没取到过是 `undefined`**（调用方据此提示「正在加载」，
 *   而不是把「还没取回来」当成「没有这个工序」）；
 * - `ensureWorkProcesses`：拿到全量（已在飞的复用同一趟请求，失败后冷却几秒再试）；
 * - `loadWorkProcesses`：**强制**拉一次（弹窗用：要最新的档案，失败要抛出去）；
 * - `putWorkProcesses`：拿到现成列表时直接登记（弹窗 / 别处取回来的那份）。
 *
 * 为什么不做成按编码索引的 `keyedCache`：筛选是「包含匹配 + 用户可能只记得半个字」，
 * 必须拿到整份列表；列表本身只有几百条，全量放内存比维护索引更直接。
 */

import {ncBaseApi} from '@/api/modules/nc/base.ts';
import type {NCWorkProcess} from '@/api/schemas/nc/NCBase.ts';

/** 全量列表；`null` = 还没取过 */
let cache: NCWorkProcess[] | null = null;

/** 在飞的请求：连续回车 / 弹窗与格子同时要数据时只发一趟 */
let inflight: Promise<NCWorkProcess[]> | null = null;

/** 上次失败的时刻与冷却时长：接口挂了时，连续回车不该每次都打一遍 */
let failedAt = 0;
const FAIL_COOLDOWN_MS = 3000;

/** 取到过就返回；没取到过返回 `undefined` */
export function readWorkProcesses(): NCWorkProcess[] | undefined {
    return cache ?? undefined;
}

/**
 * 直接登记一份现成的列表 —— 弹窗（`QuickSelectView`）取回来时顺手写进来，
 * 之后同一个页面里「格子里输入回车」就能同步筛，不必再等一趟请求。
 */
export function putWorkProcesses(list: NCWorkProcess[] | null | undefined): void {
    cache = list ?? [];
}

/**
 * **强制**拉一次全量并登记（弹窗用它：档案随时可能被维护，打开时拿最新的）。
 *
 * 与 `ensureWorkProcesses` 的分工：那个给「格子里输入回车」用（命中缓存就够、失败不报错），
 * 这个给弹窗用（失败要抛出去，让列表说出「加载失败」而不是显示「暂无档案」——
 * 两者在界面上是完全不同的两件事）。
 */
export async function loadWorkProcesses(): Promise<NCWorkProcess[]> {
    const result = await ncBaseApi.workProcess();
    const list = result.data ?? [];
    cache = list;
    return list;
}

/**
 * 确保拿到全量工序列表（缓存优先）。
 *
 * 失败时**返回空数组**而不是抛错：调用方要做的是「提示没取到、让用户走弹窗」，
 * 让每个调用点各写一遍 try/catch 只会得到几个措辞不一样的提示。
 */
export function ensureWorkProcesses(): Promise<NCWorkProcess[]> {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    if (Date.now() - failedAt < FAIL_COOLDOWN_MS) return Promise.resolve(cache ?? []);

    inflight = ncBaseApi.workProcess()
        .then((result) => {
            const list = result.data ?? [];
            cache = list;
            return list;
        })
        .catch(() => {
            failedAt = Date.now();
            return [] as NCWorkProcess[];
        })
        .finally(() => {
            inflight = null;
        });

    return inflight;
}

/** 工序编码 / 名称的展示文本见 `./workProcess.ts` 的 `workProcessLabel` —— 这里只管缓存 */

