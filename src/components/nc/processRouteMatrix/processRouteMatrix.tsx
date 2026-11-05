import React, {useImperativeHandle, useMemo, useRef} from 'react';
import {Tabs, type TabsProps} from 'antd';
import type {ProcessRouteMatrix} from '@/api/schemas/nc/processRouteMatrix.ts';
import type {GridTableApi} from '@/components/grid-table';
import type {ProcessRouteGridApi} from './gridApi.ts';
import ProcessRouteItemView from './itemView.tsx';
import {processRouteSectionLabel} from './sections.ts';

export type ProcessRouteMatrixViewProps = {
    /** 矩阵详情（`ProcessRouteMatrixSchema`）：工序明细从它的 `Detail` 派生 */
    matrix: ProcessRouteMatrix;
    /**
     * 追加在内置页签后面的页签（可选）。
     *
     * 与包装 BOM 矩阵的 `tabs` 同一个口子：页面想加「发布情况」这一类页签，
     * 在这里传 antd Tabs 的 item 即可，控件不替页面决定要不要有这一页。
     *
     * 发布情况那张表本身是通用的（`components/nc/matrixPushView`），页面这样接：
     *
     * ```tsx
     * <ProcessRouteMatrixView
     *     matrix={matrix}
     *     activeKey={activeKey}
     *     onActiveKeyChange={setActiveKey}
     *     tabs={[{
     *         key: 'pushRules',
     *         label: processRouteSectionLabel('pushRules'),
     *         children: <PushView Datas={rules} RowKeyField={'ProcessRouteMatrixRuleID'}
     *                             VersionField={'PRVersion'} VersionFieldName={'工艺版本'}/>,
     *     }]}
     * />
     * ```
     */
    tabs?: TabsProps['items'];
    isEditMode?: boolean;
    /**
     * 当前标签页（**受控**）。
     *
     * 刻意不做「不传就自己管」的非受控降级：界面桥必须如实回答「用户此刻在看哪一张表」，
     * 控件内部再存一份就会静默分叉 —— 页面以为在工序明细、屏幕上其实是发布情况。
     */
    activeKey: string;
    onActiveKeyChange: (key: string) => void;
};

/** 交给外面的能力：读表格实例、读行数据、读行级命令 */
export type ProcessRouteMatrixViewApi = {
    /**
     * 取某个标签页的表格实例。
     *
     * 返回 null = 这一页**还没渲染过**（antd Tabs 是懒挂载：没被激活过的面板不挂载），
     * 或者这一页不是控件内置的（比如页面追加的「发布情况」——它的实例在页面自己手上）。
     * 界面桥据此在快照里标 `readable: false`，而不是拿一张 0 行的空表冒充「没有数据」。
     */
    readTable: (section: string) => GridTableApi | null;
    /**
     * 取某个标签页**当前的行数据**（工序明细含未保存的编辑）。
     *
     * 与 `readTable` 的分工：那个给表格实例（带排序 / 筛选 / 懒挂载），这个直接给 state 里
     * 那份原始行 —— 保存时该用它（表格排序过也不影响这里的顺序 = 数据顺序）。
     */
    readRows: (section: string) => Record<string, unknown>[];
    /**
     * 取某个标签页的**行级命令 API**（`addRow` / `removeRow` / `updateRow` / `getRows`）。
     *
     * 只有工序明细有写入口；别的页签一律 null（包括页面追加的只读页）。
     */
    readGrid: (section: string) => ProcessRouteGridApi | null;
};

/**
 * 工艺路线矩阵：内置**一张**表（工序明细），其余页签由调用方用 `tabs` 追加。
 *
 * 比包装 BOM 矩阵简单的地方：
 * - 没有配色 / 配码那种「同一批行的另一种投影」，所以**没有跨表同步**；
 * - 没有随数据变的动态列，列目录是常量（换矩阵不会整份刷新）；
 * - 不必自己管发布规则：那张表是通用的（`components/nc/matrixPushView`），
 *   数据也由页面取，这里只留一个「追加页签」的口子。
 *
 * 这一层只做两件事：把「当前是哪个标签页」交给外面（受控），把工序表的实例与行数据交出去。
 * 它不认识界面桥，也不自己取数 —— 详情由页面传进来。
 */
export const ProcessRouteMatrixView = React.forwardRef<
    ProcessRouteMatrixViewApi,
    ProcessRouteMatrixViewProps
>((
    {matrix, tabs, isEditMode, activeKey, onActiveKeyChange},
    ref,
) => {

    /*
     * 当前是否可编辑：**跟随 props**，不是 useState 初值。
     *
     * 弹窗里「有没有权限编工序」是运行中可能变化的，锁成初值就会出现
     * 「按钮已经允许编辑、表格还是只读」这种自相矛盾的状态。
     */
    const isEdit = isEditMode ?? false;
    const itemsRef = useRef<ProcessRouteGridApi | null>(null);

    /** 明细（接口那份）：工序表**首次挂载 / 换矩阵**时用它铺行 */
    const detailItems = useMemo(() => matrix.Detail ?? [], [matrix.Detail]);

    /*
     * 只暴露取值函数：桥与保存流程都在「被调用的那一刻」才读，
     * 所以面板切换、表格重建都不用重新装配。
     */
    useImperativeHandle(ref, () => ({
        readTable: (section: string) => (section === 'items' ? itemsRef.current?.table() ?? null : null),
        readRows: (section: string) => {
            if (section === 'items') return itemsRef.current?.getRows() ?? detailItems;
            return [];
        },
        /*
         * 写能力的入口：只有工序表有。别的页签返回 null —— 别让调用方以为
         * 「写不进去」是还没渲染，它本来就没有写入口。
         */
        readGrid: (section: string) => (section === 'items' ? itemsRef.current : null),
    }), [detailItems]);

    /*
     * 依赖里必须带 `isEdit`：能不能编辑是表的属性，重建元素才能把新值传下去。
     * key 不变，React 只更新不重挂载，表格里的编辑状态都还在。
     */
    const items = useMemo<TabsProps['items']>(() => [
        {
            label: processRouteSectionLabel('items'),
            key: 'items',
            children: <ProcessRouteItemView ref={itemsRef} items={detailItems} isEditable={isEdit}/>,
        },
        ...(tabs ?? []),
    ], [detailItems, isEdit, tabs]);

    return (
        <Tabs
            className="grid-table-expand-tabs page-tabs-fill"
            activeKey={activeKey}
            onChange={onActiveKeyChange}
            size={'small'}
            items={items}
        />
    );
});

export default ProcessRouteMatrixView;
