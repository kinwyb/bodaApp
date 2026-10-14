import type {CommandContext, CommandFactory} from '@/components/commands';
import type {YupaiOrder, YupaiOrderQuery} from '@/api';

/** 本页命令的上下文类型 */
export type YupaiOrderCommandContext = CommandContext<YupaiOrder, YupaiOrderQuery>;
/**
 * 本页命令的工厂类型。
 *
 * 泛型给整个 context 类型（不是 TRecord / TQuery）：本页将来若有某组命令要读额外字段，
 * 把那组的 context 扩展成 `YupaiOrderCommandContext & {额外字段}` 并给工厂换个类型别名即可，
 * 其它命令不受影响（分组用法见 useCommandGroups）。
 */
export type YupaiOrderCommandFactory = CommandFactory<YupaiOrderCommandContext>;
