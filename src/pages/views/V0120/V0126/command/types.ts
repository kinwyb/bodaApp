import type {MisProduceDataRow} from '@/api';
import type {CommandContext, CommandFactory} from '@/components/commands';

export type ProduceDataCommandDeps = {
    activeRow: MisProduceDataRow | null;
    isVietnam: boolean;
    openQtyChange: (row: MisProduceDataRow) => void;
    clearDeletedRow: (id: string) => void;
};

export type ProduceDataCommandContext = CommandContext<ProduceDataCommandDeps>;
export type ProduceDataCommandFactory = CommandFactory<ProduceDataCommandContext>;
