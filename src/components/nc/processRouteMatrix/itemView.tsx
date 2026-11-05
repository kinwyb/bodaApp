import React, {useCallback, useEffect, useImperativeHandle, useMemo, useRef} from 'react';
import {message} from 'antd';
import {DeleteOutlined, PlusOutlined} from '@ant-design/icons';
import type {ProcessRouteMatrixDetail} from '@/api/schemas/nc/processRouteMatrix.ts';
import {
    GridTable,
    type GridTableApi,
    type GridTableCellValueChangeInfo,
    type GridTableMenuConfig,
} from '@/components/grid-table';
import {alignMenuIcons, toMenuIcon} from '@/components/grid-table/menuIcon';
import {PROCESS_ITEM_COLUMNS} from './columns.ts';
import {PROCESS_MOVE_TYPE_EDITOR} from './common.ts';
import {nextRowNo} from './rowNo.ts';
import {
    type ProcessRouteRow,
    createItemRow,
    rowHasProcess,
    rowKeyOf,
    toItemRows,
} from './rows.ts';
import type {ProcessRouteGridApi} from './gridApi.ts';
import {useEditableRows} from './useEditableRows.ts';

export type ProcessRouteItemViewProps = {
    /**
     * 初始行数据：只在**首次挂载**时与换矩阵时用。
     *
     * 用户一编辑，改动就留在组件自己的 state 里；`items` 引用变了（换了另一份矩阵）
     * 本地改动作废、按新明细重铺 —— 判定见 `useEditableRows`。
     */
    items: ProcessRouteMatrixDetail[];
    /** 能不能改：只读时整张表不挂编辑器，勾选框也是灰的 */
    isEditable: boolean;
};

/* 菜单图标在模块级渲染一次（`toMenuIcon` 走 `renderToStaticMarkup`，别放进渲染路径） */
const MENU_ICON_ADD = toMenuIcon(<PlusOutlined/>);
const MENU_ICON_DELETE = toMenuIcon(<DeleteOutlined/>);

/** 底部补空行时用的行号：接着末尾那行走（10、20、30 → 40），空表给 10 */
const blankRowNoAfter = (row: ProcessRouteRow | undefined): string =>
    nextRowNo(row?.VRowNo, undefined) ?? '10';

/**
 * 工序明细表（唯一可编辑的一张）。
 *
 * 纯视图：列定义在 `./columns.ts`（界面桥读的是同一份），表格实例与行级命令通过 ref 交出去。
 * 行数据自己持有一份（`useEditableRows`），父级保存时通过 `readRows('items')` 取 ——
 * 那里拿到的是**含未保存改动**的行，不是接口那份。
 *
 * 与包装 BOM 的子项物料表相比，这里没有物料 / 单位 / 供应商那套弹窗编辑器：
 * 工艺行填的是工序名与时间，全部能在格子里直接改（`'auto'` 编辑器 + 一个枚举下拉）。
 * 将来接「工序档案」弹窗时，只改 `editableFields` 里的 `CrcCode` 一项，
 * 并把弹窗的 `onSelect` 回填成 `{CrcCode, CrcName, CrcID}` 即可，表格本身不用动。
 */
