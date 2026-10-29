import React, {useCallback, useEffect, useMemo, useState} from "react";
import {message} from "antd";
import type {BomMatrixDetail} from "@/api/schemas/nc/bomMatrix.ts";
import {type GridTableApi, GridTable} from "@/components/grid-table";
import {ITEM_COLUMNS} from "./columns.ts";
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

/**
 * 子项物料表。
 *
 * 纯视图：列定义在 `./columns.ts`（界面桥读的是同一份），表格实例通过 ref 交给外面。
 * 这一层不认识界面桥，也不该认识 —— 它要能被没有 agent 的场景原样复用。
 */
const BomMatrixItemView = React.forwardRef<GridTableApi, BomMatrixItemProps>(({items, isEditable}, ref) => {

    const [datas, setDatas] = useState<BomMatrixDetail[]>([]);

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
            <GridTable ref={ref} columns={ITEM_COLUMNS} editableFields={editableFields} records={datas}
                       rowKey={'PackBomMatrixDetailID'}
                       rowNumber={false}
                       multiSelect={false} widthMode={'autoWidth'}/>
            <NCMaterialModal open={false}
                             isEditor={true}
                             onSelect={(record: NCMaterial, activeRow: EditorRowAccessor | null) => {
                                 applyMaterial(activeRow, record);
                             }}
                             onInput={(code, activeRow) => {
                                 void handleInputCode(code, activeRow);
                             }}/>
        </>
    );
});

export default BomMatrixItemView;
