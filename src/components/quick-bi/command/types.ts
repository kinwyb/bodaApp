import type {CommandContext, CommandFactory} from '@/components/commands';
import type {KpiRecord} from '../types';

/** 本页业务依赖：只写「按钮需要、通用层不认识」的字段 */
export type QuickBICommandDeps = {
    /** 主表当前激活行（图表命令取它的「指标」） */
    activeRow: KpiRecord | null;
    /** 有没有选中行 —— 驱动 disabled */
    hasSelection: boolean;
    /** 是否超级管理员（C# detailViewConfigBtn 只对 SuperUserID 显示） */
    isSuperUser: boolean;
    /** 打开指标图表弹窗 */
    openChart: (kpi: string) => void;
    /** 打开明细配置弹窗（仅超管） */
    openConfig: () => void;
};

export type QuickBICommandContext = CommandContext<QuickBICommandDeps>;

export type QuickBICommandFactory = CommandFactory<QuickBICommandContext>;
