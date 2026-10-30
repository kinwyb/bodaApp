import React, {useCallback, useImperativeHandle, useMemo, useRef, useState} from "react";
import type {BomMatrix, BomMatrixDetail} from "@/api/schemas/nc/bomMatrix.ts";
import {type GridTableApi, GridTable, type GridTableCellValueChangeInfo} from "@/components/grid-table";
import {buildColorColumns} from "./columns.ts";
import {type BomMatrixRow, colorCells, rowKeyOf, toColorRows} from "./rows.ts";
import type {BomMatrixGridApi} from "./gridApi.ts";
import {useEditableRows} from "./useEditableRows.ts";

export type BomMatrixColorViewProps = {
    /** 矩阵：颜色列（`ColorSort`）与初始色号（`ColorMatch`）都从它来 */
    matrix: BomMatrix;
    /** 明细（props 上那份）：换一份矩阵时用它重新派生，「没编辑过」时显示的就是它 */
    items: BomMatrixDetail[];
    /** 读**当前**明细（含子项物料表里还没保存的增删改）：本表懒挂载，首帧要按它重新铺 */
    getItems: () => BomMatrixDetail[];
    isEditable: boolean;
}

/**
 * 配色表：一行一个子项物料，一列一个缝制颜色。
 *
 * 与配码表同一套做法：行数据自持一份、可编辑、由父级按**行标识**命令增删改。
 * 保存时由 `./match.ts` 的 `rebuildColorMatch` 从颜色列反推 `ColorMatch`。
 *
 * ⚠️ 色号的「名字」与「编码」也是两个字段（`{颜色}` / `{颜色}_val`），界面上只显示名字。
 * 用户改名字时编码不会跟着变，保存时 `VFree6` 仍是旧编码 —— 要做成「选色号」得换成
 * 一个能同时写两列的编辑器（需要色号字典接口）。
 */
const BomMatrixColorView = React.forwardRef<BomMatrixGridApi, BomMatrixColorViewProps>(
    ({matrix, items, getItems, isEditable}, ref) => {

    /* 首帧按「当前明细」铺（可能已经比 props.items 多/少几行），这份同时是第一份本地改动 */
    const [initialRows] = useState(() => toColorRows(matrix, getItems()));

    /* 行 = 派生一份 + 本地改动优先；换一份矩阵自动重置（详见 useEditableRows） */
    const baseRows = useMemo(() => toColorRows(matrix, items), [matrix, items]);
    const {rows, commit} = useEditableRows(baseRows, matrix, initialRows);
    const tableRef = useRef<GridTableApi | null>(null);

    const columns = useMemo(() => buildColorColumns(matrix), [matrix]);

    /** 可编辑列：每个颜色的色号（名字列；编码列不在列定义里，改不到） */
    const editableFields = useMemo(() => {
        if (!isEditable) {
            return undefined;
        }
        const fields: Record<string, string | true> = {};
        (matrix.ColorSort ?? []).forEach((color) => {
            if (!color) return;
            const cells = colorCells(color);
            fields[cells.name] = 'auto';
        });
        return fields;
    }, [isEditable, matrix.ColorSort]);

    /** 按行标识改若干字段；原地合并保持行对象身份（原因见 itemView 的 updateRow） */
    const updateRow = useCallback((rowKey: string, fields: Record<string, unknown>) => {
        commit((prev) => prev.map((row) => {
            if (rowKeyOf(row) !== rowKey) return row;
            Object.assign(row, fields);
            return row;
        }));
    }, [commit]);

    /** 插入一行（父级在子项物料插行时调用；行内容由父级按明细复制过来） */
    const addRow = useCallback((row: Record<string, unknown>, afterKey?: string) => {
        commit((prev) => {
            const anchor = afterKey ? prev.findIndex((item) => rowKeyOf(item) === afterKey) : -1;
            const index = anchor >= 0 ? anchor + 1 : prev.length;
            const next = [...prev];
            next.splice(index, 0, row as BomMatrixRow);
            return next;
        });
    }, [commit]);

    /** 按行标识删一行 */
    const removeRow = useCallback((rowKey: string) => {
        commit((prev) => prev.filter((row) => rowKeyOf(row) !== rowKey));
    }, [commit]);

    const handleCellValueChange = useCallback(
        ({field, rowIndex, record, value}: GridTableCellValueChangeInfo) => {
            const rowKey = rowKeyOf(record) || rowKeyOf(rows[rowIndex]);
            if (!rowKey) return;
            updateRow(rowKey, {[field]: value});
        },
        [rows, updateRow],
    );

    useImperativeHandle(ref, () => ({
        table: () => tableRef.current,
        getRows: () => rows,
        addRow,
        removeRow,
        updateRow,
    }), [rows, addRow, removeRow, updateRow]);

    return (
        <GridTable ref={tableRef} columns={columns} records={rows} rowKey={'PackBomMatrixDetailID'}
                   editableFields={editableFields}
                   onCellValueChange={handleCellValueChange}
                   multiSelect={false} rowNumber={false} widthMode={'autoWidth'}/>
    );
});

export default BomMatrixColorView;
