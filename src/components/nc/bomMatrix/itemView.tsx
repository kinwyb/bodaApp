import React, {useCallback, useEffect, useMemo, useState} from "react";
import {message} from "antd";
import type {BomMatrixDetail} from "@/api/schemas/nc/bomMatrix.ts";
import {type AppColumnDef, GridTable} from "@/components/grid-table";
import {BackFlushTypeLabel, ItemSourceLabel} from "@/components/nc/bomMatrix/common.ts";
import NCMaterialModal, {MATERIAL_EDITOR} from "@/components/nc/materialModal.tsx";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors";
import type {NCMaterial} from "@/api/schemas/nc/NCMaterial.ts";
import {ncMaterialApi} from "@/api/modules/nc/material.ts";
import {ErrorMessage} from "@/api/request.ts";

/** bom矩阵子物料树形 */
export interface BomMatrixItemProps {
    items: BomMatrixDetail[]
    isEditable: boolean
}

const BomMatrixItemView: React.FC<BomMatrixItemProps> = ({items, isEditable}) => {

    const [datas, setDatas] = useState<BomMatrixDetail[]>([]);

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
            return undefined;
        }
        return {
            'ProjectMaterial': 'auto',
            'MaterialCode': MATERIAL_EDITOR,
        }
    }, [isEditable])


    useEffect(() => {
        setDatas(items);
    }, [items]);

    /**
     * 把一条物料的基础资料回填到当前行。
     *
     * 弹窗选中和「直接输入编码回车」两条入口共用：换物料时，编码之外的
     * 名称/版本/规格/型号/单位/换算率也必须一起换掉，否则行里会出现
     * 「编码是新的、名称还是旧的」这种半截数据。
     */
    const applyMaterial = useCallback((activeRow: EditorRowAccessor | null, material: NCMaterial) => {
        const updateFields: Record<string, unknown> = {
            MaterialVID: material.pk_material,
            MaterialCode: material.code,
            MaterialName: material.name,
            MaterialVersion: material.version,
            MaterialSpec: material.materialspec,
            MaterialType: material.materialtype,
            CMeasureid: material.pk_measdoc,
            CMeasure: material.measdoc,
        }
        if (material.materialconvert && material.materialconvert.length > 0) {
            updateFields.Cassmeasure = material.materialconvert[0].measdoc;
            updateFields.Cassmeasureid = material.materialconvert[0].pk_measdoc;
            updateFields.VChangerate = material.materialconvert[0].measrate;
        }
        activeRow?.setFields(updateFields);
        activeRow?.endEdit();
    }, [])

    /**
     * 用户没开弹窗、直接在单元格里输入编码回车：按编码查一次物料，查到就回填整行。
     *
     * 查不到只提示、不动这一行的其他字段（用户可能就是要填一个临时编码）。
     * 注意这里可以异步：回车时编辑已经结束，`setFields` 仍会按行对象写回去。
     */
    const handleInputCode = useCallback(async (code: string, activeRow: EditorRowAccessor) => {
        try {
            const result = await ncMaterialApi.query({Code: code});
            const materials = result.data ?? [];
            const material = materials.find((item) => item.code === code) ?? materials[0];
            if (!material) {
                void message.warning(`未找到物料：${code}`);
                return;
            }
            applyMaterial(activeRow, material);
        } catch (error) {
            void message.error(ErrorMessage(error, '物料查询失败'));
        }
    }, [applyMaterial])

    return (
        <>
            <GridTable columns={columns} editableFields={editableFields} records={datas}
                       rowKey={'PackBomMatrixDetailID'}
                       rowNumber={false}
                       multiSelect={false} widthMode={'autoWidth'}/>
            <NCMaterialModal open={false}
                             isEditor={true}
                             onSelect={(record: NCMaterial, activeRow: EditorRowAccessor | null) => {
                                 applyMaterial(activeRow, record);
                             }}
                             onInput={(code, activeRow) => {
                                 console.log(activeRow, activeRow);
                                 void handleInputCode(code, activeRow);
                             }}/>
        </>
    );
}

export default BomMatrixItemView;