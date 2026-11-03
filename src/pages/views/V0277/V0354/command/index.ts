import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import {useCommandGroups} from '@/components/commands';
import {addCommand} from './add';
import {copyCommand} from './copy';
import {deleteCommand} from './delete';
import {editCommand} from './edit';
import {processMatrixCommand} from './processMatrix';
import {publishCommand} from './publish';
import {refreshCommand} from './refresh';
import type {PackBomMatrixCommandContext, PackBomMatrixCommandFactory} from './types';

export type {
    FormMode,
    PackBomMatrixCommandContext,
    PackBomMatrixCommandDeps,
    PackBomMatrixCommandFactory,
} from './types';

/**
 * 命令条从左到右的顺序（写命令的 key）。
 *
 * 分组按「依赖从哪来」切、顺序按业务要的排列，两者正交 —— 所以顺序单独声明在这张表里：
 * 加按钮 / 挪位置只改它，不必为了插到中间去硬拆一组。
 * 漏写 key 不会丢按钮（保持相对顺序排到末尾），开发环境会 warn 提醒补表。
 */
const COMMAND_ORDER = [
    'add',
    'edit',
    'copy',
    'publish',
    'processMatrix',
    'delete',
    'refresh',
] as const;

/** 共用同一份 context 的命令工厂；最终顺序由 COMMAND_ORDER 裁决 */
const packBomMatrixCommandFactories: PackBomMatrixCommandFactory[] = [
    addCommand,
    editCommand,
    copyCommand,
    publishCommand,
    processMatrixCommand,
    deleteCommand,
    refreshCommand,
];

/**
 * 组装本页命令条（对应 CommandBar 的 items）。
 *
 * `groups` 必须 useMemo：`useCommandGroups` 内部按 `groups` 缓存，每帧新建一个数组会让缓存全失效。
 * 目前只有一个 context，所以只有一组；将来某个命令要额外的依赖（V0189 里是「打开日志弹窗」那种），
 * 再派生出第二份 context 加一组即可，调用方不用改。
 */
export function usePackBomMatrixCommands(context: PackBomMatrixCommandContext): CommandItem[] {
    const groups = useMemo(() => [{context, factories: packBomMatrixCommandFactories}], [context]);
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
