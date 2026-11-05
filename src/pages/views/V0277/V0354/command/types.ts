import type {CommandContext, CommandFactory} from "@/components/commands";
import type {PackBomMatrix} from "@/api/schemas/nc/bomMatrix.ts";

export type FormMode = 'add' | 'edit' | 'view' | 'copy';

/**
 * 包装 BOM 矩阵保存菜单权限编码
 */
export const PACK_BOM_MATRIX_SAVE_MENU_CODE = '63C31683-31D1-403F-83EC-C929B48F17E8';
/**
 * 包装 BOM 矩阵删除菜单权限编码
 */
export const PACK_BOM_MATRIX_DEL_MENU_CODE = 'C669D4CB-914D-43E7-AE23-551810F237D9';

/**
 * 本页命令的业务依赖：通用层不认识这些字段，只在本页的 context 里。
 *
 * 加字段前想一下「是不是本页所有命令都需要」：只有少数几个命令要的（比如打开变更日志弹窗），
 * 别塞进来 —— 单独给它那一组装一份扩展 context（见下面的 PackBomMatrixCommandContext）。
 */
export interface PackBomMatrixCommandDeps {
    /** 当前选中的业务行（页面负责过滤统计行等非业务数据） */
    getSelectedRows: () => PackBomMatrix[];
    /**
     * 当前激活的那一行 —— 鼠标最后点选 / 键盘方向键移动到的行；没有则为 null
     * （Ctrl+A 全选、选中被清空、只点中表头）。
     */
    activeRow: PackBomMatrix | null;
    /** 是否有选中行，驱动按钮 disabled */
    hasSelection: boolean;
    /** 按当前条件重新加载列表 */
    reload: () => Promise<void>;
    /** 打开表单弹窗（mode 语义见 FormMode） */
    openForm: (mode: FormMode, record: PackBomMatrix | null) => void;
    /**
     * 打开「包装BOM矩阵明细」发布弹窗（发布 / 取消发布 / 更新）。
     *
     * 与编辑弹窗的「生成」是同一个弹窗，所以这里只传矩阵本身 —— 弹窗按它的
     * `PackBomMatrixID` 自己取发布规则。
     */
    openPush: (matrix: PackBomMatrix) => void;
    /** 打开该矩阵对应的工艺矩阵（另一页，所以只有页面知道怎么过去） */
    openProcessMatrix: (matrix: PackBomMatrix) => void;
}

/** 本页命令的上下文类型 = 通用层的框架能力（message / modal / tableRef）+ 本页业务依赖 */
export type PackBomMatrixCommandContext = CommandContext<PackBomMatrixCommandDeps>;

/** 本页命令工厂：接 context 返回一个命令项（与 V0189_V0279_V0280 的 command/ 同一套写法） */
export type PackBomMatrixCommandFactory = CommandFactory<PackBomMatrixCommandContext>;
