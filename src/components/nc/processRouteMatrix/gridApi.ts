/**
 * 工序明细表的**行级命令 API**。
 *
 * 与包装 BOM 那边的 `BomMatrixGridApi` 形状一致（`table` / `getRows` / `addRow` /
 * `removeRow` / `updateRow`）：界面桥给 agent 开写入口就走这一套，不直接改行数组 ——
 * 直接改数组时表格不会更新数据源，屏幕上什么都不动。
 *
 * 工艺矩阵只有一张可编辑表，所以这里**没有**「行事件」那套跨表同步
 * （包装 BOM 的 `BomMatrixRowEvent`）：工序明细自己改自己，没有第二张表要对齐。
 */

import type {GridTableApi} from '@/components/grid-table';

/** 一张表能对外做的事 */
export type ProcessRouteGridApi = {
    /**
     * 底下那个 `GridTable` 的读能力（界面桥 `readTable` 用）。
     *
     * 单独开一个取值函数，而不是把 `GridTableApi` 摊平到这里：命令 API 是稳定的四件事，
     * 表格读能力是另一个维度的东西，混在一起会让「这张表支持哪些命令」看不清。
     */
    table: () => GridTableApi | null;
    /** 当前行数据（含未保存的编辑；**不受表格排序/筛选影响**，就是 state 里那份） */
    getRows: () => Record<string, unknown>[];
    /** 追加 / 插入一行；`afterKey` 给了就插到那行后面，没给或找不到就追加到末尾 */
    addRow: (row: Record<string, unknown>, afterKey?: string) => void;
    /** 按行标识删一行 */
    removeRow: (rowKey: string) => void;
    /** 按行标识改行的若干字段 */
    updateRow: (rowKey: string, fields: Record<string, unknown>) => void;
};
