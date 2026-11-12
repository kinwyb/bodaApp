import type {MisProductOutStoreBill} from '@/api';
import type {CommandContext, CommandFactory} from '@/components/commands';
import type {RefObject} from 'react';
import type {FilterTableApi} from '@/components/grid-table';

export type OutStoreCommandDeps = {
    selected: MisProductOutStoreBill | null;
    reload: () => Promise<void>;
    openAdd: () => void;
    billTableRef: RefObject<FilterTableApi | null>;
};

export type OutStoreCommandContext = CommandContext<OutStoreCommandDeps>;
export type OutStoreCommandFactory = CommandFactory<OutStoreCommandContext>;
