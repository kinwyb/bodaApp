import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {NCMaterialVFree} from "@/api/schemas/nc/NCMaterial.ts";
import {type AppColumnDef, GridTable, type GridTableApi} from "@/components/grid-table";
import {RegisterInputModal, type RegisterModalProps} from "@/components/registerModal.tsx";
import {App} from "antd";
import {ErrorMessage} from "@/api/request.ts";
import {ncMaterialApi} from "@/api/modules/nc/material.ts";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors.tsx";

/**
 * 物料辅助属性弹窗
 */
export const MATERIAL_VFREE_EDITOR = 'material-vfree-editor'

/**
 * 表格行高 / 表头高：**同时**用于给弹窗算高度（见下面的 tableHeight）。
 *
 * 表格是 canvas，容器必须有确定高度才画得出来；而弹窗默认是「高度随内容」
 * （`RegisterInputModal` 不传 height 时只封一屏上限），具体多高只能在这里按行数算。
 * 两个值既显式传给 GridTable、又参与 tableHeight 的计算，保证「算高度用的」
 * 和「表格实际画的」永远是同一份 —— 以后要调行高，改这里就够。
 */
const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;
/** 数据为空或只有一行时别缩得太小（「暂无数据」也要占地方） */
const MIN_TABLE_HEIGHT = 160;

export type NCMaterialVFreeViewProps = {
    materialVID: string;
    vfreeField: string;
    onSelect?: (material: NCMaterialVFree) => void;
}

const NCMaterialVFreeView: React.FC<NCMaterialVFreeViewProps> = ({materialVID, vfreeField, onSelect}) => {

    const {message} = App.useApp();
    const [datas, setDatas] = useState<NCMaterialVFree[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const useVFree = ['vfree1', 'vfree4', 'vfree5', 'vfree6', 'vfree7', 'vfree8', 'vfree9', 'vfree10'];
    /**
     * 属性列
     */
    const columns = useMemo((): AppColumnDef[] => {
        return [
            {field: 'code', title: '编码'},
            {field: 'name', title: '名称'}
        ]
    }, []);
    const tableRef = useRef<GridTableApi>(null);

    const loadData = useCallback(async () => {
        if (!useVFree.includes(vfreeField)) { //不是有效的辅助属性字段，直接返回不请求后端
            setDatas([]);
            return;
        }
        setIsLoading(true);
        try {
            const res = await ncMaterialApi.vfree({fieldName: vfreeField, pkMaterial: materialVID})
            if (!res.data) {
                setDatas([]);
                return;
            }
            setDatas(res.data);
        } catch (error) {
            void message.error(ErrorMessage(error, '加载失败'))
        } finally {
            setIsLoading(false);
        }
    }, [materialVID, vfreeField])

    useEffect(() => {
        void loadData();
    }, [materialVID, vfreeField]);

    const handleDbClick = useCallback(() => {
        if (!tableRef.current) {
            return;
        }
        const activeRow = tableRef.current.getActiveRow();
        if (!activeRow) {
            return;
        }
        const rowData = datas.find((d) => d.pk_defdoc === activeRow.rowKey);
        if (!rowData) {
            return;
        }
        onSelect?.(rowData);
    }, [datas, tableRef]);

    /**
     * 内容需要多高（表头 + 所有数据行）。数据超过一屏时不用管：弹窗 body 的 max-height
     * 会把这块压小（flex 收缩），表格自己出纵向滚动条。
     */
    const tableHeight = Math.max(
        MIN_TABLE_HEIGHT,
        HEADER_HEIGHT + Math.max(datas.length, 1) * ROW_HEIGHT,
    );

    return (
        <div style={{height: tableHeight, flex: '0 1 auto', minHeight: 0, width: '100%'}}>
            <GridTable ref={tableRef} columns={columns} records={datas} rowKey={'pk_defdoc'} multiSelect={false}
                       loading={isLoading} rowHeight={ROW_HEIGHT} headerRowHeight={HEADER_HEIGHT}
                       onCellDblClick={handleDbClick} autoFillWidth={true} rowNumber={false}/>
        </div>
    );
}

export type NCMaterialVFreeModalProps = RegisterModalProps<NCMaterialVFree, {
    viewProps: (record?: EditorRowAccessor) => Omit<NCMaterialVFreeViewProps, "onSelect">;
}>

/**
 * 物料辅助属性弹窗
 * @constructor
 */
const NCMaterialVFreeModal: React.FC<NCMaterialVFreeModalProps> = ({
                                                                       open,
                                                                       isEditor,
                                                                       onCancel,
                                                                       onSelect,
                                                                       viewProps
                                                                   }) => {

    return (
        <RegisterInputModal<NCMaterialVFree, NCMaterialVFreeViewProps>
            open={open}
            isEditor={isEditor}
            editorKey={MATERIAL_VFREE_EDITOR}
            editorPlaceholder="辅助属性"
            onCancel={onCancel}
            onSelect={onSelect}
            title={'辅助属性'}
            width={450}
            readOnly={true}
            View={NCMaterialVFreeView}
            updateViewProps={(_, row) => viewProps(row)}
        />
    );
}

export default NCMaterialVFreeModal;

