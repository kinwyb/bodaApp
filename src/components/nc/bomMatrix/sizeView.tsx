import React, {useEffect, useMemo, useState} from "react";
import type {BomMatrix} from "@/api/schemas/nc/bomMatrix.ts";
import {toNumberOrZero, toStringOrEmpty} from "@/utils";
import {type AppColumnDef, type AppColumnGroupDef, GridTable} from "@/components/grid-table";

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

const BomMatrixSizeView: React.FC<BomMatrixSizeViewProps> = ({bomMatrix}) => {

    const [datas, setDatas] = useState<bomMatrixSizeData[]>([])

    const columns = useMemo((): AppColumnDef[] => {
        const sunhaoGroup: AppColumnGroupDef = {
            title: '损耗数量',
            children: [],
        }
        const sizeGroup: AppColumnGroupDef = {
            title: '尺码系数',
            children: [],
        }
        const numGroup: AppColumnGroupDef = {
            title: '尺码用量',
            children: [],
        }
        bomMatrix.SizeSort?.forEach((size) => {
            if (!size) {
                return;
            }
            sunhaoGroup.children.push({
                field: 'Sunhao' + size, title: size, dataType: 'int', minWidth: 50, fieldFormat: (record) => {
                    const val = toNumberOrZero(record['Sunhao' + size]);
                    if (val === 0) {
                        return '';
                    }
                    return toStringOrEmpty(val)
                }
            })
            sizeGroup.children.push({field: 'S' + size, title: size, minWidth: 50})
            numGroup.children.push({field: 'N' + size, title: size, dataType: 'int', minWidth: 50})
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
                {field: 'VFree1Name', title: '款号'},
                {field: 'VFree9Name', title: '色纱色'},
                {field: 'VFree4Name', title: '批号'},
            ]
        }
        return [
            materialGroup,
            sunhaoGroup,
            sizeGroup,
            numGroup,
        ];
    }, [bomMatrix]);

    useEffect(() => {
        setDatas(bomMatrixToSizeData(bomMatrix));
    }, [bomMatrix])

    return (
        <GridTable columns={columns} records={datas} rowKey={'Key'} multiSelect={false} rowNumber={false}
                   widthMode={'autoWidth'}/>
    );
}

export default BomMatrixSizeView;