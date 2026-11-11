import {useCommands} from '@/components/commands';
import type {CommandItem} from '@/components/CommandBar';
import {refreshCommand} from './refresh';
import type {DeliverPlanCommandContext, DeliverPlanCommandFactory} from './types';

export type {DeliverPlanCommandContext} from './types';

const DELIVER_PLAN_COMMAND_FACTORIES: DeliverPlanCommandFactory[] = [refreshCommand];

export function useDeliverPlanCommands(context: DeliverPlanCommandContext): CommandItem[] {
    return useCommands(context, DELIVER_PLAN_COMMAND_FACTORIES);
}
