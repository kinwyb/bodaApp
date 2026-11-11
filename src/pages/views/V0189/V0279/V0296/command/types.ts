import type {CommandContext, CommandFactory} from '@/components/commands';

/** 本页命令依赖：刷新需要页面重新请求当前数据 */
export type DeliverPlanCommandDeps = {
    reload: () => Promise<void>;
};

export type DeliverPlanCommandContext = CommandContext<DeliverPlanCommandDeps>;

export type DeliverPlanCommandFactory = CommandFactory<DeliverPlanCommandContext>;
