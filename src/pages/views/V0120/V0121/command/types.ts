import type {CommandContext, CommandFactory} from '@/components/commands';
import type {OrderInfoRow, OrderInfoSaveResult} from '../orderInfo';

export type OrderInfoCommandDeps = {
    activeRow: OrderInfoRow | null;
    editing: boolean;
    saving: boolean;
    loading: boolean;
    startEdit: () => void;
    save: () => Promise<OrderInfoSaveResult>;
    removeRow: (id: number) => void;
    insertCopy: (sourceId: number, row: OrderInfoRow) => void;
};

export type OrderInfoCommandContext = CommandContext<OrderInfoCommandDeps>;
export type OrderInfoCommandFactory = CommandFactory<OrderInfoCommandContext>;
