import React, {useEffect, useMemo, useState} from "react";
import type {BomMatrix} from "@/api/schemas/nc/bomMatrix.ts";
import {toStringOrEmpty} from "@/utils";
import {type GridTableApi, GridTable} from "@/components/grid-table";
import {buildColorColumns} from "./columns.ts";

export type BomMatrixColorViewProps = {
    bomMatrix: BomMatrix;
}


interface bomMatrixColorData {
    Key: string;
    VRowNo: string;
    MaterialVID: string;
    MaterialCode: string;
    MaterialName: string;
    MaterialVersion: string;
    MaterialSpec: string;
    MaterialType: string;
    VFree5Name: string;
    VFree4Name: string;

    [key: string]: unknown;
}


/**
 * bom矩阵数据转换成颜色表数据
 * @param matrix
 */
function bomMatrixToColorData(matrix: BomMatrix): bomMatrixColorData[] {
    if (!matrix || !matrix.Detail) {
        return [];
    }
    let datas = matrix.Detail.map((detail) => {
        let result: bomMatrixColorData = {
            Key: toStringOrEmpty(detail.VRowNo) + "_" + toStringOrEmpty(detail.MaterialVID),
            VRowNo: toStringOrEmpty(detail.VRowNo),
            MaterialVID: toStringOrEmpty(detail.MaterialVID),
            MaterialCode: toStringOrEmpty(detail.MaterialCode),
            MaterialName: toStringOrEmpty(detail.MaterialName),
            MaterialVersion: toStringOrEmpty(detail.MaterialVersion),
            MaterialSpec: toStringOrEmpty(detail.MaterialSpec),
            MaterialType: toStringOrEmpty(detail.MaterialType),
            VFree5Name: toStringOrEmpty(detail.VFree5Name),
            VFree4Name: toStringOrEmpty(detail.VFree4Name),
        };
        return result;
    });
    if (matrix.ColorMatch && matrix.ColorSort && matrix.ColorSort.length > 0) {
        datas = datas.map((row) => {
            matrix.ColorSort?.forEach((color) => {
                if (!color) {
                    return;
                }
                const matchColor = matrix.ColorMatch?.[color]?.[row.Key];
                if (matchColor) {
                    row[color] = matchColor.VFree6Name;
                    row[color + '_val'] = matchColor.VFree6;
                }
            })
            return row;
        });
    }
    return datas;
}

/**
 * 配色表：一行一个子项物料，一列一个缝制颜色。
 *
 * 与子项物料表是**同一批行的两种投影**，所以行标识都是 `VRowNo_MaterialVID` 拼出来的
 * （子项物料表用的是明细主键，两套键并不通用 —— 跨表引用同一行要用行号对齐）。
 */
const BomMatrixColorView = React.forwardRef<GridTableApi, BomMatrixColorViewProps>(({bomMatrix}, ref) => {

    const [datas, setDatas] = useState<bomMatrixColorData[]>([])

    const columns = useMemo(() => buildColorColumns(bomMatrix), [bomMatrix]);

    useEffect(() => {
        setDatas(bomMatrixToColorData(bomMatrix));
    }, [bomMatrix])

    return (
        <GridTable ref={ref} columns={columns} records={datas} rowKey={'Key'} multiSelect={false} rowNumber={false}
                   widthMode={'autoWidth'}/>
    );
});

export default BomMatrixColorView;
