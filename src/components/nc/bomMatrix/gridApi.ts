/**
 * 三张表的**行级命令 API** —— 表与表之间唯一的同步通道。
 *
 * 每张表（子项物料 / 配色 / 配码）都 `forwardRef` 暴露这一套：
 * 自己增删改自己，外部（父级编排）也能按 key 命令另一张表跟着做同样的事。
 *
 * 为什么是命令而不是「共享一份行数据」：三张表各有各的编辑态，共享对象时
 * 「一方改了另一方要不要重绘」说不清；命令式反过来很直白 ——
 * 谁改了谁负责发出动作，另外两张表各自按 key 落到自己的行上，各改各的 state。
 *
 * 表没挂载时（antd Tabs 懒挂载）`ref.current` 是 null，父级直接跳过即可：
 * 那张表**首次挂载时用当前明细初始化**，天然就是最新的，不需要补历史动作。
 */

/** 一张表能对外做的事 */
export type BomMatrixGridApi = {
    /**
     * 底下那个 `GridTable` 的读能力（界面桥 `readTable` 用）。
     *
     * 单独开一个取值函数而不是把 `GridTableApi` 摊平到这里：命令 API 是稳定的四件事，
     * 表格读能力是另一个维度的东西，混在一起会让「这张表支持哪些命令」看不清。
     */
    table: () => import('@/components/grid-table').GridTableApi | null;
    /** 当前行数据（含未保存的编辑；**不受表格排序/筛选影响**，就是 state 里那份） */
    getRows: () => Record<string, unknown>[];
    /** 追加 / 插入一行；`afterKey` 给了就插到那行后面，没给或找不到就追加到末尾 */
    addRow: (row: Record<string, unknown>, afterKey?: string) => void;
    /** 按行标识删一行 */
    removeRow: (rowKey: string) => void;
    /** 按行标识改行的若干字段（物料变了、行号变了都走它） */
    updateRow: (rowKey: string, fields: Record<string, unknown>) => void;
};

/**
 * 子项物料表发出的行事件 —— 父级据此驱动配色 / 配码。
 *
 * 只报「哪一行怎么变了」，不带「另外两张表该怎么改」：那是父级的事，
 * 视图不该知道同屏还有哪几张表。
 */
export type BomMatrixRowEvent =
    | {type: 'insert'; row: Record<string, unknown>; afterKey?: string}
    | {type: 'remove'; rowKey: string}
    | {type: 'update'; rowKey: string; fields: Record<string, unknown>};
