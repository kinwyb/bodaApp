import React, {useEffect, useMemo, useState} from "react";
import type {BomMatrix} from "@/api/schemas/nc/bomMatrix.ts";
import {toStringOrEmpty} from "@/utils";
import {type AppColumnDef, type AppColumnGroupDef, GridTable} from "@/components/grid-table";

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
                const match = matrix.ColorMatch?.[color];
                if (match) {
                    const matchColor = match[row.Key];
                    row[color] = matchColor.VFree6Name;
                    row[color + '_val'] = matchColor.VFree6;
                }
            })
            return row;
        });
    }
    return datas;
}


const BomMatrixColorView: React.FC<BomMatrixColorViewProps> = ({bomMatrix}) => {
    const [datas, setDatas] = useState<bomMatrixColorData[]>([])

    const columns = useMemo((): AppColumnDef[] => {
        const colorGroup: AppColumnGroupDef = {
            title: '颜色',
            children: [],
        }
        bomMatrix.ColorSort?.forEach((color) => {
            if (!color) {
                return;
            }
            colorGroup.children.push({field: color, title: color, minWidth: 50})
        })
        const materialGroup: AppColumnGroupDef = {
            title: '物料',
            children: [
                {field: 'VRowNo', title: '行号'},
                {field: 'MaterialCode', title: '物料编码'},
                {field: 'MaterialName', title: '物料名称'},
                {field: 'MaterialVersion', title: '物料版本'},
                {field: 'MaterialSpec', title: '物料规格'},
                {field: 'MaterialType', title: '物料型号'},
                {field: 'VFree5Name', title: '季度号/通用'},
                {field: 'VFree4Name', title: '批号'},
            ]
        }
        return [
            materialGroup,
            colorGroup
        ];
    }, [bomMatrix]);

    useEffect(() => {
        setDatas(bomMatrixToColorData(bomMatrix));
    }, [bomMatrix])

    return (
        <GridTable columns={columns} records={datas} rowKey={'Key'} multiSelect={false} rowNumber={false}
                   widthMode={'autoWidth'}/>
    );
}

export default BomMatrixColorView;