import {useMemo} from 'react';
import {useCommandGroups} from '@/components/commands';
import type {CommandItem} from '@/components/CommandBar';
import {addCommand} from './add';
import {autoWidthCommand} from './autoWidth';
import {copyCommand, copyOrderedCommand} from './copyOrdered';
import {deleteCommand} from './delete';
import {editCommand} from './edit';
import {exportCommand} from './exportExcel';
import {publishCommand} from './publish';
import {refreshCommand} from './refresh';
import {changeLogCommand} from "./changeLog";
import {authPlaceholderCommand, workflowPlaceholderCommands,} from './placeholders';
import type {YupaiOrderCommandContext, YupaiOrderCommandFactory} from './types';

export type {YupaiOrderCommandContext} from './types';

/**
 * 命令条从左到右的顺序（写命令的 key）。
 *
 * 分组是按「依赖从哪来」切的、顺序是业务要的排列，两者正交 —— 所以顺序单独声明在这张表里：
 * 加按钮 / 挪位置只改它，不必为了「插到中间」去硬拆一组。
 * 漏写 key 不会丢按钮（保持相对顺序排到末尾），开发环境会 warn 提醒补表。
 */
const COMMAND_ORDER = [
    'add',
    'edit',
    'cancel',
    'copy',
    'copyOrdered',
    'changeDate',
    'publish',
    'ordered',
    'assign',
    'stage',
    'origin',
    'plan',
    'refresh',
    'autoWidth',
    'export',
    'auth',
] as const;

/** 共用同一份 context 的命令；组工厂（返回数组的）按数组位置展开。最终顺序由 COMMAND_ORDER 裁决 */
const preorderCommandFactories: YupaiOrderCommandFactory[] = [
    addCommand,
    editCommand,
    deleteCommand,
    copyCommand,
    copyOrderedCommand,
    changeLogCommand,
    publishCommand,
    workflowPlaceholderCommands,
    refreshCommand,
    autoWidthCommand,
    exportCommand,
    authPlaceholderCommand,
];

/**
 * 组装本页命令条。
 *
 * 目前所有命令共用同一份 context。将来某一组命令需要「别的命令不需要的依赖」时，往 groups 里
 * 再加一项（喂一份扩展过的 context）即可 —— 它排在哪由 COMMAND_ORDER 决定，与分组无关。
 * groups（含其中的 context）必须 useMemo：否则 useCommandGroups 里的缓存每帧都失效。
 */
export function usePreorderCommands(context: YupaiOrderCommandContext): CommandItem[] {
    const groups = useMemo(
        () => [{context, factories: preorderCommandFactories}],
        [context],
    );
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
