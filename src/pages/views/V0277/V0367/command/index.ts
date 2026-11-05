import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import {useCommandGroups} from '@/components/commands';
import {addCommand} from './add';
import {copyCommand} from './copy';
import {deleteCommand} from './delete';
import {editCommand} from './edit';
import {publishCommand} from './publish';
import {refreshCommand} from './refresh';
import type {ProcessRouteMatrixCommandContext, ProcessRouteMatrixCommandFactory} from './types';

export type {
    FormMode,
    ProcessRouteMatrixCommandContext,
    ProcessRouteMatrixCommandDeps,
    ProcessRouteMatrixCommandFactory,
} from './types';

/**
 * 命令条从左到右的顺序（写命令的 key）。
 *
 * 分组按「依赖从哪来」切、顺序按业务要的排列，两者正交 —— 所以顺序单独声明在这张表里：
 * 加按钮 / 挪位置只改它，不必为了插到中间去硬拆一组。
 * 漏写 key 不会丢按钮（保持相对顺序排到末尾），开发环境会 warn 提醒补表。
 *
 * 比包装 BOM 少一个「工艺矩阵」：这一页本身就是工艺矩阵。
 */
const COMMAND_ORDER = [
    'add',
    'edit',
    'copy',
    'publish',
    'delete',
    'refresh',
] as const;

/** 共用同一份 context 的命令工厂；最终顺序由 COMMAND_ORDER 裁决 */
const processRouteMatrixCommandFactories: ProcessRouteMatrixCommandFactory[] = [
    addCommand,
    editCommand,
    copyCommand,
    publishCommand,
    deleteCommand,
    refreshCommand,
];

/**
 * 组装本页命令条（对应 CommandBar 的 items）。
 *
 * `groups` 必须 useMemo：`useCommandGroups` 内部按 `groups` 缓存，每帧新建一个数组会让缓存全失效。
 */
export function useProcessRouteMatrixCommands(
    context: ProcessRouteMatrixCommandContext,
): CommandItem[] {
    const groups = useMemo(() => [{context, factories: processRouteMatrixCommandFactories}], [context]);
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
