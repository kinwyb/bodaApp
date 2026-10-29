import React, {useEffect, useMemo, useState} from "react";
import type {BomMatrix} from "@/api/schemas/nc/bomMatrix.ts";
import {toStringOrEmpty} from "@/utils";
import {type GridTableApi, GridTable} from "@/components/grid-table";
import {buildSizeColumns} from "./columns.ts";

export type BomMatrixSizeViewProps = {
    bomMatrix: BomMatrix;
}

interface bomMatrixSizeData {
    Key: string;
    VRowNo: string;
    MaterialVID: string;
    MaterialCode: string;
    MaterialName: string;
    MaterialVersion: string;
    MaterialSpec: string;
    MaterialType: string;
    VFree5Name: string;
    VFree1Name: string;
    VFree9Name: string;
    VFree4Name: string;

    [key: string]: unknown;
}

/**
 * bom矩阵数据转换成尺码表数据
 * @param matrix
 */
function bomMatrixToSizeData(matrix: BomMatrix): bomMatrixSizeData[] {
    if (!matrix || !matrix.Detail) {
        return [];
    }
    let datas = matrix.Detail.map((detail) => {
        let result: bomMatrixSizeData = {
            Key: toStringOrEmpty(detail.VRowNo) + "_" + toStringOrEmpty(detail.MaterialVID),
            VRowNo: toStringOrEmpty(detail.VRowNo),
            MaterialVID: toStringOrEmpty(detail.MaterialVID),
            MaterialCode: toStringOrEmpty(detail.MaterialCode),
            MaterialName: toStringOrEmpty(detail.MaterialName),
            MaterialVersion: toStringOrEmpty(detail.MaterialVersion),
            MaterialSpec: toStringOrEmpty(detail.MaterialSpec),
            MaterialType: toStringOrEmpty(detail.MaterialType),
            VFree5Name: toStringOrEmpty(detail.VFree5Name),
            VFree1Name: toStringOrEmpty(detail.VFree1Name),
            VFree9Name: toStringOrEmpty(detail.VFree9Name),
            VFree4Name: toStringOrEmpty(detail.VFree4Name),
        };
        return result;
    });
    if (matrix.SizeMatch && matrix.SizeSort && matrix.SizeSort.length > 0) {
        datas = datas.map((row) => {
            matrix.SizeSort?.forEach((size) => {
                if (!size) {
                    return;
                }
                const matchSize = matrix.SizeMatch?.[size]?.[row.Key];
                if (matchSize) {
                    row['Sunhao' + size] = matchSize.Nbfixshrinknum;
                    row['S' + size] = matchSize.VFree7Name;
                    row['S' + size + '_val'] = matchSize.VFree7;
                    row['N' + size] = matchSize.Nitemnum;
                }
            })
            return row;
        });
    }
    return datas;
}

/**
 * 配码表：一行一个子项物料，每个尺码三列（损耗数量 / 尺码系数 / 尺码用量）。
 *
 * 三个值都来自 `SizeMatch[尺码][行键]`，行键与配色表同一套（`VRowNo_MaterialVID`）。
 */
const BomMatrixSizeView = React.forwardRef<GridTableApi, BomMatrixSizeViewProps>(({bomMatrix}, ref) => {

    const [datas, setDatas] = useState<bomMatrixSizeData[]>([])

    const columns = useMemo(() => buildSizeColumns(bomMatrix), [bomMatrix]);

    useEffect(() => {
        setDatas(bomMatrixToSizeData(bomMatrix));
    }, [bomMatrix])

    return (
        <GridTable ref={ref} columns={columns} records={datas} rowKey={'Key'} multiSelect={false} rowNumber={false}
                   widthMode={'autoWidth'}/>
    );
});

export default BomMatrixSizeView;
