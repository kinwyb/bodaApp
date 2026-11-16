import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import {useCommandGroups} from '@/components/commands';
import {addCommand} from './add';
import {deleteCommand} from './delete';
import {refreshCommand} from './refresh';
import {saveCommand} from './save';
import type {DepartmentCommandContext, DepartmentCommandFactory} from './types';

export type {
    DepartmentCommandContext,
    DepartmentCommandDeps,
    DepartmentCommandFactory,
    DepartmentSaveResult,
} from './types';

/** 命令条顺序 = 旧客户端 bar1 的 LinksPersistInfo：新增 → 保存 → 删除 → 刷新（无分隔线） */
const COMMAND_ORDER = ['add', 'save', 'delete', 'refresh'] as const;

const departmentCommandFactories: DepartmentCommandFactory[] = [
    addCommand,
    saveCommand,
    deleteCommand,
    refreshCommand,
];

/** 组装本页命令条；context 与 groups 都必须 useMemo，否则内部缓存每帧失效 */
export function useDepartmentCommands(context: DepartmentCommandContext): CommandItem[] {
    const groups = useMemo(() => [{context, factories: departmentCommandFactories}], [context]);
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
