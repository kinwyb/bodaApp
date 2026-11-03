import React from "react";
import {type AppColumnDef, GridTable} from "@/components/grid-table";

export type PushViewProps = {
    VersionField: string,
    VersionFieldName: string,
    Datas: Record<string, any>[],
}

const PushView: React.FC<PushViewProps> = ({VersionField, VersionFieldName, Datas}) => {

    const columns: AppColumnDef[] = [
        {field: 'MaterialCode', title: '物料编码'},
        {field: 'MaterialName', title: '物料名称'},
        {field: 'MatrixVersion', title: '矩阵版本', maxWidth: 80, style: {textAlign: 'center'}},
        {field: 'Feature', title: '特征码', minWidth: 220},
        {field: VersionField, title: VersionFieldName, style: {textAlign: 'center'}},
        {field: 'IsPush', title: '发布', dataType: 'boolean', maxWidth: 60},
        {field: 'PushUser', title: '发布人'},
        {field: 'PushTime', title: '发布时间'}
    ];

    return (
        /*
         * rowKey 必须显式给：GridTable 的默认主键是 `id`，而规则行的主键是 PackBomMatrixRuleID，
         * 不给的话每行的 rowKey 都是空串 —— 行选中、按主键定位全会串成一行。
         */
        <GridTable columns={columns} records={Datas} rowKey={'PackBomMatrixRuleID'} autoFillWidth={true}/>
    );
}

export default PushView;