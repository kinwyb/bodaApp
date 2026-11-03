import React, {useCallback} from 'react';
import {QuickSelectView} from '../QuickSelectModal';
import type {AppColumnDef} from '../grid-table/columnBuilder';
import type {NCMaterialConvert} from "@/api/schemas/nc/NCMaterial.ts";
import {RegisterInputModal, type RegisterModalProps} from "@/components/registerModal.tsx";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors.tsx";
import {ensureConverts, readConverts} from './convertCache.ts';


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
    /**
     * 这一行是哪个物料 —— 可选单位**按物料**取。
     *
     * 不在外面把列表算好传进来（挂载时定死一份数组）：一张表里每行是不同的物料，
     * 而且默认加载的行一开始根本没有列表，得现查。查询的时机交给视图自己（打开就加载），
     * 表格那边就只负责回答「这一行是哪个物料」。
     */
    materialVID: string;
}

const NCMaterialConvertView: React.FC<NCMaterialConvertViewProps> = ({onSelect, materialVID}) => {

    const loadData = useCallback(async () => {
        const id = materialVID.trim();
        if (!id) {
            return [];
        }
        // 选过物料的话缓存里已经有了，直接给；没有就现查一次（同一物料只会查一次）
        const cached = readConverts(id);
        if (cached) {
            return cached;
        }
        return (await ensureConverts(id)) ?? [];
    }, [materialVID]);

    return (
        <QuickSelectView<NCMaterialConvert>
            columns={MEASDOC_COLUMNS}
            rowKey="pk_materialconvert"
            loadData={loadData}
            // 过滤字段要对上 `NCMaterialConvert` 的字段名：原来是 Code/Name（物料的字段），
            // 在这里一个都匹配不到，等于搜索框永远筛掉全部
            searchFields={['measdocCode', 'measdoc']}
            searchLabel="快速选择:"
            searchPlaceholder={'单位编码 / 名称'}
            emptyTip={'该物料没有可选的换算单位'}
            autoFillWidth={true}
            onSelect={(row) => row && onSelect(row)}
        />
    );
};


export type NCMaterialConvertModalProps =
    Omit<RegisterModalProps<NCMaterialConvert, NCMaterialConvertViewProps>, 'materialVID'>
    & {
        /**
         * **打开弹窗那一刻**按当前编辑行算这一格属于哪个物料。
         *
         * 函数形态在点开弹窗时求值（`RegisterInputModal` 的 `updateViewProps`），读的是行上的字段 ——
         * 所以**别在这种函数里读组件 state**：编辑器是全局只注册一次的，
         * 注册时拿到的闭包不会跟着 props 更新。
         */
        viewProps: (record?: EditorRowAccessor) => Omit<NCMaterialConvertViewProps, 'onSelect'>;
        /**
         * 编辑器注册名，默认 `MATERIAL_CONVERT_EDITOR`。
         *
         * 同一页面有多个表格实例时（页面只读一张 + 弹窗可编辑一张）必须各用各的名字：
         * 注册表全局、同名先到先得，后注册的会被忽略（见 `bomMatrix/editorScope.ts`）。
         */
        editorKey?: string;
    };

/**
 * 物料单位选择
 */
const NCMaterialConvertModal: React.FC<NCMaterialConvertModalProps> = ({
                                                                           open,
                                                                           onCancel,
                                                                           isEditor,
                                                                           onSelect,
                                                                           onInput,
                                                                           viewProps,
                                                                           editorKey = MATERIAL_CONVERT_EDITOR,
                                                                       }) => {
    return (
        <RegisterInputModal<NCMaterialConvert, NCMaterialConvertViewProps>
            open={open}
            isEditor={isEditor}
            title={'单位选择'}
            editorKey={editorKey}
            editorPlaceholder="单位"
            onCancel={onCancel}
            onSelect={onSelect}
            onInput={onInput}
            width={600}
            height={400}
            View={NCMaterialConvertView}
            updateViewProps={(_, row) => viewProps(row)}
        />
    );
}

export default NCMaterialConvertModal;
