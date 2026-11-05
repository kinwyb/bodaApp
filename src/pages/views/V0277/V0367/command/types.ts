import type {CommandContext, CommandFactory} from "@/components/commands";
import type {ProcessRouteMatrix} from "@/api/schemas/nc/processRouteMatrix.ts";

export type FormMode = 'add' | 'edit' | 'view' | 'copy';

/**
 * 本页命令的业务依赖：通用层不认识这些字段，只在本页的 context 里。
 */
export interface ProcessRouteMatrixCommandDeps {
    /** 当前选中的业务行（页面负责过滤统计行等非业务数据） */
    getSelectedRows: () => ProcessRouteMatrix[];
    /**
     * 当前激活的那一行 —— 鼠标最后点选 / 键盘方向键移动到的行；没有则为 null
     * （Ctrl+A 全选、选中被清空、只点中表头）。
     */
    activeRow: ProcessRouteMatrix | null;
    /** 是否有选中行，驱动按钮 disabled */
    hasSelection: boolean;
    /** 按当前条件重新加载列表 */
    reload: () => Promise<void>;
    /** 打开表单弹窗（mode 语义见 FormMode） */
    openForm: (mode: FormMode, record: ProcessRouteMatrix | null) => void;
    /**
     * 打开「工艺路线矩阵明细」发布弹窗（发布 / 取消发布 / 更新）。
     *
     * 与包装 BOM 那边是同一个通用弹窗（`components/nc/matrixPushModal`），
     * 只是接口与版本列不同；所以这里只传矩阵本身，弹窗按主键自己取规则。
     */
    openPush: (matrix: ProcessRouteMatrix) => void;
}

/** 本页命令的上下文类型 = 通用层的框架能力（message / modal / tableRef）+ 本页业务依赖 */
export type ProcessRouteMatrixCommandContext = CommandContext<ProcessRouteMatrixCommandDeps>;

/** 本页命令工厂：接 context 返回一个命令项（与 V0354 的 command/ 同一套写法） */
export type ProcessRouteMatrixCommandFactory = CommandFactory<ProcessRouteMatrixCommandContext>;
