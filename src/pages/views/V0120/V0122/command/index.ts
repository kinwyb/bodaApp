import type {CommandItem} from '@/components/CommandBar';
import {useCommands} from '@/components/commands';
import {editCommand} from './edit';
import {refreshCommand} from './refresh';
import type {ScheduleMaintenanceCommandContext, ScheduleMaintenanceCommandFactory} from './types';

export type {ScheduleMaintenanceCommandContext, ScheduleMaintenanceCommandDeps} from './types';

const SCHEDULE_MAINTENANCE_COMMANDS: ScheduleMaintenanceCommandFactory[] = [
    editCommand,
    refreshCommand,
];

export function useScheduleMaintenanceCommands(
    context: ScheduleMaintenanceCommandContext,
): CommandItem[] {
    return useCommands(context, SCHEDULE_MAINTENANCE_COMMANDS);
}
