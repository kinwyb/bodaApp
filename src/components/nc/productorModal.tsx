import React, {useCallback} from 'react';
import {QuickSelectView} from '../QuickSelectModal';
import type {AppColumnDef} from '../grid-table/columnBuilder';
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
            // 列表是基础档案全量，不依赖别的选择：空就是真的没有档案
            emptyTip={'暂无生产厂商档案'}
            autoFillWidth={true}
            onSelect={(row) => row && onSelect(row)}
        />
    );
};


export type NCProductorModalProps = RegisterModalProps<NCProductor, NCProductorViewProps> & {
    /**
     * 编辑器注册名，默认 `PRODUCTOR_EDITOR`。
     *
     * 同一页面有多个表格实例时（页面只读一张 + 弹窗可编辑一张）必须各用各的名字：
     * 注册表全局、同名先到先得，后注册的会被忽略（见 `bomMatrix/editorScope.ts`）。
     */
    editorKey?: string;
};

/**
 * 生产厂商选择
 */
const NCProductorModal: React.FC<NCProductorModalProps> = ({
                                                               open,
                                                               onCancel,
                                                               isEditor,
                                                               onSelect,
                                                               onInput,
                                                               editorKey = PRODUCTOR_EDITOR,
                                                           }) => {
    return (
        <RegisterInputModal<NCProductor, NCProductorViewProps>
            open={open}
            isEditor={isEditor}
            title={'选择生产厂商'}
            editorKey={editorKey}
            editorPlaceholder="生产厂商"
            onCancel={onCancel}
            onSelect={onSelect}
            // 用户不走弹窗、直接在格子里输入编码/名称回车的那条路：不传下去就永远收不到
            onInput={onInput}
            width={600}
            height={400}
            View={NCProductorView}
        />
    );
}

export default NCProductorModal;