const ProcessRouteItemView = React.forwardRef<ProcessRouteGridApi, ProcessRouteItemViewProps>(
    ({items, isEditable}, ref) => {

        const baseRows = useMemo(() => toItemRows(items), [items]);
        const {rows, commit} = useEditableRows<ProcessRouteRow>(baseRows, items);
        const tableRef = useRef<GridTableApi | null>(null);

        /**
         * 各列用哪个编辑器。
         *
         * - `'auto'`：按列 `dataType` 自动挑（数值 → InputNumber、日期 → DatePicker、文本 → Input）；
         * - `true`：布尔列不挂编辑器，GridTable 直接放开原生勾选框，单击切换并写回 1 / 0；
         * - 具名实例：枚举列用注册好的下拉（见 `./common.ts`）。
         *
         * 审核三列（`VDef5` / `VDef6` / `VDef7`）刻意不在表里：审核是后端流程的动作。
         */
        const editableFields = useMemo<Record<string, string | true> | undefined>(() => {
            if (!isEditable) return undefined;
            return {
                CrcCode: 'auto',
                CrcName: 'auto',
                CrcDesc: 'auto',
                WorkStation: 'auto',
                MainProcess: true,
                CheckPoint: true,
                CountPoint: true,
                HandOverPoint: true,
                OutProcess: true,
                AllowAdd: true,
                MixDeliverNum: 'auto',
                VDef9: 'auto',
                WorkTime: 'auto',
                VDef11: 'auto',
                VDef12: 'auto',
                VDef13: 'auto',
                ProcessMoveType: PROCESS_MOVE_TYPE_EDITOR,
                CraftNote: 'auto',
                EffectDate: 'auto',
                InvalidDate: 'auto',
            };
        }, [isEditable]);

        /**
         * 插入一行：`afterKey` 给了就插到那行后面，否则追加到末尾。
         *
         * ⚠️ 定义得比用它的命令早（`insertRowBelow` 在下面）：这些是 `const`，
         * 先用后定义会在渲染期撞 TDZ。
         */
        const addRow = useCallback((row: Record<string, unknown>, afterKey?: string) => {
            commit((prev) => {
                const anchor = afterKey ? prev.findIndex((item) => rowKeyOf(item) === afterKey) : -1;
                const index = anchor >= 0 ? anchor + 1 : prev.length;
                const next = [...prev];
                next.splice(index, 0, row as ProcessRouteRow);
                return next;
            });
        }, [commit]);

        /** 按行标识删一行 */
        const removeRow = useCallback((rowKey: string) => {
            commit((prev) => prev.filter((row) => rowKeyOf(row) !== rowKey));
        }, [commit]);

        /**
         * **编辑模式下末尾永远留一行空白**，等用户填第一道工序。
         *
         * 两个触发时机（与包装 BOM 的子项物料表同一套，理由见那边的注释）：
         * - 进编辑：末尾还是数据行就补一行空行；从编辑切回只读时，末尾那行还没填工序就收掉
         *   （它是「等输入」的占位，不是明细，不该跟着保存一起提交）；
         * - 明细换了（换一份矩阵）：表格按新输入重铺，末尾的空行跟着丢了，得再补回来。
         *
         * 只按「外部输入」（`isEditable` / `items`）的引用判断，**不看 `rows` 自己**：
         * 否则用户刚删掉空行就被立刻补回来（像删不掉），StrictMode 双跑还会一次补两行。
         */
        const prevEditableRef = useRef<boolean | null>(null);
        const prevItemsRef = useRef<ProcessRouteMatrixDetail[] | null>(null);
        useEffect(() => {
            const editableChanged = prevEditableRef.current !== isEditable;
            const itemsChanged = prevItemsRef.current !== items;
            const wasEditable = prevEditableRef.current === true;
            prevEditableRef.current = isEditable;
            prevItemsRef.current = items;
            if (!editableChanged && !itemsChanged) return;
            const last = rows[rows.length - 1];
            // 判据是「有没有工序」，不看行号：用户可能先填了操作要求再填工序名，那还是同一行
            const hasProcess = last ? rowHasProcess(last) : false;
            if (!isEditable) {
                if (editableChanged && wasEditable && last && !hasProcess) {
                    removeRow(rowKeyOf(last));
                }
                return;
            }
            if (!last || hasProcess) {
                addRow(createItemRow(blankRowNoAfter(last)));
            }
        }, [isEditable, items, rows, addRow, removeRow]);

        /**
         * 按行标识改若干字段（编辑单元格 / 外部命令都走这里）。
         *
         * ⚠️ **原地合并，不要 `{...row, ...fields}` 造新对象**：编辑器回填是按**行对象身份**
         * 在数据源里定位那一行的，把对象换掉，回填就写进一个已被丢弃的对象 ——
         * 界面和数据都不动（表现为「编辑没生效」）。数组仍然换新引用，表格靠它更新数据源。
         */
        const updateRow = useCallback((rowKey: string, fields: Record<string, unknown>) => {
            commit((prev) => prev.map((row) => {
                if (rowKeyOf(row) !== rowKey) return row;
                Object.assign(row, fields);
                return row;
            }));
        }, [commit]);

        /**
         * 右键「新增行」：在本行**下方**插一行；没有锚点行（右键落在空白 / 表头）就追加到末尾。
         *
         * 入参是**行主键**而不是 rowIndex：GridTable 回传的 rowIndex 是「当前 records 数组里的位置」，
         * 表格接管排序后它与数据顺序对不上，按主键找位置才是用户右键的那一行。
         */
        const insertRowBelow = useCallback((anchorRowKey?: string) => {
            const anchor = anchorRowKey ? rows.findIndex((row) => rowKeyOf(row) === anchorRowKey) : -1;
            const at = anchor >= 0 ? anchor + 1 : rows.length;
            const rowNo = nextRowNo(rows[at - 1]?.VRowNo, rows[at]?.VRowNo);
            if (rowNo === null) {
                void message.warning('无法计算新行号：上下两行的行号相同或顺序不对，请先调整行号');
                return;
            }
            addRow(createItemRow(rowNo), anchorRowKey);
        }, [rows, addRow]);

        /** 单元格编辑完成：写回自己的行数据（这张表没有要同步的第二张表） */
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
                // 菜单是「弹出来那一刻」解析的：弹出来后再切回只读，点下去也不该改数据
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
            <GridTable ref={tableRef} columns={PROCESS_ITEM_COLUMNS} editableFields={editableFields}
                       records={rows} rowKey={'ProcessRouteMatrixDetailID'}
                       rowNumber={false} menu={menu}
                       onCellValueChange={handleCellValueChange}
                       multiSelect={false} widthMode={'autoWidth'}/>
        );
    });

export default ProcessRouteItemView;
