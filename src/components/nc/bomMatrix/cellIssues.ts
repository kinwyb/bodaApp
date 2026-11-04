/**
 * 矩阵表格的**单元格问题标记** —— 保存校验说「这一格不对」之后，表格怎么画出来。
 *
 * 分两件事，别混：
 * - **哪一格有问题**：由业务校验算出（`pages/.../models/bomMatrixValidation`），
 *   形状是 `BomMatrixCellIssue`（表 + 行标识 + 列字段 + 文案）；
 * - **怎么显示**：本文件把那一串问题摊成 `键 → 文案` 的 Map，再给三张表各生成一对
 *   `cellStyle` / `cellTooltip`（红底 + 悬停说明）。
 *
 * 键里带**表名**：三张表的行标识是同一套（明细主键），同一个字段名也可能撞
 * （比如都叫 `VFree6Name` 的情况），不带表名就会「子项物料的红格子跑到配色表上」。
 *
 * `cellStyle` 只是 canvas 绘制时读的一次快照：问题 Map 变了**必须重绘**才生效
 * （见 `bomMatrix.tsx` 里 `cellIssues` 的那个 effect）。
 */
import type {GridTableCellStyleHook, GridTableCellTooltipHook} from '@/components/grid-table';
import type {BomMatrixSection} from './sections.ts';

/** 一个「这一格不对」的标记 */
export type BomMatrixCellIssue = {
    /** 哪张表 */
    section: BomMatrixSection;
    /** 行标识：与表格 `rowKey`（`PackBomMatrixDetailID`）一致 */
    rowKey: string;
    /** 列字段：明细是 `VFree1Name` 这类列名；配色是**颜色名**；配码是 `S{尺码}` */
    field: string;
    /** 一句话说明（红格子的悬停提示就是它） */
    message: string;
};

/** 摊平后的标记：`键 → 文案`，直接给 `cellStyle` / `cellTooltip` 查 */
export type BomMatrixCellIssueMap = Record<string, string>;

/** 键：表 + 行标识 + 列字段（三段都要，缺一段就会跨表串味） */
export function cellIssueKey(
    section: BomMatrixSection,
    rowKey: string,
    field: string,
): string {
    return `${section}|${rowKey}|${field}`;
}

/** 校验结果 → 标记 Map（同一格有多条时，后面的覆盖前面的；正常只有一条） */
export function toCellIssueMap(issues: BomMatrixCellIssue[]): BomMatrixCellIssueMap {
    const map: BomMatrixCellIssueMap = {};
    issues.forEach((issue) => {
        if (!issue.rowKey || !issue.field) return;
        map[cellIssueKey(issue.section, issue.rowKey, issue.field)] = issue.message;
    });
    return map;
}

/**
 * 给某一张表生成 `cellStyle` / `cellTooltip`。
 *
 * 入参是**整份 Map**（三张表共用的那一份），按本表的 `section` 取自己那几条 ——
 * 这样三个视图的 props 长得一样，父级也不必替它们分拣。
 *
 * 两个回调都忽略统计行 / 组行（它们没有业务主键，标记无从谈起）。
 */
export function createCellIssueHooks(
    section: BomMatrixSection,
    issues: BomMatrixCellIssueMap | undefined,
): {
    cellStyle: GridTableCellStyleHook;
    cellTooltip: GridTableCellTooltipHook;
} {
    /** 取这一格的提示文案：没有就 undefined（两个钩子共用这套判断） */
    const messageOf = (rowKey: string, field: string): string | undefined => {
        if (!issues || !rowKey) return undefined;
        return issues[cellIssueKey(section, rowKey, field)];
    };

    return {
        cellStyle: ({rowKey, field, isSummaryRow, isGroupRow}) => {
            if (isSummaryRow || isGroupRow) return undefined;
            // 与编辑器里的校验提示条同色（#fff2f0 / #cf1322），一眼能看出「这是错误」
            return messageOf(rowKey, field)
                ? {backgroundColor: '#fff2f0', textColor: '#cf1322'}
                : undefined;
        },
        cellTooltip: ({rowKey, field, isSummaryRow, isGroupRow}) => {
            if (isSummaryRow || isGroupRow) return undefined;
            return messageOf(rowKey, field);
        },
    };
}
