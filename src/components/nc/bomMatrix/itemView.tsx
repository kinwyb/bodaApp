import React, {useCallback, useImperativeHandle, useMemo, useRef} from "react";
import {message} from "antd";
import {DeleteOutlined, PlusOutlined} from "@ant-design/icons";
import type {BomMatrixDetail} from "@/api/schemas/nc/bomMatrix.ts";
import {
    GridTable,
    type GridTableApi,
    type GridTableCellValueChangeInfo,
    type GridTableMenuConfig
} from "@/components/grid-table";
import {alignMenuIcons, toMenuIcon} from "@/components/grid-table/menuIcon";
import {ITEM_COLUMNS} from "./columns.ts";
import {nextRowNo} from "./rowNo.ts";
import {type BomMatrixRow, rowKeyOf, toItemRows} from "./rows.ts";
import type {BomMatrixGridApi, BomMatrixRowEvent} from "./gridApi.ts";
import {useEditableRows} from "./useEditableRows.ts";
import NCMaterialModal, {MATERIAL_EDITOR} from "@/components/nc/materialModal.tsx";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors";
import type {NCMaterial, NCMaterialVFree} from "@/api/schemas/nc/NCMaterial.ts";
import {ncMaterialApi} from "@/api/modules/nc/material.ts";
import {ErrorMessage} from "@/api/request.ts";
import NCMaterialVFreeModal, {MATERIAL_VFREE_EDITOR} from "@/components/nc/materialVFreeModal.tsx";
import {toStringOrEmpty} from "@/utils";

/** bom矩阵子物料树形 */
export interface BomMatrixItemProps {
    /** 初始行数据：只在**首次挂载**时用（换矩阵时父级会用新的 key 重挂载本组件） */
    items: BomMatrixDetail[]
    isEditable: boolean
    /**
     * 行变化事件 —— 父级据此驱动配色 / 配码两张表。
     *
     * 只报「哪一行怎么变了」：本组件不认识同屏还有哪几张表，也不该认识
     * （否则三张表就缠在一起了）。
     */
    onRowEvent?: (event: BomMatrixRowEvent) => void
}

/* 菜单图标在模块级渲染一次（`toMenuIcon` 走 `renderToStaticMarkup`，别放进渲染路径） */
const MENU_ICON_ADD = toMenuIcon(<PlusOutlined/>);
const MENU_ICON_DELETE = toMenuIcon(<DeleteOutlined/>);

/**
 * 未落库的新行主键。
 *
 * 必须唯一且**跨三张表一致**：这张表插入一行后，配色 / 配码按同一个 key 各插一行。
 * 用模块级自增而不是行号 —— 反复增删、上下插行都不会撞。
 */
let draftRowSeq = 0;
const nextDraftRowKey = (): string => {
    draftRowSeq += 1;
    return `draft-${draftRowSeq}`;
};

/** 新建空白行：只给行号与临时主键，其余字段留给用户填 */
const createItemRow = (rowNo: string): BomMatrixRow => ({
    PackBomMatrixDetailID: nextDraftRowKey(),
    VRowNo: rowNo,
    MaterialVID: '',
    BeginDate: undefined,
    EndDate: undefined,
});

/**
 * 子项物料表。
 *
 * 行数据**自己持有一份**（`rows` state）：这张表编辑的字段只有它关心，
 * 增删改通过 `onRowEvent` 告诉父级，父级再命令配色 / 配码各自改自己的行 ——
 * 三张表各存各的，跨表只对齐「同一个 key 是同一行」。
 *
 * 纯视图：列定义在 `./columns.ts`（界面桥读的是同一份），表格实例与命令 API 通过 ref 交出去。
 */
