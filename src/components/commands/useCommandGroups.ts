import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import {isDebugEnv} from '@/utils';
import type {CommandFactory} from './types';

/** 一组命令：这些工厂共用同一个 context（页面可以为不同组装配不同的 context） */
export interface CommandGroup<TContext> {
    context: TContext;
    factories: CommandFactory<TContext>[];
}

/**
 * 按 order 表给命令排序。
 *
 * - 表里有的按表里的下标排；
 * - 表里没有的（`Number.MAX_SAFE_INTEGER`）不会消失，保持彼此原有的相对顺序排到最后；
 * - 相等时比原下标 ⇒ **稳定排序**，同一份定义每次渲染出的顺序都一样。
 *
 * 抽成纯函数是为了能直接测：hook 那层只负责收集与缓存。
 */
export function sortCommandsByOrder(
    items: CommandItem[],
    order?: readonly string[],
): CommandItem[] {
    if (!order || order.length === 0) return items;
    const rank = new Map(order.map((key, index) => [key, index]));
    return items
        .map((item, index) => ({item, index}))
        .sort((a, b) => {
            const rankA = rank.get(a.item.key) ?? Number.MAX_SAFE_INTEGER;
            const rankB = rank.get(b.item.key) ?? Number.MAX_SAFE_INTEGER;
            return rankA === rankB ? a.index - b.index : rankA - rankB;
        })
        .map((entry) => entry.item);
}

/**
 * 按「分组」组装命令条：每组命令喂自己的 context，最后拼成一列。
 *
 * 什么时候需要用分组而不是 useCommands：某几个命令需要**别的命令不需要的依赖**时，
 * 别把依赖塞进公共 context 让所有命令都看见 —— 单独装配一份 context 给那一组。
 *
 * 顺序怎么定（分组与顺序是正交的两件事）：
 * - 组内保持 factories 的数组顺序；
 * - 组与组之间由 options.order 的 key 顺序统一裁决。不显式声明顺序，就只能靠
 *   「为了把某个按钮插到中间而硬拆一组」来凑 —— 所以顺序单独写一张表，加/挪按钮只改表。
 *   order 里没列到的 key 会排到末尾，开发环境 warn 提醒补表（不会静默丢按钮）。
 *
 * 两个硬要求：
 * - **groups 与每个 context 都要 useMemo** —— 否则每次渲染都是新引用，下面这个 useMemo 全失效；
 * - 这里不能改成「对每组调一次 useCommands」：hooks 不能出现在循环里，整组一次算完。
 */
export function useCommandGroups<TContext extends object>(
    groups: CommandGroup<TContext>[],
    options?: {order?: readonly string[]},
): CommandItem[] {
    const order = options?.order;
    return useMemo(() => {
        const items = groups.flatMap(({context, factories}) =>
            factories.flatMap((factory) => {
                const created = factory(context);
                return Array.isArray(created) ? created : [created];
            }),
        );
        const sorted = sortCommandsByOrder(items, order);
        if (isDebugEnv) {
            const keys = sorted.map((item) => item.key);
            const duplicate = keys.filter((key, index) => keys.indexOf(key) !== index);
            if (duplicate.length > 0) {
                console.warn('[commands] 命令 key 重复，React key 会冲突：', duplicate);
            }
            if (order && order.length > 0) {
                const rank = new Map(order.map((key, index) => [key, index]));
                const missing = keys.filter((key) => !rank.has(key));
                if (missing.length > 0) {
                    console.warn('[commands] 这些命令没写进 order 表，会排在末尾：', missing);
                }
            }
        }
        return sorted;
    }, [groups, order]);
}
