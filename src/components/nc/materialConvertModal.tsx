import React, {useCallback} from 'react';
import {QuickSelectView} from '../QuickSelectModal';
import type {AppColumnDef} from '../grid-table/columnBuilder';
import type {NCMaterialConvert} from "@/api/schemas/nc/NCMaterial.ts";
import {RegisterInputModal, type RegisterModalProps} from "@/components/registerModal.tsx";


/**
 * 物料单位转换编辑器
 */
export const MATERIAL_CONVERT_EDITOR = 'material-convert-editor';

/** 单位列 */
const MEASDOC_COLUMNS: AppColumnDef[] = [
    {field: 'measdocCode', title: '单位编码', width: 110},
    {field: 'measdoc', title: '单位名称', width: 140},
    {field: 'measrate', title: '转换率', width: 240},
];

export interface NCMaterialConvertViewProps {
    /** 选择回调 */
    onSelect: (measdoc: NCMaterialConvert) => void;
    converts?: NCMaterialConvert[];
}

const NCMaterialConvertView: React.FC<NCMaterialConvertViewProps> = ({onSelect, converts}) => {

    const loadData = useCallback(() => {
        return converts ?? [];
    }, [converts]);

    return (
        <QuickSelectView<NCMaterialConvert>
            columns={MEASDOC_COLUMNS}
            rowKey="pk_materialconvert"
            loadData={loadData}
            searchFields={['Code', 'Name']}
            searchLabel="快速选择:"
            searchPlaceholder={'关键字'}
            emptyTip={'请先选择物料'}
            autoFillWidth={true}
            onSelect={(row) => row && onSelect(row)}
        />
    );
};


export type NCMaterialConvertModalProps = RegisterModalProps<NCMaterialConvert, NCMaterialConvertViewProps>;

/**
 * 物料单位选择
 */
const NCMaterialConvertModal: React.FC<NCMaterialConvertModalProps> = ({
                                                                           open,
                                                                           onCancel,
                                                                           isEditor,
                                                                           onSelect,
                                                                           converts,
                                                                       }) => {
    return (
        <RegisterInputModal<NCMaterialConvert, NCMaterialConvertViewProps>
            open={open}
            isEditor={isEditor}
            title={'单位选择'}
            editorKey={MATERIAL_CONVERT_EDITOR}
            editorPlaceholder="单位"
            onCancel={onCancel}
            onSelect={onSelect}
            width={600}
            height={400}
            View={NCMaterialConvertView}
            viewProps={{converts}}
        />
    );
}

export default NCMaterialConvertModal;
