import React, {useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from "react";
import type {PackBomMatrix, PackBomMatrixDetail} from "@/api/schemas/nc/bomMatrix.ts";
import type {NCMaterialVFree} from "@/api/schemas/nc/NCMaterial.ts";
import {
    GridTable,
    type GridTableApi,
    type GridTableCellValueChangeInfo,
    type GridTableEditableCellInfo
} from "@/components/grid-table";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors";
import NCMaterialVFreeModal from "@/components/nc/materialVFreeModal.tsx";
import {toStringOrEmpty} from "@/utils";
import {buildColorColumns} from "./columns.ts";
import {type BomMatrixRow, colorCells, rowKeyOf, toColorRows} from "./rows.ts";
import type {BomMatrixGridApi} from "./gridApi.ts";
import {useEditableRows} from "./useEditableRows.ts";
import {BOMMATRIX_COLOR_VFREE_EDITOR} from "./common.ts";
import {ensureUseVFrees, primeUseVFrees, readUseVFrees} from "./vfreeCache.ts";

/**
 * 色号对应物料的哪个辅助属性项：**固定 `vfree6`**。
 *
 * 颜色列的列名就是颜色本身（`红`、`蓝`），没有 `VFreeXName` 可推 —— 与子项物料表
 * 那套「列名去 Name」的规则不是一回事，所以这是本文件自己的常量，别往上抽。
 */
const COLOR_VFREE_FIELD = 'vfree6';

export type BomMatrixColorViewProps = {
    /** 矩阵：颜色列（`ColorSort`）与初始色号（`ColorMatch`）都从它来 */
    matrix: PackBomMatrix;
    /** 明细（props 上那份）：换一份矩阵时用它重新派生，「没编辑过」时显示的就是它 */
    items: PackBomMatrixDetail[];
    /** 读**当前**明细（含子项物料表里还没保存的增删改）：本表懒挂载，首帧要按它重新铺 */
    getItems: () => PackBomMatrixDetail[];
    isEditable: boolean;
}

/**
 * 配色表：一行一个子项物料，一列一个缝制颜色。
 *
 * 与配码表同一套做法：行数据自持一份、可编辑、由父级按**行标识**命令增删改。
 * 保存时由 `./match.ts` 的 `rebuildColorMatch` 从颜色列反推 `ColorMatch`。
 *
 * ⚠️ 色号的「名字」与「编码」是两个字段（`{颜色}` / `{颜色}_val`），界面上只显示名字。
 * 双击色号单元格走辅助属性弹窗（与子项物料表共用编辑器 `MATERIAL_VFREE_EDITOR`），
 * 选中后两列一起写回；物料没开 `vfree6` 这一项的，`canCellEdit` 会把它拦在编辑态之外。
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

        /**
         * 可编辑列：每个颜色的色号（名字列；编码列不在列定义里，改不到）。
         *
         * 走辅助属性弹窗而不是普通输入框：色号是有字典的（物料档案里的 `vfree6`），
         * 让用户手敲会写进一个不存在的编码。
         *
         * ⚠️ 用的是**本表专属**的 `BOMMATRIX_COLOR_VFREE_EDITOR`，不能复用子项物料表的
         * `MATERIAL_VFREE_EDITOR`：编辑器注册同名先到先得，共用名字时只有先挂载的那个
         * 弹窗实例生效，这张表写死的 `vfreeField: 'vfree6'` 会被对方的 viewProps 顶掉
         * （结果就是拿颜色名去查色号字典）。详见 common.ts 的常量注释。
         */
        const editableFields = useMemo(() => {
            if (!isEditable) {
                return undefined;
            }
            const fields: Record<string, string | true> = {};
            (matrix.ColorSort ?? []).forEach((color) => {
                if (!color) return;
                const cells = colorCells(color);
                fields[cells.name] = BOMMATRIX_COLOR_VFREE_EDITOR;
            });
            return fields;
        }, [isEditable, matrix.ColorSort]);

        /**
         * 按物料预取「能用哪些辅助属性项」，供 `canCellEdit` 同步查（见 vfreeCache）。
         *
         * 与子项物料表同一套做法：行数据一变就预热，别等选中/双击现取 —— 那已经晚了。
         */
        useEffect(() => {
            if (!isEditable) {
                return;
            }
            primeUseVFrees(rows.map((row) => toStringOrEmpty(row.MaterialVID)));
        }, [isEditable, rows]);

        /**
         * 编辑前拦截：**色号是物料的辅助属性 `vfree6`，物料没开这一项就不允许选**。
         *
         * 这张表里可编辑的只有颜色列（`editableFields` 只配了它们），所以不用再辨字段；
         * 物料没填（新行）同样拦下 —— 没有物料就无从谈"它的色号"。
         * 必须同步（vtable 把返回值当「有没有编辑器」用），所以只查缓存。
         */
        const canCellEdit = useCallback((info: GridTableEditableCellInfo) => {
            const materialVID = toStringOrEmpty((info.record as BomMatrixRow | undefined)?.MaterialVID);
            if (!materialVID) {
                return false;
            }
            const useVFrees = readUseVFrees(materialVID);
            if (useVFrees === undefined) {
                // 还没取回来：保守拦下并补一次请求（去重 + 失败冷却）
                void ensureUseVFrees(materialVID);
                return false;
            }
            return useVFrees.includes(COLOR_VFREE_FIELD);
        }, []);

        /**
         * 弹窗选中色号：写回**两列** —— 颜色列放名字、`{颜色}_val` 放编码。
         *
         * 与子项物料表的回填（`VFree6Name` / `VFree6`）**不是一套规则**：颜色列的列名就是
         * 颜色本身（见 rows.ts 的 `colorCells`），照搬 `replace('Name','')` 会把编码写回同一个键，
         * `红_val` 就丢了。所以这里单独实现，两个视图只共用「编辑器」这一层。
         */
        const applyColor = useCallback((activeRow: EditorRowAccessor | null, vfree: NCMaterialVFree) => {
            const colorName = toStringOrEmpty(activeRow?.field);
            if (!colorName) {
                return;
            }
            activeRow?.setFields({
                [colorName]: vfree.name,
                [`${colorName}_val`]: vfree.pk_defdoc,
            });
            activeRow?.endEdit();
        }, []);

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
            <>
                <GridTable ref={tableRef} columns={columns} records={rows} rowKey={'PackBomMatrixDetailID'}
                           editableFields={editableFields}
                           canEditCell={canCellEdit}
                           onCellValueChange={handleCellValueChange}
                           multiSelect={false} rowNumber={false} widthMode={'autoWidth'}/>
                {/* 色号弹窗：用本表专属的 editorKey，取数固定 vfree6、回填写回
                `{颜色}` + `{颜色}_val`（与子项物料表那套不是一回事） */}
                <NCMaterialVFreeModal
                    open={false}
                    isEditor={true}
                    editorKey={BOMMATRIX_COLOR_VFREE_EDITOR}
                    viewProps={(row) => ({
                        materialVID: toStringOrEmpty(row?.record?.MaterialVID),
                        vfreeField: COLOR_VFREE_FIELD,
                    })}
                    onSelect={(record, activeRow) => {
                        applyColor(activeRow, record);
                    }}/>
            </>
        );
    });

export default BomMatrixColorView;
