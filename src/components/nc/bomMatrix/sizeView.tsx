import React, {useCallback, useImperativeHandle, useMemo, useRef, useState} from "react";
import type {BomMatrix, BomMatrixDetail} from "@/api/schemas/nc/bomMatrix.ts";
import {type GridTableApi, GridTable, type GridTableCellValueChangeInfo} from "@/components/grid-table";
import {buildSizeColumns} from "./columns.ts";
import {type BomMatrixRow, rowKeyOf, sizeCells, toSizeRows} from "./rows.ts";
import type {BomMatrixGridApi} from "./gridApi.ts";
import {useEditableRows} from "./useEditableRows.ts";

export type BomMatrixSizeViewProps = {
    /** 矩阵：尺码列（`SizeSort`）与初始格子值（`SizeMatch`）都从它来 */
    matrix: BomMatrix;
    /** 明细（props 上那份）：换一份矩阵时用它重新派生，「没编辑过」时显示的就是它 */
    items: BomMatrixDetail[];
    /**
     * 读**当前**明细（含子项物料表里还没保存的增删改）。
     *
     * 本表是懒挂载的：用户可能先在子项物料表里加了几行才第一次点开这里，
     * 那几次命令它没收到 —— 首帧必须按**当前明细**重新铺，用 `items`（props，还是原始数据）
     * 就会出现「子项物料 5 行、这里 3 行」。
     */
    getItems: () => BomMatrixDetail[];
    isEditable: boolean;
}

/**
 * 配码表：一行一个子项物料，每个尺码三列（损耗数量 / 尺码系数 / 尺码用量）。
 *
 * 行数据**自己持有一份**（从明细 + `SizeMatch` 初始化一次），之后独立编辑：
 * 子项物料表加/删/改行时，父级按**行标识**命令这里跟着加/删/改，两边各改各的 state。
 *
 * ⚠️ 这里改的是**尺码格子**（`Sunhao{码}` / `S{码}` / `N{码}`），保存时由
 * `./match.ts` 的 `rebuildSizeMatch` 从这些列反推 `SizeMatch` —— 所以格子值必须以这张表为准，
 * 保存时不能从明细重算（那等于把这里编辑的东西丢掉）。
 */
const BomMatrixSizeView = React.forwardRef<BomMatrixGridApi, BomMatrixSizeViewProps>(
    ({matrix, items, getItems, isEditable}, ref) => {

    /*
     * 首次渲染就按「当前明细」铺一份（不是 props.items）：本表可能是在明细被改过之后才挂载的。
     * 这份同时充当第一份本地改动，所以后面换矩阵时照样会失效（见 useEditableRows）。
     */
    const [initialRows] = useState(() => toSizeRows(matrix, getItems()));

    /*
     * 行数据 = 「派生一份 + 本地改动优先」：
     * 派生只看 matrix/items，但用户一编辑就落在本地，派生结果再算也不会顶掉它；
     * 换一份矩阵（`matrix` 引用变了）本地改动作废，自动回到按新数据派生的行。
     */
    const baseRows = useMemo(() => toSizeRows(matrix, items), [matrix, items]);
    const {rows, commit} = useEditableRows(baseRows, matrix, initialRows);
    const tableRef = useRef<GridTableApi | null>(null);

    const columns = useMemo(() => buildSizeColumns(matrix), [matrix]);

    /**
     * 可编辑列：每个尺码的四个格子（损耗数量 / 系数名 / 系数编码 / 尺码用量）。
     *
     * 只有损耗数量与尺码用量是数字（`dataType:'int'`，'auto' 走数字框），系数名/编码是文本。
     *
     * ⚠️ 系数「名字」与「编码」是两个字段（`S{码}` / `S{码}_val`），界面上只显示名字那列。
     * 用户改名时编码不会跟着变，保存时 `VFree7` 仍是旧编码 —— 要做成「选系数」得换成
     * 一个能同时写两列的编辑器（需要系数字典接口），别在保存时猜用户想选哪个。
     */
    const editableFields = useMemo(() => {
        if (!isEditable) {
            return undefined;
        }
        const fields: Record<string, string | true> = {};
        (matrix.SizeSort ?? []).forEach((size) => {
            if (!size) return;
            const cells = sizeCells(size);
            fields[cells.sunhao] = 'auto';
            fields[cells.name] = 'auto';
            fields[cells.value] = 'auto';
            fields[cells.number] = 'auto';
        });
        return fields;
    }, [isEditable, matrix.SizeSort]);

    /**
     * 按行标识改若干字段（编辑单元格 / 外部命令共用）。
     *
     * ⚠️ 原地合并、保持**行对象身份**：原因见 itemView 的同名方法（编辑器回填按对象定位行）。
     */
    const updateRow = useCallback((rowKey: string, fields: Record<string, unknown>) => {
        commit((prev) => prev.map((row) => {
            if (rowKeyOf(row) !== rowKey) return row;
            Object.assign(row, fields);
            return row;
        }));
    }, [commit]);

    /** 插入一行（父级在子项物料插行时调用；行内容由父级按明细复制过来，与那张表的行是两份对象） */
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

export default BomMatrixSizeView;