const BomMatrixItemView = React.forwardRef<BomMatrixGridApi, BomMatrixItemProps>(
    ({items, isEditable, onRowEvent}, ref) => {

        /*
         * 行数据 = 「按明细派生 + 本地改动优先」：用户一编辑就落在本地，派生结果再算也不顶掉；
         * 换一份矩阵（`items` 引用变了）本地改动作废，自动回到新派生出来的行。
         */
        const baseRows = useMemo(() => toItemRows(items), [items]);
        const {rows, commit} = useEditableRows(baseRows, items);
        const tableRef = useRef<GridTableApi | null>(null);

        const editableFields = useMemo(() => {
            if (!isEditable) {
                return undefined;
            }
            return {
                'ProjectMaterial': 'auto',
                'MaterialCode': MATERIAL_EDITOR,
                'VFree1Name': MATERIAL_VFREE_EDITOR,
                'VFree4Name': MATERIAL_VFREE_EDITOR,
                'VFree5Name': MATERIAL_VFREE_EDITOR,
                'VFree8Name': MATERIAL_VFREE_EDITOR,
                'VFree9Name': MATERIAL_VFREE_EDITOR,
            }
        }, [isEditable])

        /**
         * 把一条物料的基础资料回填到当前行。
         *
         * 弹窗选中和「直接输入编码回车」两条入口共用：换物料时，编码之外的
         * 名称/版本/规格/型号/单位/换算率也必须一起换掉，否则行里会出现
         * 「编码是新的、名称还是旧的」这种半截数据。
         *
         * 回填走编辑器的 `setFields`，落库时仍是逐字段的 `change_cell_value`，
         * 所以同步给另外两张表的也是这些字段（见 handleCellValueChange）。
         */
        const applyMaterial = useCallback((activeRow: EditorRowAccessor | null, material: NCMaterial) => {
            const updateFields: Record<string, unknown> = {
                MaterialVID: material.pk_material,
                MaterialCode: material.code,
                MaterialName: material.name,
                MaterialVersion: material.version,
                MaterialSpec: material.materialspec,
                MaterialType: material.materialtype,
                CMeasureid: material.pk_measdoc,
                CMeasure: material.measdoc,
            }
            if (material.materialconvert && material.materialconvert.length > 0) {
                updateFields.Cassmeasure = material.materialconvert[0].measdoc;
                updateFields.Cassmeasureid = material.materialconvert[0].pk_measdoc;
                updateFields.VChangerate = material.materialconvert[0].measrate;
            }
            activeRow?.setFields(updateFields);
            activeRow?.endEdit();
        }, [])

        const applyVFree = useCallback((activeRow: EditorRowAccessor | null, vfree: NCMaterialVFree) => {
            const updateFields: Record<string, unknown> = {}
            const fieldName = toStringOrEmpty(activeRow?.field);
            const field = fieldName?.replace('Name', '');
            if (fieldName && field) {
                updateFields[fieldName] = vfree.name;
                updateFields[field] = vfree.pk_defdoc;
            }
            activeRow?.setFields(updateFields);
            activeRow?.endEdit();
        }, [])

        /**
         * 用户没开弹窗、直接在单元格里输入编码回车：按编码查一次物料，查到就回填整行。
         *
         * 查不到只提示、不动这一行的其他字段（用户可能就是要填一个临时编码）。
         */
        const handleInputCode = useCallback(async (code: string, activeRow: EditorRowAccessor) => {
            try {
                const result = await ncMaterialApi.query({Code: code});
                const materials = result.data ?? [];
                const material = materials.find((item) => item.code === code) ?? materials[0];
                if (!material) {
                    void message.warning(`未找到物料：${code}`);
                    return;
                }
                applyMaterial(activeRow, material);
            } catch (error) {
                void message.error(ErrorMessage(error, '物料查询失败'));
            }
        }, [applyMaterial])

        /**
         * 按行标识改若干字段（编辑单元格 / 外部命令都走这里）。
         *
         * ⚠️ **原地合并，不要 `{...row, ...fields}` 造新对象**：编辑器回填（`setFields` 连写多列、
         * 「输入编码回车 → 异步查料 → 回填」）是按**行对象身份**在数据源里定位那一行的
         * （`resolveLiveRecordIndex`）。把对象换掉，回填时找不到行，就只写进一个已被丢弃的对象，
         * 界面和数据都不动 —— 表现为「编辑物料没用」。
         *
         * 数组仍然换新引用：GridTable 靠 records 的引用变化更新数据源，React 也才重渲染。
         */
        const updateRow = useCallback((rowKey: string, fields: Record<string, unknown>) => {
            commit((prev) => prev.map((row) => {
                if (rowKeyOf(row) !== rowKey) return row;
                Object.assign(row, fields);
                return row;
            }));
            onRowEvent?.({type: 'update', rowKey, fields});
        }, [commit, onRowEvent]);

        /**
         * 插入一行：`afterKey` 给了就插到那行后面，否则追加到末尾。
         *
         * 行主键由**调用方造好**（`draft-N`）：父级要把同一行的物料字段同步给配色 / 配码，
         * key 必须在这三张表里是同一个。
         */
        const addRow = useCallback((row: Record<string, unknown>, afterKey?: string) => {
            commit((prev) => {
                const anchor = afterKey ? prev.findIndex((item) => rowKeyOf(item) === afterKey) : -1;
                const index = anchor >= 0 ? anchor + 1 : prev.length;
                const next = [...prev];
                next.splice(index, 0, row as BomMatrixRow);
                return next;
            });
            onRowEvent?.({type: 'insert', row, afterKey});
        }, [commit, onRowEvent]);

        /** 按行标识删一行 */
        const removeRow = useCallback((rowKey: string) => {
            commit((prev) => prev.filter((row) => rowKeyOf(row) !== rowKey));
            onRowEvent?.({type: 'remove', rowKey});
        }, [commit, onRowEvent]);

        /**
         * 右键「新增行」：在本行**下方**插一行；没有锚点行（右键落在空白/表头）就追加到末尾。
         *
         * 入参是**行主键**而不是行号：GridTable 回传的 rowIndex 是「当前 records 数组里的位置」，
         * 表格接管排序后它与数据顺序对不上，按主键找位置才是用户右键的那一行。
         *
         * ⚠️ 上下两行的行号按**数据顺序**取（不是屏幕顺序）：本表默认不排序，两者一致；
         * 一旦用户点了列头排序，视觉上的上下与数据里的上下就分叉了，此时「插在数据的哪一格」
         * 比「看起来插在哪」更重要 —— 行号本来就是排序键。
         */
        const insertRowBelow = useCallback((anchorRowKey?: string) => {
            const anchor = anchorRowKey
                ? rows.findIndex((row) => rowKeyOf(row) === anchorRowKey)
                : -1;
            const at = anchor >= 0 ? anchor + 1 : rows.length;
            const rowNo = nextRowNo(rows[at - 1]?.VRowNo, rows[at]?.VRowNo);
            if (rowNo === null) {
                void message.warning('无法计算新行号：上下两行的行号相同或顺序不对，请先调整行号');
                return;
            }
            addRow(createItemRow(rowNo), anchorRowKey);
        }, [rows, addRow]);

        /**
         * 单元格编辑完成：写回自己的行数据，并通知父级同步给配色 / 配码
         * （它们要跟着换物料名、编码、行号 —— 按同一个行标识落到各自的行上）。
         */
        const handleCellValueChange = useCallback(
            ({field, rowIndex, record, value}: GridTableCellValueChangeInfo) => {
                // 定位一律用行主键，退回 rowIndex：表格排序后 rowIndex 与数据顺序对不上
                const rowKey = rowKeyOf(record) || rowKeyOf(rows[rowIndex]);
                if (!rowKey) return;
                updateRow(rowKey, {[field]: value});
            },
            [rows, updateRow],
        );

        /** 右键菜单：**只在编辑模式下有效** —— 只读时返回空数组，vtable 那边会转成 undefined（不弹菜单） */
        const menu = useMemo<GridTableMenuConfig>(() => ({
            contextMenuItems: ({record}) => {
                if (!isEditable) return [];
                const rowKey = rowKeyOf(record);
                return alignMenuIcons([
                    {text: '新增行', menuKey: 'insertRow', icon: MENU_ICON_ADD},
                    ...(rowKey ? [{text: '删除行', menuKey: 'deleteRow', icon: MENU_ICON_DELETE}] : []),
                ]);
            },
            onClick: ({menuKey, record}) => {
                // 菜单配置是「弹菜单那一刻」解析的，弹出来之后再切回只读，点下去也不该改数据
                if (!isEditable) return;
                const rowKey = rowKeyOf(record);
                if (menuKey === 'insertRow') insertRowBelow(rowKey || undefined);
                else if (menuKey === 'deleteRow' && rowKey) removeRow(rowKey);
            },
        }), [isEditable, insertRowBelow, removeRow]);

        /*
         * 对外交「取值函数 + 行级命令」：`getRows` 闭包读 state（每次 rows 变重建 handle，
         * ref.current 始终是最新的那份），别把 state 快照进 handle。
         */
        useImperativeHandle(ref, () => ({
            table: () => tableRef.current,
            getRows: () => rows,
            addRow,
            removeRow,
            updateRow,
        }), [rows, addRow, removeRow, updateRow]);

        return (
            <>
                <GridTable ref={tableRef} columns={ITEM_COLUMNS} editableFields={editableFields} records={rows}
                           rowKey={'PackBomMatrixDetailID'}
                           rowNumber={false} menu={menu}
                           onCellValueChange={handleCellValueChange}
                           multiSelect={false} widthMode={'autoWidth'}/>
                <NCMaterialModal open={false}
                                 isEditor={true}
                                 onSelect={(record: NCMaterial, activeRow: EditorRowAccessor | null) => {
                                     applyMaterial(activeRow, record);
                                 }}
                                 onInput={(code, activeRow) => {
                                     void handleInputCode(code, activeRow);
                                 }}/>
                <NCMaterialVFreeModal open={false} isEditor={true}
                                      viewProps={(row) => {
                                          if (!row) {
                                              return {materialVID: "", vfreeField: ""}
                                          }
                                          const rowField = row.field.toLowerCase().replace('name', '')
                                          return {
                                              materialVID: toStringOrEmpty(row.record?.MaterialVID),
                                              vfreeField: rowField
                                          };
                                      }}
                                      onSelect={(record: NCMaterialVFree, activeRow: EditorRowAccessor | null) => {
                                          applyVFree(activeRow, record);
                                      }}
                                      onInput={(code, activeRow) => {
                                          console.log("onInput", code, activeRow);
                                      }}/>
            </>
        );
    });

export default BomMatrixItemView;
