import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import {useCommandGroups} from '@/components/commands';
import {deleteCommand} from './delete';
import {resetCommand} from './reset';
import type {YupaiCancelledCommandContext, YupaiCancelledCommandFactory} from './types';

export type {YupaiCancelledCommandContext} from './types';

const COMMAND_ORDER = ['reset', 'delete'] as const;

const commandFactories: YupaiCancelledCommandFactory[] = [
    resetCommand,
    deleteCommand,
];

export function useYupaiCancelledCommands(context: YupaiCancelledCommandContext): CommandItem[] {
    const groups = useMemo(() => [{context, factories: commandFactories}], [context]);
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
