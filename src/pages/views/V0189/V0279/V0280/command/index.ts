import {useCommands} from '@/components/commands';
import type {CommandItem} from '@/components/CommandBar';
import {addCommand} from './add';
import {autoWidthCommand} from './autoWidth';
import {copyOrderedCommand,copyCommand} from './copyOrdered';
import {deleteCommand} from './delete';
import {editCommand} from './edit';
import {exportCommand} from './exportExcel';
import {publishCommand} from './publish';
import {refreshCommand} from './refresh';
import {
    authPlaceholderCommand,
    changeDatePlaceholderCommand,
    workflowPlaceholderCommands,
} from './placeholders';
import type {PreorderCommandContext, PreorderCommandFactory} from './types';

export type {PreorderCommandContext} from './types';

/** 命令工厂按命令条按钮顺序排列；组工厂（返回数组的）展开在所在位置 */
const preorderCommandFactories: PreorderCommandFactory[] = [
    addCommand,
    editCommand,
    deleteCommand,
    copyCommand,
    copyOrderedCommand,
    changeDatePlaceholderCommand,
    publishCommand,
    workflowPlaceholderCommands,
    refreshCommand,
    autoWidthCommand,
    exportCommand,
    authPlaceholderCommand,
];

/** 组装本页命令条 */
export function usePreorderCommands(context: PreorderCommandContext): CommandItem[] {
    return useCommands(context, preorderCommandFactories);
}
