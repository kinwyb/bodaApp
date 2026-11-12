import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import {useCommandGroups} from '@/components/commands';
import {copyCommand} from './copy';
import {deleteCommand} from './delete';
import {editCommand} from './edit';
import {saveCommand} from './save';
import type {OrderInfoCommandContext, OrderInfoCommandFactory} from './types';

export type {OrderInfoCommandContext, OrderInfoCommandDeps} from './types';

const COMMAND_ORDER = ['edit', 'save', 'delete', 'copy'] as const;

const ORDER_INFO_COMMANDS: OrderInfoCommandFactory[] = [
    editCommand,
    saveCommand,
    deleteCommand,
    copyCommand,
];

export function useOrderInfoCommands(context: OrderInfoCommandContext): CommandItem[] {
    const groups = useMemo(() => [{context, factories: ORDER_INFO_COMMANDS}], [context]);
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
