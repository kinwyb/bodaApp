import React, {useImperativeHandle, useRef} from "react";
import {type AppColumnDef, GridTable, type GridTableApi} from "@/components/grid-table";

export type PushViewProps = {
    /** BOM 版本那一列的字段名（包装 BOM 是 `BomVersion`，工艺矩阵是 `PRVersion`） */
    VersionField: string,
    /** BOM 版本那一列的表头（两套矩阵叫法不同，由调用方给） */
    VersionFieldName: string,
    Datas: Record<string, any>[],
    /**
     * 是否允许多选，默认 false。
     *
     * 发布弹窗要按「选中行」决定操作范围，所以那里传 true；
     * 页面第四个标签页只是看发布情况，保持单选的默认行为即可。
     */
    selectable?: boolean,
}

/** 交给外面的能力：读选中行、清空选中（发布操作按它算作用范围） */
export type PushViewApi = {
    /** 当前选中的规则行（没有选中时是空数组，顺序与屏幕一致） */
    getSelectedRows: () => Record<string, unknown>[];
    /** 清空选中：发布成功后清一次，避免下一次操作继续沿用上一批行 */
    clearSelection: () => void;
}

/**
 * 发布情况表（「包装BOM矩阵明细」弹窗与页面第四个标签页共用）。
 *
 * 行是**规则**（`PackBomMatrixRule`），不是矩阵明细：一条规则 = 一个特征码组合的 BOM，
 * 主键是 `PackBomMatrixRuleID`。发布 / 取消发布 / 更新三个动作都以这个主键为准。
 *
 * 「是否发布」用 `dataType: 'boolean'`：GridTable 会画成**只读**勾选框 —— 这是刻意的，
 * 发布状态只能由后端推送结果决定，让用户在表格里勾一下却什么都不发生，比只读更误导。
 */
const PushView = React.forwardRef<PushViewApi, PushViewProps>((
    {VersionField, VersionFieldName, Datas, selectable = false},
    ref,
) => {

    const gridRef = useRef<GridTableApi | null>(null);

    useImperativeHandle(ref, () => ({
        getSelectedRows: () => gridRef.current?.getSelection().rows ?? [],
        clearSelection: () => gridRef.current?.clearSelection(),
    }), []);

    /*
     * 列序与原界面（VFP 的「包装BOM矩阵明细」）一致：矩阵版本在最前，
     * 之后是物料、特征码、BOM 版本、发布状态与发布审计。
     */
    const columns: AppColumnDef[] = [
        {field: 'MatrixVersion', title: '矩阵版本', dataType: 'int', width: 78, style: {textAlign: 'center'}},
        {field: 'MaterialCode', title: '物料编码', width: 108},
        {field: 'MaterialName', title: '物料名称', width: 126},
        {field: 'Feature', title: '特征码', width: 236},
        {field: VersionField, title: VersionFieldName, width: 86, style: {textAlign: 'center'}},
        {field: 'IsPush', title: '是否发布', dataType: 'boolean', width: 86, style: {textAlign: 'center'}},
        {field: 'PushUser', title: '发布人', width: 88},
        {field: 'PushTime', title: '发布时间', dataType: 'datetime', width: 150},
    ];

    return (
        /*
         * rowKey 必须显式给：GridTable 的默认主键是 `id`，而规则行的主键是 PackBomMatrixRuleID，
         * 不给的话每行的 rowKey 都是空串 —— 行选中、按主键定位全会串成一行。
         *
         * `autoFillWidth`：容器比列宽总和更宽时按比例铺满（原界面就是这样，右侧不留白）。
         * 窄屏（工作台里被右侧助手面板挤窄）时按列宽横向滚动 —— **不要**改成 `adaptive`，
         * 八个列等比压到五百多像素，表头和内容全变省略号，反而认不出是哪一列。
         */
        <GridTable ref={gridRef} columns={columns} records={Datas} rowKey={'PackBomMatrixRuleID'}
                   multiSelect={selectable} autoFillWidth={true}/>
    );
});

export default PushView;
