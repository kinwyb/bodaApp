import React, {useEffect, useMemo, useState} from "react";
import type {PackBomMatrixDetail} from "@/api/schemas/nc/packBomMatrix.ts";
import {type AppColumnDef, GridTable} from "@/components/grid-table";

/** bom矩阵子物料树形 */
export interface BomMatrixItemProps {
    items: PackBomMatrixDetail[]
}

const BomMatrixItemView: React.FC<BomMatrixItemProps> = ({items}) => {

    const [datas, setDatas] = useState<PackBomMatrixDetail[]>([]);

    const columns = useMemo((): AppColumnDef[] => {
        return [
            {field: "VRowNo", title: '行号'},
            {field: "ProjectMaterial", title: '项目专用'},
            {field: "MaterialCode", title: '物料编码'},
            {field: "MaterialName", title: '物料名称'},
            {field: "MaterialVersion", title: '物料版本'},
            {field: "MaterialSpec", title: '物料规格'},
            {field: "MaterialType", title: '物料型号'},
            {field: "VFree5Name", title: '季度号/通用'},
            {field: "VFree1Name", title: '款号'},
            {field: "VFree9Name", title: '色纱色'},
            {field: "Productor", title: '供应商'},
            {field: "VFree8Name", title: '特性'},
            {field: "Ndissipationum", title: '损耗系数'},
            {field: "VFree4Name", title: '批号'},
            {field: "CMeasure", title: '主单位'},
            {field: "Nitemnum", title: '子项数量'},
            {field: "Ibasenum", title: '底数'},
            {field: "VChangerate", title: '换算率'},
            {field: "Cassmeasure", title: '单位'},
            {field: "Fitemsource", title: '备料来源'},
            {field: "Bdeliver", title: '发料'},
            {field: "Fbackflushtype", title: '倒冲方式'},
            {field: "BeginDate", title: '生效日期'},
            {field: "EndDate", title: '失效日期'},
            {field: "Bupint", title: '向上取整'},
        ];
    }, [])

    useEffect(() => {
        setDatas(items);
    }, [items]);

    return (
        <GridTable columns={columns} records={datas} rowKey={'PackBomMatrixDetailID'} rowNumber={false}
                   multiSelect={false}/>
    );
}

export default BomMatrixItemView;