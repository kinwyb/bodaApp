import type {YupaiOrder} from '@/api';
import type {CommandContext, CommandFactory} from '@/components/commands';

export interface YupaiCancelledCommandDeps {
    /** 当前选中的全部业务行（恢复支持多选） */
    getSelectedRows: () => YupaiOrder[];
    /** 当前激活行（彻底删除只处理这一行） */
    activeRow: YupaiOrder | null;
    /** 是否有选中行 */
    hasSelection: boolean;
    /** 按当前条件重新加载 */
    reload: () => Promise<void>;
}

export type YupaiCancelledCommandContext = CommandContext<YupaiCancelledCommandDeps>;

export type YupaiCancelledCommandFactory = CommandFactory<YupaiCancelledCommandContext>;
