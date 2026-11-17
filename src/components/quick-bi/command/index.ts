import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import {useCommandGroups} from '@/components/commands';
import {chartCommand} from './chart';
import {configCommand} from './config';
import type {QuickBICommandContext, QuickBICommandFactory} from './types';

export type {QuickBICommandContext, QuickBICommandDeps} from './types';

/**
 * 命令条顺序，对应 C# QuickBI bar1 的 LinksPersistInfo：
 * powerBtn（死按钮，处理函数整段被注释，不迁）→ detailViewConfigBtn → exportBtn / exportDetailBtn
 * （导出交给主表 / 明细表的 exportName）→ chartBtn。查询条上的年份 / 组织 / 查询不在命令里。
 */
const COMMAND_ORDER = ['config', 'chart'] as const;

const quickBICommandFactories: QuickBICommandFactory[] = [configCommand, chartCommand];

export function useQuickBICommands(context: QuickBICommandContext): CommandItem[] {
    const groups = useMemo(() => [{context, factories: quickBICommandFactories}], [context]);
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
