import type {CommandContext, CommandFactory} from '@/components/commands';
import type {ScheduleQueryResult} from '../schedule';

export type ScheduleMaintenanceCommandDeps = {
    editing: boolean;
    employeeLoading: boolean;
    loading: boolean;
    toggleEditing: () => Promise<boolean>;
    reload: () => Promise<ScheduleQueryResult>;
};

export type ScheduleMaintenanceCommandContext = CommandContext<ScheduleMaintenanceCommandDeps>;
export type ScheduleMaintenanceCommandFactory = CommandFactory<ScheduleMaintenanceCommandContext>;
