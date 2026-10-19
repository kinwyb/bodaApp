import type {CommandContext, CommandFactory} from '@/components/commands';
import type {YupaiOrder, YupaiOrderQuery} from '@/api';

/**
 * 表单弹窗的模式。
 *
 * - `add`：新增，表单是空的；
 * - `edit`：编辑已有数据（提交时保留主键，改的是原来那条）；
 * - `view`：只读查看；
 * - `copy`：以一条已有数据为**底稿新建**（如「已下订单复制」）—— 界面与 add 一样可编辑，
 *   但数据是带出来的；提交时**不保留主键**，落成新记录。
 *
 * 这是**本页**的概念（与 openForm 配套），所以放在页面而不是通用层。
 * 提交时到底带不带主键由页面表单组件决定：这里只把模式传下去，别塞业务判断
 * （「哪些字段算主键」是业务知识）。
 */
export type FormMode = 'add' | 'edit' | 'view' | 'copy';

/**
 * 本页命令的业务依赖：通用层不认识这些字段，只在本页的 context 里。
 *
 * 加字段前想一下「是不是本页所有命令都需要」：只有少数几个命令要的（比如打开变更日志弹窗），
 * 别塞进来 —— 单独给它那一组装一份扩展 context（见下面的 YupaiOrderLogCommandContext）。
 */
export interface YupaiOrderCommandDeps {
    /** 当前选中的业务行（页面负责过滤统计行等非业务数据） */
    getSelectedRows: () => YupaiOrder[];
    /**
     * 当前激活的那一行 —— 鼠标最后点选 / 键盘方向键移动到的行；没有则为 null
     * （Ctrl+A 全选、选中被清空、只点中表头）。
     */
    activeRow: YupaiOrder | null;
    /** 是否有选中行，驱动按钮 disabled */
    hasSelection: boolean;
    /** 当前查询条件 */
    query: YupaiOrderQuery;
    /** 按当前条件重新加载列表 */
    reload: () => Promise<void>;
    /** 打开表单弹窗（mode 语义见 FormMode） */
    openForm: (mode: FormMode, record: YupaiOrder | null) => void;
}

/** 本页命令的上下文类型 = 通用层的框架能力（message / modal / tableRef）+ 本页业务依赖 */
export type YupaiOrderCommandContext = CommandContext<YupaiOrderCommandDeps>;

/**
 * 变更日志那一组的上下文：在本页公共依赖之上多带一个 openLog。
 *
 * 只有喂了这份 context 的命令能解构到 openLog —— 这就是分组的价值：其它命令既拿不到、
 * 也不必关心「打开日志弹窗」这件事。对应的工厂类型是下面的 YupaiOrderLogCommandFactory。
 */
export type YupaiOrderLogCommandContext = CommandContext<
    YupaiOrderCommandDeps & {openLog: (order: YupaiOrder) => void}
>;

/**
 * 分批命令那一组的上下文：多带一个 openBatch。
 *
 * 与变更日志同样的思路 —— 「打开分批弹窗」只有分批命令需要，
 * 不进公共依赖，别的命令既拿不到也不必关心。
 */
export type YupaiOrderBatchCommandContext = CommandContext<
    YupaiOrderCommandDeps & {openBatch: (order: YupaiOrder) => void}
>;

/**
 * 三个「设置」类弹窗（预订单阶段 / 工段产地 / 计划部）。
 *
 * 它们共用一份 context、一个入口 `openSetting(kind, order)`：三个命令的差别只在
 * 「打开哪一个」，没必要各占一份扩展依赖。kind 只决定渲染哪个弹窗，
 * 具体字段映射留在各自的弹窗里。
 */
export type YupaiOrderSettingKind = 'stage' | 'origin' | 'plan';

export type YupaiOrderSettingsCommandContext = CommandContext<
    YupaiOrderCommandDeps & {
        openSetting: (kind: YupaiOrderSettingKind, order: YupaiOrder) => void;
    }
>;

/** 共用本页公共依赖的命令工厂 */
export type YupaiOrderCommandFactory = CommandFactory<YupaiOrderCommandContext>;

/** 变更日志那组（多带 openLog）的命令工厂 */
export type YupaiOrderLogCommandFactory = CommandFactory<YupaiOrderLogCommandContext>;

/** 分批那组（多带 openBatch）的命令工厂 */
export type YupaiOrderBatchCommandFactory = CommandFactory<YupaiOrderBatchCommandContext>;

/** 三个设置弹窗那组（多带 openSetting）的命令工厂 */
export type YupaiOrderSettingsCommandFactory = CommandFactory<YupaiOrderSettingsCommandContext>;
