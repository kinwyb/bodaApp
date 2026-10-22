import React, {type RefObject, useCallback, useEffect, useRef, useState} from "react";
import {Button, Modal} from "antd";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors.tsx";
import {registerAntdInputEditor} from "@/components/grid-table/editors/register.ts";


/**
 * 物料编辑器
 */
export const MATERIAL_EDITOR = 'material-editor';

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
const registerMaterialEditor = (
    activeRow: RefObject<EditorRowAccessor | null>,
    openModal: (open: boolean, row?: EditorRowAccessor) => void,
) => {
    registerAntdInputEditor(
        MATERIAL_EDITOR,
        {
            placeholder: '物料',
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

export type NCMaterialProps = {
    open: boolean;
    /** 选择回调：双击行时，回传选中的整行记录 */
    onSelect?: (record: Record<string, unknown>, activeRow: EditorRowAccessor | null) => void;
    isEditor?: boolean;
    onCancel?: () => void;
}

const NCMaterial: React.FC<NCMaterialProps> = ({open, onCancel, isEditor, onSelect}) => {

    const activeRowRef = useRef<EditorRowAccessor | null>(null);
    const [isOpen, setIsOpen] = useState<boolean>(open);
    const [editingRow, setEditingRow] = useState<EditorRowAccessor | null>(null);
    const editor = isEditor ?? false;

    if (editor) {
        const openModal = useCallback((open: boolean, row?: EditorRowAccessor) => {
            if (open) setEditingRow(row ?? null);
            setIsOpen(open);
        }, []);
        // 注册（确认组件常驻，或配合"更新式注册"）
        useEffect(() => {
            if (editor) {
                registerMaterialEditor(activeRowRef, openModal);
            }
        }, []);
    } else {
        useEffect(() => {
            setIsOpen(open);
        }, [open]);
    }

    const selectedCb = useCallback(() => {
        onSelect?.({}, editingRow); // ← 回写目标，来自快照，不依赖 activeRow.current
        setIsOpen(false);
        editingRow?.endEdit();
    }, [onSelect, editingRow]);

    return (
        <Modal
            open={isOpen}
            title={'物料选择'}
            width="94vw"
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
                onCancel && onCancel();
            }}
        >
            <Button onClick={selectedCb}/>
        </Modal>
    );
}

export default NCMaterial;