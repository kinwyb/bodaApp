import React, {useCallback} from 'react';
import {QuickSelectView} from '../QuickSelectModal';
import type {AppColumnDef} from '../grid-table/columnBuilder';
import type {NCMaterialConvert} from "@/api/schemas/nc/NCMaterial.ts";
import {RegisterInputModal, type RegisterModalProps} from "@/components/registerModal.tsx";
import type {NCProductor} from "@/api/schemas/nc/NCBase.ts";
import {ncBaseApi} from "@/api/modules/nc/base.ts";


/**
 * 供应商编辑器
 */
export const PRODUCTOR_EDITOR = 'productor-editor';

/** 供应商列 */
const PRODUCTOR_COLUMNS: AppColumnDef[] = [
    {field: 'code', title: '编码', width: 110},
    {field: 'name', title: '名称', width: 140},
];

export interface NCProductorViewProps {
    /** 选择回调 */
    onSelect: (productor: NCProductor) => void;
}

const NCProductorView: React.FC<NCProductorViewProps> = ({onSelect}) => {

    const loadData = useCallback(async (): Promise<NCProductor[]> => {
        console.log("请求");
        const result = await ncBaseApi.productor();
        if (!result.data) {
            return [];
        }
        return result.data;
    }, []);

    return (
        <QuickSelectView<NCProductor>
            columns={PRODUCTOR_COLUMNS}
            rowKey="pk_defdoc"
            loadData={loadData}
            searchFields={['code', 'name']}
            searchLabel="快速选择:"
            searchPlaceholder={'关键字'}
            emptyTip={'请先选择生产厂商'}
            autoFillWidth={true}
            onSelect={(row) => row && onSelect(row)}
        />
    );
};


export type NCProductorModalProps = RegisterModalProps<NCProductor, NCProductorViewProps>;

/**
 * 生产厂商选择
 */
const NCProductorModal: React.FC<NCProductorModalProps> = ({
                                                               open,
                                                               onCancel,
                                                               isEditor,
                                                               onSelect,
                                                           }) => {
    return (
        <RegisterInputModal<NCMaterialConvert, NCProductorViewProps>
            open={open}
            isEditor={isEditor}
            title={'选择生产厂商'}
            editorKey={PRODUCTOR_EDITOR}
            editorPlaceholder="生产厂商"
            onCancel={onCancel}
            onSelect={onSelect}
            width={600}
            height={400}
            View={NCProductorView}
            viewProps={{}}
        />
    );
}

export default NCProductorModal;
