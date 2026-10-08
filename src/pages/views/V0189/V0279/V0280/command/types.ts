import type {CommandContext, CommandFactory} from '@/components/commands';
import type {YupaiOrder, YupaiOrderQuery} from '@/services';

/** 本页命令的上下文类型 */
export type PreorderCommandContext = CommandContext<YupaiOrder, YupaiOrderQuery>;
/** 本页命令的工厂类型 */
export type PreorderCommandFactory = CommandFactory<YupaiOrder, YupaiOrderQuery>;
