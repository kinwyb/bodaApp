import React, {type ReactNode, useCallback, useEffect, useRef, useState} from "react";
import {type EditorRowAccessor, registerAntdInputEditor} from "@/components/grid-table/editors/register.ts";
import {Modal} from "antd";

interface registerModalProps<TRecord, TViewProps extends object = object> {
    open: boolean;
    isEditor?: boolean;
    /** 编辑模式下注册输入编辑器的 key */
    editorKey?: string;
    editorPlaceholder?: string;
    title?: ReactNode;
    width?: number | string;
    height?: number | string;
    onCancel?: () => void;
    onSelect?: (record: TRecord, editingRow: EditorRowAccessor | null) => void;
    View: React.ComponentType<TViewProps & { onSelect: (record: TRecord) => void }>;
    /** 透传给视图的 props，不要包含 onSelect */
    viewProps: Omit<TViewProps, 'onSelect'>;
}

export type RegisterModalProps<TRecord, TViewProps extends object = object> = {
    open: boolean;
    onSelect?: (record: TRecord, activeRow: EditorRowAccessor | null) => void;
    isEditor?: boolean;
    onCancel?: () => void;
} & Omit<TViewProps, 'onSelect'>

export function RegisterInputModal<TRecord, TViewProps extends object = object>({
                                                                                    open,
                                                                                    isEditor,
                                                                                    editorKey,
                                                                                    editorPlaceholder,
                                                                                    title = '选择',
                                                                                    width = '60vw',
                                                                                    height,
                                                                                    onCancel,
                                                                                    onSelect,
                                                                                    View,
                                                                                    viewProps,
                                                                                }: registerModalProps<TRecord, TViewProps>) {
    const editor = isEditor ?? false;
    const [isOpen, setIsOpen] = useState(open);
    const [editingRow, setEditingRow] = useState<EditorRowAccessor | null>(null);
    const activeRowRef = useRef<EditorRowAccessor | null>(null);

    const openModal = useCallback((next: boolean, row?: EditorRowAccessor) => {
        if (next) setEditingRow(row ?? null);
        setIsOpen(next);
    }, []);

    // 编辑器模式：自动注册，editorKey 不同而已
    useEffect(() => {
        if (!editor || !editorKey) return;
        registerAntdInputEditor(
            editorKey,
            {
                placeholder: editorPlaceholder ?? '',
                onSearch: () => openModal(true, activeRowRef.current ?? undefined),
            },
            {
                onStart: (row) => {
                    activeRowRef.current = row;
                },
                onEnd: () => {
                    activeRowRef.current = null;
                },
            },
        );
    }, [editor, editorKey, editorPlaceholder, openModal]);

    // 独立模式：跟随外部 open
    useEffect(() => {
        if (editor) return;
        setIsOpen(open);
    }, [editor, open]);

    const selectedAction = useCallback((record: TRecord) => {
        onSelect?.(record, editingRow);
        setIsOpen(false);
        editingRow?.endEdit(); // 通用收尾，放这里
        onCancel?.();
    }, [onSelect, editingRow, onCancel]);

    return (
        <Modal
            open={isOpen}
            title={title}
            width={width}
            height={height}
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
            {isOpen && <View {...(viewProps as TViewProps)} onSelect={selectedAction}/>}
        </Modal>
    );
}


/**
 * 手动注册编辑器用法
 */
// export const MATERIAL_EDITOR = 'material-editor';

/**
 * 注册物料编辑器，
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
 *   registerBomMatrixMaterialEditor(activeRowRef, openModal);
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
// const registerMaterialEditor = (
//     activeRow: RefObject<EditorRowAccessor | null>,
//     openModal: (open: boolean, row?: EditorRowAccessor) => void,
// ) => {
//     registerAntdInputEditor(
//         MATERIAL_EDITOR,
//         {
//             placeholder: '物料',
//             onSearch: () => {
//                 openModal(true, activeRow.current ?? undefined);   // ← 带出目标行
//             },
//         },
//         {
//             onStart: (row) => {
//                 activeRow.current = row;
//             },
//             onEnd: () => {
//                 activeRow.current = null;
//             },
//         }
//     );
// };