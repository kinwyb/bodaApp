import React, {useCallback, useImperativeHandle, useMemo, useRef, useState} from "react";
import type {BomMatrix, BomMatrixDetail} from "@/api/schemas/nc/bomMatrix.ts";
import {Button, Tabs, type TabsProps} from "antd";
import BomMatrixItemView from "./itemView.tsx";
import BomMatrixSizeView from "./sizeView.tsx";
import BomMatrixColorView from "./colorView.tsx";
import {bomMatrixSectionLabel} from "./sections.ts";
import type {GridTableApi} from "@/components/grid-table";
import type {BomMatrixGridApi, BomMatrixRowEvent} from "./gridApi.ts";
import {toColorRows, toSizeRows} from "./rows.ts";

export type BomMatrixViewProps = {
    bomMatrix: BomMatrix;
    tabs?: TabsProps['items'];
    isEditMode?: boolean;
    /**
     * 当前标签页（**受控**）。
     *
     * 刻意不做「不传就自己管」的非受控降级：界面桥必须如实回答「用户此刻在看哪一张表」，
     * 一旦控件内部另存一份 activeKey，两边就会静默分叉 —— 页面以为在子项物料、
     * 屏幕上其实是配色。宁可让调用方多写一行 state。
     */
    activeKey: string;
    onActiveKeyChange: (key: string) => void;
};

/** 交给外面的能力：读表格实例、读行数据 */
export type BomMatrixViewApi = {
    /**
     * 取某个标签页的表格实例。
     *
     * 返回 null = 这一页**还没渲染过**（antd Tabs 是懒挂载：没被激活过的面板不挂载）。
     * 界面桥据此在快照里标 `readable: false`，而不是拿一张 0 行的空表冒充「没有数据」。
     */
    readTable: (section: string) => GridTableApi | null;
    /**
     * 取某个标签页**当前的行数据**（含未保存的编辑）。
     *
     * 与 `readTable` 的分工：那个给表格实例（带排序/筛选/懒挂载），这个直接给 state 里那份原始行，
     * 保存时该用它（表格排序过也不影响这里的顺序 = 数据顺序）。
     *
     * 面板**没挂载过**时按「当前明细 + 接口数据」现算一份：没挂载 = 用户没编辑过那张表，
     * 现算的结果与它第一次打开时会看到的完全一致。
     */
    readRows: (section: string) => Record<string, unknown>[];
};

/**
 * 包装 BOM 矩阵：三个标签页是**同一批子项行的三种看法**（子项物料 / 配色 / 配码），
 * 但**各自持有自己的行数据**：一张表编辑的字段只有它关心，表与表之间靠行级命令同步。
 *
 * 这一层是唯一的编排者：子项物料表发出**行事件**（插入 / 删除 / 更新），
 * 它按同一个行标识命令配色、配码各自改自己的行。视图之间互不认识，也不共享行对象 ——
 * 共享对象时「一方改了另一方要不要重绘」说不清；命令式则各改各的 state，来源单一。
 *
 * 这一层不认识界面桥：它只把「当前是哪个标签页」交给外面，把三张表的实例与行数据交出去。
 */
