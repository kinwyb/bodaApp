import React, {useEffect, useMemo, useState} from "react";
import type {PackBomMatrixDetail} from "@/api/schemas/nc/packBomMatrix.ts";
import {type AppColumnDef, GridTable} from "@/components/grid-table";
import {BackFlushTypeLabel, ItemSourceLabel} from "@/components/nc/bomMatrix/common.ts";
import NCMaterial, {MATERIAL_EDITOR} from "@/components/nc/materialModal.tsx";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors";

/** bom矩阵子物料树形 */
export interface BomMatrixItemProps {
    items: PackBomMatrixDetail[]
    isEditable: boolean
}

const BomMatrixItemView: React.FC<BomMatrixItemProps> = ({items, isEditable}) => {

    const [datas, setDatas] = useState<PackBomMatrixDetail[]>([]);

    const columns = useMemo((): AppColumnDef[] => {
        return [
            {field: "VRowNo", title: '行号'},
            {field: "ProjectMaterial", title: '项目专用', dataType: 'boolean'},
            {field: "MaterialCode", title: '物料编码', minWidth: 150},
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
            {field: "Nitemnum", title: '子项数量', dataType: 'int'},
            {field: "Ibasenum", title: '底数', dataType: 'int'},
            {field: "VChangerate", title: '换算率'},
            {field: "Cassmeasure", title: '单位'},
            {field: "Fitemsource", title: '备料来源', fieldFormat: (record) => ItemSourceLabel(record.Fitemsource)},
            {field: "Bdeliver", title: '发料', dataType: "boolean"},
            {
                field: "Fbackflushtype",
                title: '倒冲方式',
                fieldFormat: (record) => BackFlushTypeLabel(record.Fbackflushtype)
            },
            {field: "BeginDate", title: '生效日期', dataType: 'date'},
            {field: "EndDate", title: '失效日期', dataType: 'date'},
            {field: "Bupint", title: '向上取整', dataType: "boolean"},
        ];
    }, [])

    const editableFields = useMemo(() => {
        if (!isEditable) {
            console.log("禁止编辑")
            return undefined;
        }
        console.log("itemview 编辑")
        return {
            'ProjectMaterial': 'auto',
            'MaterialCode': MATERIAL_EDITOR,
        }
    }, [isEditable])


    useEffect(() => {
        setDatas(items);
    }, [items]);

    return (
        <>
            <GridTable columns={columns} editableFields={editableFields} records={datas}
                       rowKey={'PackBomMatrixDetailID'}
                       rowNumber={false}
                       multiSelect={false} widthMode={'autoWidth'}/>
            <NCMaterial open={false}
                        isEditor={true}
                        onSelect={function (record: Record<string, unknown>, activeRow: EditorRowAccessor | null): void {
                            console.log(record, activeRow);
                        }}/>
        </>
    );
}

export default BomMatrixItemView;