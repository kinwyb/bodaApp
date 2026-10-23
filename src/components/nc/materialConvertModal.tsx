import React, {type RefObject, useCallback, useEffect, useRef, useState} from 'react';
import {QuickSelectView} from '../QuickSelectModal';
import type {AppColumnDef} from '../grid-table/columnBuilder';
import type {NCMaterialConvert} from "@/api/schemas/nc/NCMaterial.ts";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors.tsx";
import {Modal} from "antd";
import {registerAntdInputEditor} from "@/components/grid-table/editors/register.ts";


/**
 * 物料单位转换编辑器
 */
export const MATERIAL_CONVERT_EDITOR = 'material-convert-editor';

/**
 * 注册物料单位转换编辑器，
 * 用法：
 * const activeRowRef = useRef<EditorRowAccessor | null>(null);
 * const [modalOpen, setModalOpen] = useState(false);
 * const [editingRow, setEditingRow] = useState<EditorRowAccessor | null>(null);
 *
 * const openModal = useCallback((open: boolean, row?: EditorRowAccessor) => {
 *   if (open) setEditingRow(row ?? null);
 *   setModalOpen(open);
 * }, []);
 *
 * // 注册（确认组件常驻，或配合"更新式注册"）
 * useEffect(() => {
 *   registerMaterialConvertEditor(activeRowRef, openModal);
 * }, [openModal]);
 *
 * const handleConfirm = (data: MaterialData) => {
 *   editingRow?.record;      // ← 回写目标，来自快照，不依赖 activeRow.current
 *   setModalOpen(false);
 *   editingRow?.endEdit();
 * };
 * @param activeRow
 * @param openModal
 */
const registerMaterialConvertEditor = (
    activeRow: RefObject<EditorRowAccessor | null>,
    openModal: (open: boolean, row?: EditorRowAccessor) => void,
) => {
    registerAntdInputEditor(
        MATERIAL_CONVERT_EDITOR,
        {
            placeholder: '物料单位',
            onSearch: () => {
                openModal(true, activeRow.current ?? undefined);   // ← 带出目标行
            },
        },
        {
            onStart: (row) => {
                activeRow.current = row;
            },
            onEnd: () => {
                activeRow.current = null;
            },
        }
    );
};


/** 单位列 */
const MEASDOC_COLUMNS: AppColumnDef[] = [
    {field: 'measdocCode', title: '单位编码', width: 110},
    {field: 'measdoc', title: '单位名称', width: 140},
    {field: 'measrate', title: '转换率', width: 240},
];

export interface NCMeasdocProps {
    /** 选择回调 */
    onSelect: (measdoc: NCMaterialConvert) => void;
    converts?: NCMaterialConvert[];
}

const NCMaterialConvertView: React.FC<NCMeasdocProps> = ({onSelect, converts}) => {

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


export type NCMaterialConvertModalProps = {
    open: boolean;
    /** 选择回调：双击行时，回传选中的整行记录 */
    onSelect?: (measdoc: NCMaterialConvert, activeRow: EditorRowAccessor | null) => void;
    isEditor?: boolean;
    onCancel?: () => void;
    converts?: NCMaterialConvert[];
}

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

    const activeRowRef = useRef<EditorRowAccessor | null>(null);
    const [isOpen, setIsOpen] = useState<boolean>(open);
    const [editingRow, setEditingRow] = useState<EditorRowAccessor | null>(null);
    const editor = isEditor ?? false;

    /**
     * 由表格里的编辑器（输入框右侧搜索图标）打开：目标行在这里快照一次，
     * 之后回写只认这份快照，不再从 activeRowRef 取（编辑态可能已经被 ESC 收掉）。
     */
    const openModal = useCallback((next: boolean, row?: EditorRowAccessor) => {
        if (next) setEditingRow(row ?? null);
        setIsOpen(next);
    }, []);

    /*
     * 两段 effect 都必须无条件调用（react-hooks/rules-of-hooks）：
     * 条件写在外面（if (editor) {...} else {...}）一旦 isEditor 变化，hook 顺序就错乱，
     * 这里改成「effect 一直调用、条件判断移进回调」。
     */
    // 注册（确认组件常驻，或配合"更新式注册"）。注册表同名幂等，重复注册不会覆盖已有实例。
    useEffect(() => {
        if (!editor) return;
        registerMaterialConvertEditor(activeRowRef, openModal);
    }, [editor, openModal]);

    // 非编辑器模式（独立使用时）：开关完全跟着外部的 open 走
    useEffect(() => {
        if (editor) return;
        setIsOpen(open);
    }, [editor, open]);

    const selectedAction = useCallback((record: NCMaterialConvert) => {
        onSelect?.(record, editingRow); // ← 回写目标，来自快照，不依赖 activeRow.current
        editingRow?.endEdit();
        setIsOpen(false);
        onCancel?.()
    }, [onSelect, editingRow]);

    return (
        <Modal
            open={isOpen}
            title={'物料选择'}
            width={600}
            height={400}
            // 关闭即销毁内容：详情表格是 canvas 组件，留在隐藏容器里不但占资源，
            // 下次打开还会带着上一轮的内部状态被 resize（见下面 !open 分支的说明）。
            destroyOnHidden
            style={{top: 24, maxWidth: 1600}}
            styles={{
                body: {
                    height: 'calc(100vh - 168px)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                },
            }}
            footer={null}
            mask={{closable: false}}
            onCancel={() => {
                setIsOpen(false);
                onCancel?.();
            }}
        >
            {isOpen && <NCMaterialConvertView onSelect={selectedAction} converts={converts}/>}
        </Modal>
    );
}

export default NCMaterialConvertModal;
