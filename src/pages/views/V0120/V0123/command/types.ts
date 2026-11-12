import type {CommandContext, CommandFactory} from '@/components/commands';
import type {ProductionMonitorRow} from '../types';

export type ProductionMonitorCommandDeps = {
    selectionCount: number;
    getSelectedRows: () => ProductionMonitorRow[];
    reload: () => Promise<void>;
};

export type ProductionMonitorCommandContext = CommandContext<ProductionMonitorCommandDeps>;
export type ProductionMonitorCommandFactory = CommandFactory<ProductionMonitorCommandContext>;
