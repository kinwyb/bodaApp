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
import {scopedEditorKey, useEditorScope} from './editorScope.ts';
import NCWorkProcessModal, {WORKPROCESS_EDITOR} from '@/components/nc/workProcessModal.tsx';
import {
    emptyWorkProcessFields,
    matchWorkProcess,
    workProcessFields,
} from '@/components/nc/workProcess.ts';
import {ensureWorkProcesses} from '@/components/nc/workProcessCache.ts';
import type {NCWorkProcess} from '@/api/schemas/nc/NCBase.ts';
import type {EditorRowAccessor} from '@/components/grid-table/editors/register.ts';
import {toStringOrEmpty} from '@/utils';

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
 * 与包装 BOM 的子项物料表相比，这里只有一处弹窗编辑器：**工序编码**（`CrcCode`）挂
 * `NCWorkProcessModal` —— 工序是基础档案，手填编码等于给后端喂脏数据。
 * 其余列填的是时间与属性，全部能在格子里直接改（`'auto'` 编辑器 + 一个枚举下拉）。
 */
const ProcessRouteItemView = React.forwardRef<ProcessRouteGridApi, ProcessRouteItemViewProps>(
    ({items, isEditable}, ref) => {

        const baseRows = useMemo(() => toItemRows(items), [items]);
        const {rows, commit} = useEditableRows<ProcessRouteRow>(baseRows, items);
        const tableRef = useRef<GridTableApi | null>(null);

        /**
         * 本实例专属的编辑器名。
         *
         * **不能用模块常量**：同一个页面常常同时存在两张工序表（页面上只读一张、编辑弹窗里
         * 可编辑一张），而 vtable 的编辑器注册是全局同名先到先得 —— 后挂载的那张会静默拿到
         * 前一张的回调闭包，于是「选了工序却回填到别人家的行上」。详见 `./editorScope.ts`。
         */
        const editorScope = useEditorScope();
        const workProcessEditor = useMemo(
            () => scopedEditorKey(WORKPROCESS_EDITOR, editorScope),
            [editorScope],
        );

        /**
         * 各列用哪个编辑器。
         *
         * - `'auto'`：按列 `dataType` 自动挑（数值 → InputNumber、日期 → DatePicker、文本 → Input）；
         * - `true`：布尔列不挂编辑器，GridTable 直接放开原生勾选框，单击切换并写回 1 / 0；
         * - 具名实例：枚举列用注册好的下拉（见 `./common.ts`），工序编码用基本工序选择器。
         *
         * 审核三列（`VDef5` / `VDef6` / `VDef7`）不挂编辑器：审核是后端流程的动作，
         * 界面上只读展示（`VDef5` 是勾选框样式，但点不动）。
         */
        const editableFields = useMemo<Record<string, string | true> | undefined>(() => {
            if (!isEditable) return undefined;
            return {
                // 工序编码：双击是输入框，点搜索按钮打开基本工序列表；直接输入回车走本地筛
                CrcCode: workProcessEditor,
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
        }, [isEditable, workProcessEditor]);

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
         * 刚给**末尾那行**填好工序 → 底部再补一行等下一笔。
         *
         * 只在末尾发生时才补：在中间行选工序时，底部本来就有空行，再加就多一行。
         *
         * 用行对象上的主键判断，不依赖闭包里 `rows` 的位置（与包装 BOM 的 `applyMaterial`
         * 同一套写法）：`setFields` 会派发变更、`rows` 下一帧才更新，这里读到的是旧闭包，
         * 但「哪一行是末尾」在选工序前后没变。
         */
        const ensureBlankAfter = useCallback((rowKey: string) => {
            const last = rows[rows.length - 1];
            if (!last || rowKeyOf(last) !== rowKey) return;
            addRow(createItemRow(blankRowNoAfter(last)));
        }, [rows, addRow]);

        /**
         * 选中一道基本工序：把工序档案里那一组字段一起回填到当前行。
         *
         * 不止编码 + 名称：操作要求、检测点 / 报告点 / 交接点都由档案带过来
         * （`workProcessFields`，与表单控件共用同一份口径）—— 少回填一个，
         * 保存出来的工艺路线就缺那一条标记。
         *
         * 回填完**若填的是底部那行空行，再补一行**：这张表进编辑时就靠「末尾永远有一行空的」
         * 来连续录入，填满一行不补，用户就得每次右键「新增行」。
         */
        const applyWorkProcess = useCallback((process: NCWorkProcess, activeRow: EditorRowAccessor | null) => {
            activeRow?.setFields(workProcessFields(process));
            activeRow?.endEdit();
            const rowKey = rowKeyOf(activeRow?.record);
            if (rowKey) ensureBlankAfter(rowKey);
        }, [ensureBlankAfter]);

        /**
         * 用户没开弹窗、直接在工序格里输入后回车。
         *
         * 工序**没有按编码 / 名称查一条的接口**，所以这里不去查库，而是在
         * `workProcessCache` 的全量列表里本地筛（`matchWorkProcess`）：
         * 全等优先、其次包含匹配，**唯一命中才回填**；多条 / 零条只提示，
         * 让用户点格子右侧的搜索按钮去弹窗里挑（替用户选第一条等于赌运气）。
         */
        const handleInputWorkProcess = useCallback(async (input: string, activeRow: EditorRowAccessor) => {
            const list = await ensureWorkProcesses();
            if (list.length === 0) {
                void message.warning('基本工序档案没取到，请点格子右侧的搜索按钮选择');
                return;
            }
            const matched = matchWorkProcess(list, input);
            if (matched.kind === 'single') {
                applyWorkProcess(matched.process, activeRow);
                return;
            }
            if (matched.kind === 'many') {
                void message.info(`匹配到 ${matched.candidates} 道工序，请点搜索按钮在弹窗里选`);
                return;
            }
            void message.warning(`没有编码 / 名称匹配「${input}」的工序`);
        }, [applyWorkProcess]);

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
                /*
                 * 工序编码被清空：档案带出来的那一组字段**一起清**（与 `workProcessFields` 成对）。
                 *
                 * 只清编码会留下一行「没有工序、却带着上一道工序的名称 / 操作要求 / 检测点」的
                 * 假数据 —— 保存下去之后，下次打开就分不清这一行到底是什么。与包装 BOM 里
                 * 「清空物料 → 名称 / 版本 / 规格一起清」是同一个口径。
                 *
                 * 一次 `updateRow` 写全：分两次写会让表格多派发一次变更、多绘一遍。
                 */
                if (field === 'CrcCode' && toStringOrEmpty(value).trim() === '') {
                    updateRow(rowKey, {CrcCode: '', ...emptyWorkProcessFields()});
                    return;
                }
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
            <>
                <GridTable ref={tableRef} columns={PROCESS_ITEM_COLUMNS} editableFields={editableFields}
                           records={rows} rowKey={'ProcessRouteMatrixDetailID'}
                           rowNumber={false} menu={menu}
                           onCellValueChange={handleCellValueChange}
                           multiSelect={false} widthMode={'autoWidth'}/>
                {/*
                 * 工序选择弹窗：`isEditor` 模式下它自己把输入编辑器注册到 `workProcessEditor`
                 * 这个名字上（`CrcCode` 列指向它），所以不需要额外的 open 状态 ——
                 * 双击格子出输入框，点搜索按钮/点放大镜就打开它。
                 */}
                <NCWorkProcessModal open={false}
                                    isEditor={true}
                                    editorKey={workProcessEditor}
                                    onSelect={applyWorkProcess}
                                    onInput={(input, activeRow) => {
                                        void handleInputWorkProcess(input, activeRow);
                                    }}/>
            </>
        );
    });

export default ProcessRouteItemView;
