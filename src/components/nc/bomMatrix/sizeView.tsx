import React, {useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from "react";
import type {BomMatrix, BomMatrixDetail} from "@/api/schemas/nc/bomMatrix.ts";
import type {NCMaterialVFree} from "@/api/schemas/nc/NCMaterial.ts";
import {type GridTableApi, GridTable, type GridTableCellValueChangeInfo, type GridTableEditableCellInfo} from "@/components/grid-table";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors";
import NCMaterialVFreeModal from "@/components/nc/materialVFreeModal.tsx";
import {toStringOrEmpty} from "@/utils";
import {buildSizeColumns} from "./columns.ts";
import {type BomMatrixRow, rowKeyOf, sizeCells, toSizeRows} from "./rows.ts";
import type {BomMatrixGridApi} from "./gridApi.ts";
import {useEditableRows} from "./useEditableRows.ts";
import {BOMMATRIX_SIZE_VFREE_EDITOR} from "./common.ts";
import {ensureUseVFrees, primeUseVFrees, readUseVFrees} from "./vfreeCache.ts";

/**
 * 尺码系数对应物料的哪个辅助属性项：**固定 `vfree7`**。
 *
 * 尺码列的列名是 `S{码}`（`S260`），没有 `VFreeXName` 可推 —— 与子项物料表
 * 「列名去 Name」的规则不是一回事，所以这是本文件自己的常量。
 */
const SIZE_VFREE_FIELD = 'vfree7';

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
     * 可编辑列：每个尺码的三个可见格子（损耗数量 / 系数名 / 尺码用量）。
     *
     * 损耗数量与尺码用量是数字（`'auto'` 走数字框）；**系数名那列走辅助属性弹窗**
     * （`BOMMATRIX_SIZE_VFREE_EDITOR`）—— 尺码系数是有字典的（物料档案里的 `vfree7`），
     * 让用户手敲会写进一个不存在的编码，而保存时 `VFree7` 取的就是这一列。
     *
     * ⚠️ 系数「名字」与「编码」是两个字段（`S{码}` / `S{码}_val`），界面上只显示名字那列；
     * `_val` 不在列定义里（所以这里不用配），选中后由 `applySize` 跟着名字一起写回。
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
            fields[cells.name] = BOMMATRIX_SIZE_VFREE_EDITOR;
            fields[cells.number] = 'auto';
        });
        return fields;
    }, [isEditable, matrix.SizeSort]);

    /** 尺码「系数」列（`S{码}`）：这张表里只有它们要按物料的 `vfree7` 判断 */
    const sizeNameFields = useMemo(() => {
        const fields = new Set<string>();
        (matrix.SizeSort ?? []).forEach((size) => {
            if (!size) return;
            fields.add(sizeCells(size).name);
        });
        return fields;
    }, [matrix.SizeSort]);

    /**
     * 按物料预取「能用哪些辅助属性项」，供 `canCellEdit` 同步查（见 vfreeCache）。
     * 与另外两张表同一套：行数据一变就预热，别等选中/双击现取。
     */
    useEffect(() => {
        if (!isEditable) {
            return;
        }
        primeUseVFrees(rows.map((row) => toStringOrEmpty(row.MaterialVID)));
    }, [isEditable, rows]);

    /**
     * 编辑前拦截：**尺码系数是物料的辅助属性 `vfree7`，物料没开这一项就不允许选**。
     *
     * 只拦系数列：损耗数量 / 尺码用量是纯数字，跟辅助属性无关，照旧可编辑。
     * 必须同步（vtable 把返回值当「有没有编辑器」用），所以只查缓存。
     */
    const canCellEdit = useCallback((info: GridTableEditableCellInfo) => {
        if (!sizeNameFields.has(info.field)) {
            return true;
        }
        const materialVID = toStringOrEmpty((info.record as BomMatrixRow | undefined)?.MaterialVID);
        if (!materialVID) {
            // 没物料就谈不上"它的尺码"，保守拦下
            return false;
        }
        const useVFrees = readUseVFrees(materialVID);
        if (useVFrees === undefined) {
            void ensureUseVFrees(materialVID);
            return false;
        }
        return useVFrees.includes(SIZE_VFREE_FIELD);
    }, [sizeNameFields]);

    /**
     * 弹窗选中尺码：写回**两列** —— `S{码}` 放名字、`S{码}_val` 放编码。
     *
     * 列名是 `S{码}`（见 rows.ts 的 `sizeCells`），编码列就是它加 `_val`；
     * 与子项物料表 `VFree7Name` → `VFree7` 那套不同，所以单独实现。
     */
    const applySize = useCallback((activeRow: EditorRowAccessor | null, vfree: NCMaterialVFree) => {
        const sizeField = toStringOrEmpty(activeRow?.field);
        if (!sizeField) {
            return;
        }
        activeRow?.setFields({
            [sizeField]: vfree.name,
            [`${sizeField}_val`]: vfree.pk_defdoc,
        });
        activeRow?.endEdit();
    }, []);

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
        <>
            <GridTable ref={tableRef} columns={columns} records={rows} rowKey={'PackBomMatrixDetailID'}
                       editableFields={editableFields}
                       canEditCell={canCellEdit}
                       onCellValueChange={handleCellValueChange}
                       multiSelect={false} rowNumber={false} widthMode={'autoWidth'}/>
            {/* 尺码系数弹窗：本表专属 editorKey，取数固定 vfree7、回填写回
                `S{码}` + `S{码}_val`（与子项物料表那套不是一回事） */}
            <NCMaterialVFreeModal
                open={false}
                isEditor={true}
                editorKey={BOMMATRIX_SIZE_VFREE_EDITOR}
                viewProps={(row) => ({
                    materialVID: toStringOrEmpty(row?.record?.MaterialVID),
                    vfreeField: SIZE_VFREE_FIELD,
                })}
                onSelect={(record, activeRow) => {
                    applySize(activeRow, record);
                }}/>
        </>
    );
});

export default BomMatrixSizeView;
