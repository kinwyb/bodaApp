import type {CommandItem} from '@/components/CommandBar';
import {useCommands} from '@/components/commands';
import {addOutStoreCommand} from './add';
import {deleteOutStoreCommand} from './delete';
import type {OutStoreCommandContext, OutStoreCommandFactory} from './types';

export type {OutStoreCommandContext} from './types';

const OUT_STORE_COMMANDS: OutStoreCommandFactory[] = [addOutStoreCommand, deleteOutStoreCommand];

export function useOutStoreCommands(context: OutStoreCommandContext): CommandItem[] {
    return useCommands(context, OUT_STORE_COMMANDS);
}