export const BomMatrixView = React.forwardRef<BomMatrixViewApi, BomMatrixViewProps>((
    {bomMatrix, tabs, isEditMode, activeKey, onActiveKeyChange},
    ref,
) => {

    const [isEdit, setIsEdit] = useState(isEditMode ?? false);
    const itemsRef = useRef<BomMatrixGridApi | null>(null);
    const colorsRef = useRef<BomMatrixGridApi | null>(null);
    const sizesRef = useRef<BomMatrixGridApi | null>(null);

    /** 明细（接口那份）：三张表**首次挂载**时都用它铺行 */
    const detailItems = useMemo<BomMatrixDetail[]>(() => bomMatrix.Detail ?? [], [bomMatrix.Detail]);

    /**
     * 子项物料表的行事件 → 命令配色 / 配码按同一个行标识各改各的行。
     *
     * 面板没挂载（`ref.current` 为 null）就直接跳过：它首次挂载时用**当前明细**初始化，
     * 天然是最新的，不必补放历史动作 —— 这是懒挂载下命令式同步唯一要处理的边界。
     */
    const syncProjections = useCallback((event: BomMatrixRowEvent) => {
        [colorsRef.current, sizesRef.current].forEach((api) => {
            if (!api) return;
            if (event.type === 'insert') {
                // 复制一份：三张表各持各的行对象，别共享引用
                api.addRow({...event.row}, event.afterKey);
            } else if (event.type === 'remove') {
                api.removeRow(event.rowKey);
            } else {
                api.updateRow(event.rowKey, event.fields);
            }
        });
    }, []);

    /**
     * 明细的**当前**值：子项物料表 state 里那份（含未保存的增删改）。
     *
     * 三处用它：① 保存时兜底；② 配码 / 配色**首次挂载**时铺行（它们懒挂载，
     * 挂载前发生的增删改收不到命令，只能按当前明细重铺）；③ 某张表没挂载时的 readRows。
     *
     * 子项物料表一定挂载过（默认页签），所以 `itemsRef` 不会是空。
     */
    const currentDetail = useCallback(
        (): BomMatrixDetail[] => (itemsRef.current?.getRows() ?? detailItems) as BomMatrixDetail[],
        [detailItems],
    );

    /*
     * 只暴露取值函数：桥与保存流程都在「被调用的那一刻」才读，
     * 所以面板切换、表格重建都不用重新装配。
     */
    useImperativeHandle(ref, () => ({
        readTable: (section: string) => {
            if (section === 'items') return itemsRef.current?.table() ?? null;
            if (section === 'colors') return colorsRef.current?.table() ?? null;
            if (section === 'sizes') return sizesRef.current?.table() ?? null;
            return null;
        },
        readRows: (section: string) => {
            if (section === 'items') return itemsRef.current?.getRows() ?? detailItems;
            // 没挂载过：用它「第一次打开时会看到的那份」现算，与真正的表格数据等价
            if (section === 'colors') return colorsRef.current?.getRows() ?? toColorRows(bomMatrix, currentDetail());
            if (section === 'sizes') return sizesRef.current?.getRows() ?? toSizeRows(bomMatrix, currentDetail());
            return [];
        },
    }), [bomMatrix, currentDetail, detailItems]);

    /*
     * 依赖里必须带 `isEdit`：能不能编辑是各表的属性，重建元素才能把新值传下去。
     * 三张表都重新创建元素没关系 —— key 不变，React 只更新不重挂载，各自的行数据都还在。
     */
    const items = useMemo<TabsProps['items']>(() => [
        {
            label: bomMatrixSectionLabel('items'),
            key: 'items',
            children: <BomMatrixItemView ref={itemsRef} items={detailItems} isEditable={isEdit}
                                         onRowEvent={syncProjections}/>,
        },
        {
            label: bomMatrixSectionLabel('colors'),
            key: 'colors',
            children: <BomMatrixColorView ref={colorsRef} matrix={bomMatrix} items={detailItems}
                                          getItems={currentDetail} isEditable={isEdit}/>,
        },
        {
            label: bomMatrixSectionLabel('sizes'),
            key: 'sizes',
            children: <BomMatrixSizeView ref={sizesRef} matrix={bomMatrix} items={detailItems}
                                         getItems={currentDetail} isEditable={isEdit}/>,
        }, ...(tabs ?? [])], [bomMatrix, currentDetail, detailItems, isEdit, syncProjections, tabs]);

    return (
        <>
            <Button title={'编辑'} onClick={() => {
                setIsEdit(!isEdit);
            }}>编辑 </Button>
            <Tabs
                className="grid-table-expand-tabs page-tabs-fill"
                activeKey={activeKey}
                onChange={onActiveKeyChange}
                size={'small'}
                items={items}
            />
        </>
    );
});

export default BomMatrixView;
