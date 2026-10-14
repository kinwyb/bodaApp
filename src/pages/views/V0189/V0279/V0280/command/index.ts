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
import type {
    YupaiOrderCommandContext,
    YupaiOrderCommandFactory,
    YupaiOrderLogCommandContext,
} from './types';
import {useMemo} from "react";
import {useCommandGroups} from "@/components/commands";

export type {
    FormMode,
    YupaiOrderCommandContext,
    YupaiOrderLogCommandContext,
    YupaiOrderLogCommandFactory,
} from './types';

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
const yupaiOrderCommandFactories: YupaiOrderCommandFactory[] = [
    addCommand,
    editCommand,
    deleteCommand,
    copyCommand,
    copyOrderedCommand,
    publishCommand,
    workflowPlaceholderCommands,
    refreshCommand,
    autoWidthCommand,
    exportCommand,
    authPlaceholderCommand,
];

/**
 * 组装本页命令条：两组命令，各喂自己的 context。
 *
 * - 第一组（新增 / 修改 / 删除 …）只用公共依赖；
 * - 第二组（变更日志）在这之上多要一个 openLog —— 只有它拿得到，别的命令既拿不到也不必关心。
 *
 * 注意 groups **不能**写 `CommandGroup<X>[]` 注解：两组 context 类型不同，注解会因为
 * 「函数参数逆变」报错（详见 useCommandGroups 的 AnyCommandGroup）。组内的匹配由各命令自己
 * 声明的工厂类型保证（changeLogCommand 声明成 YupaiOrderLogCommandFactory）。
 * groups 必须 useMemo，否则 useCommandGroups 里的缓存每帧失效。
 */
export function useYupaiOrderCommands(
    context: YupaiOrderCommandContext,
    changeLogContext: YupaiOrderLogCommandContext,
): CommandItem[] {
    const groups = useMemo(
        () => [
            {context, factories: yupaiOrderCommandFactories},
            {context: changeLogContext, factories: [changeLogCommand]},
        ],
        [context, changeLogContext],
    );
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
