import {useMemo} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import {useCommandGroups} from '@/components/commands';
import {auditCommand} from './audit';
import type {ProductionMonitorCommandContext, ProductionMonitorCommandFactory} from './types';

export type {ProductionMonitorCommandContext, ProductionMonitorCommandDeps} from './types';

const COMMAND_ORDER = ['audit'] as const;

const factories: ProductionMonitorCommandFactory[] = [auditCommand];

export function useProductionMonitorCommands(context: ProductionMonitorCommandContext): CommandItem[] {
    const groups = useMemo(() => [{context, factories}], [context]);
    return useCommandGroups(groups, {order: COMMAND_ORDER});
}
