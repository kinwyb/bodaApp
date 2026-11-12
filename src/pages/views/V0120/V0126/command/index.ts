import type {CommandItem} from '@/components/CommandBar';
import {useCommands} from '@/components/commands';
import {changeQtyCommand} from './changeQty';
import {deleteProduceDataCommand} from './delete';
import type {ProduceDataCommandContext, ProduceDataCommandFactory} from './types';

export type {ProduceDataCommandContext} from './types';

const PRODUCE_COMMANDS: ProduceDataCommandFactory[] = [changeQtyCommand, deleteProduceDataCommand];

export function useProduceDataCommands(context: ProduceDataCommandContext): CommandItem[] {
    return useCommands(context, PRODUCE_COMMANDS);
}
