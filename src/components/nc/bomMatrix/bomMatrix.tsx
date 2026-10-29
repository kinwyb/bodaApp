import React, {useImperativeHandle, useMemo, useRef, useState} from "react";
import type {BomMatrix} from "@/api/schemas/nc/bomMatrix.ts";
import {Button, Tabs, type TabsProps} from "antd";
import BomMatrixItemView from "./itemView.tsx";
import BomMatrixSizeView from "./sizeView.tsx";
import BomMatrixColorView from "@/components/nc/bomMatrix/colorView.tsx";
import {bomMatrixSectionLabel} from "./sections.ts";
import type {GridTableApi} from "@/components/grid-table";

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

/** 交给外面的读能力：只读，不写 —— 写属于业务，不归控件 */
export type BomMatrixViewApi = {
    /**
     * 取某个标签页的表格实例。
     *
     * 返回 null = 这一页**还没渲染过**（antd Tabs 是懒挂载：没被激活过的面板不挂载）。
     * 界面桥据此在快照里标 `readable: false`，而不是拿一张 0 行的空表冒充「没有数据」。
     */
    readTable: (section: string) => GridTableApi | null;
};

/**
 * 包装 BOM 矩阵：三个标签页是**同一批子项行的三种看法**（子项物料 / 配色 / 配码）。
 *
 * 这一层不认识界面桥：它只把「当前是哪个标签页」交给外面，把三个表格实例通过 ref 交出去。
 * 桥的组装在页面侧（见 `@/pages/views/V0277/V0354/bridged`），所以这个控件在没有 agent 的
 * 场景里也能原样复用。
 */
export const BomMatrixView = React.forwardRef<BomMatrixViewApi, BomMatrixViewProps>((
    {bomMatrix, tabs, isEditMode, activeKey, onActiveKeyChange},
    ref,
) => {

    const [isEdit, setIsEdit] = useState(isEditMode ?? false);
    const itemsRef = useRef<GridTableApi | null>(null);
    const colorsRef = useRef<GridTableApi | null>(null);
    const sizesRef = useRef<GridTableApi | null>(null);

    /*
     * 只暴露取值函数：桥在「被调用的那一刻」才读，所以面板切换、表格重建都不用重新装配。
     * 认不出的键返回 null —— 外部追加的标签页（`tabs` 属性）不在桥里，也不该在。
     */
    useImperativeHandle(ref, () => ({
        readTable: (section: string) => {
            if (section === 'items') return itemsRef.current;
            if (section === 'colors') return colorsRef.current;
            if (section === 'sizes') return sizesRef.current;
            return null;
        },
    }), []);

    /*
     * 用 useMemo 而不是「effect 里 setItems」：后者每次依赖变化都多渲染一轮，
     * 而且 items 会短暂停在上一份数据上（切编辑态时尤其明显）。
     *
     * 依赖里必须带 `isEdit`：子项物料表能不能编辑是它的属性，重建元素才能把新值传下去。
     * 三张表都重新创建元素没关系 —— key 不变，React 只更新不重挂载，表格实例（含 ref）都还在。
     */
    const items = useMemo<TabsProps['items']>(() => [
        {
            label: bomMatrixSectionLabel('items'),
            key: 'items',
            children: <BomMatrixItemView ref={itemsRef} items={bomMatrix.Detail ?? []} isEditable={isEdit}/>,
        },
        {
            label: bomMatrixSectionLabel('colors'),
            key: 'colors',
            children: <BomMatrixColorView ref={colorsRef} bomMatrix={bomMatrix}/>,
        },
        {
            label: bomMatrixSectionLabel('sizes'),
            key: 'sizes',
            children: <BomMatrixSizeView ref={sizesRef} bomMatrix={bomMatrix}/>,
        }, ...(tabs ?? [])], [bomMatrix, tabs, isEdit]);

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
