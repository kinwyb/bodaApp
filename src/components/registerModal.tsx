import React, {type ReactNode, useCallback, useEffect, useRef, useState} from "react";
import {type EditorRowAccessor, registerAntdInputEditor} from "@/components/grid-table/editors/register.ts";
import {Modal} from "antd";

/**
 * 内容区「最多一屏」的高度：100vh 减窗口上下留白与标题栏。
 *
 * 没传 `height` 时按它封顶 —— 数据少时弹窗随内容变矮，数据多了就在表格内部滚动。
 * 刻意不导出：本文件是 .tsx，多导出一个常量会让 Fast Refresh 退化成整页刷新。
 */
const MAX_BODY_HEIGHT = 'calc(100vh - 168px)';

interface registerModalProps<TRecord, TViewProps extends object = object> {
    open: boolean;
    isEditor?: boolean;
    /** 编辑模式下注册输入编辑器的 key */
    editorKey?: string;
    editorPlaceholder?: string;
    title?: ReactNode;
    width?: number | string;
    height?: number | string;
    readOnly?: boolean;
    disabled?: boolean;
    onCancel?: () => void;
    onSelect?: (record: TRecord, editingRow: EditorRowAccessor | null) => void;
    onInput?: (input: string, editingRow: EditorRowAccessor) => void;
    View: React.ComponentType<TViewProps & { onSelect: (record: TRecord) => void }>;
    /** 透传给视图的 props，不要包含 onSelect */
    viewProps?: Omit<TViewProps, 'onSelect'>;
    /**
     * 根据行数据更新要透传给视图的 props，在open时触发
     */
    updateViewProps?: (viewProps?: Omit<TViewProps, 'onSelect'>, row?: EditorRowAccessor) => Omit<TViewProps, 'onSelect'>;
}

export type RegisterModalProps<TRecord, TViewProps extends object = object> = {
    open: boolean;
    /**
     * 从弹窗里选了一行：回传整行记录 + 当前编辑行。
     */
    onSelect?: (record: TRecord, activeRow: EditorRowAccessor | null) => void;
    /**
     * 用户**没从弹窗里选**，而是直接在单元格里输入内容并回车提交：回传输入文本 + 当前编辑行。
     *
     * 用来做「输入编码 → 查基础资料 → 回填整行」这类联动（弹窗只是可选的辅助入口）：
     *
     * ```tsx
     * onInput={async (code, row) => {
     *     const material = (await materialApi.query({Code: code})).data?.[0];
     *     if (!material) return;
     *     row.setFields({...});
     *     row.endEdit();
     * }}
     * ```
     *
     * - 只在**值真的变了**的时候触发（只按回车、值没变不会重复查一次）；
     * - 弹窗选中走 `onSelect`，不会再来一遍 `onInput`（程序化回填触发的那次提交会被吞掉）；
     * - 回调时可以异步处理：编辑已经结束时 `setFields` 照样写得进去（按行对象定位）。
     */
    onInput?: (input: string, activeRow: EditorRowAccessor) => void;
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
                                                                                    readOnly = false,
                                                                                    disabled = false,
                                                                                    height,
                                                                                    onCancel,
                                                                                    onSelect,
                                                                                    onInput,
                                                                                    View,
                                                                                    viewProps,
                                                                                    updateViewProps,
                                                                                }: registerModalProps<TRecord, TViewProps>) {
    const editor = isEditor ?? false;
    const [isOpen, setIsOpen] = useState(open);
    const [editingRow, setEditingRow] = useState<EditorRowAccessor | null>(null);
    const activeRowRef = useRef<EditorRowAccessor | null>(null);
    // 编辑器是全局只注册一次的（registerOnce），注册时拿到的闭包不会跟着 props 更新，
    // 所以回调必须走 ref —— 否则页面里内联的 onInput 永远是第一版
    const onInputRef = useRef(onInput);
    const [realViewProps, setRealViewProps] = useState<Omit<TViewProps, 'onSelect'> | undefined>(viewProps);

    useEffect(() => {
        onInputRef.current = onInput;
    }, [onInput]);

    const openModal = useCallback((next: boolean, row?: EditorRowAccessor) => {
        if (next) setEditingRow(row ?? null);
        setIsOpen(next);
        const newViewProps = updateViewProps?.(viewProps, row);
        if (newViewProps) {
            setRealViewProps(newViewProps);
        }
    }, [viewProps]);

    // 编辑器模式：自动注册，editorKey 不同而已
    useEffect(() => {
        if (!editor || !editorKey) return;
        registerAntdInputEditor(
            editorKey,
            {
                readOnly: readOnly,
                disabled: disabled,
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
                // 用户直接在格子里输入后回车 = 一次提交；值没变就不算「输入」
                onCommit: ({value, previousValue}, row) => {
                    if (value === previousValue) return;
                    const input = `${value ?? ''}`.trim();
                    if (!input) return;
                    onInputRef.current?.(input, row);
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

    /**
     * 交给 View 的那份 props。
     *
     * **独立模式（`open` 由外部控制）必须现算，不能靠 effect 补**：以前只在编辑器的
     * `openModal()` 里调 `updateViewProps`，所以 `NCMaterialConvertModal` 这类
     * 「外部 open + viewProps 函数」的组合永远拿不到 props（视图里 `materialVID.trim()`
     * 直接炸）。而用 effect 也不行 —— open 变 true 的那一帧 View 已经挂载，effect 里的
     * setState 要下一帧生效，这一帧收到的仍是旧值。
     *
     * `updateViewProps` 的语义就是「按当前记录映射一份 props」，是纯函数，渲染期调用没有副作用；
     * 编辑器模式仍走 `realViewProps`（那条路的行对象只有点开编辑器时才知道）。
     */
    const activeViewProps = editor
        ? realViewProps
        : open
            ? (updateViewProps?.(viewProps, undefined) ?? viewProps)
            : realViewProps;

    return (
        <Modal
            open={isOpen}
            title={title}
            width={width}
            destroyOnHidden
            style={{top: 24}}
            styles={{
                body: {
                    // 高度由调用方决定：
                    // - 不传 height（默认）：只封一屏的上限，弹窗随内容变矮（数据少时别撑满整屏）；
                    // - 传了 height：内容区固定那么高，View 里 height:100% 的表格直接撑满。
                    // 两种情况下 body 都是 flex 列，子项（View 的根节点）要自己给出确定高度 ——
                    // 里面是 canvas 表格，容器高度不定就画不出来。
                    ...(height
                        ? { height }
                        : { maxHeight: MAX_BODY_HEIGHT }),
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
            {isOpen && <View {...(activeViewProps as TViewProps)} onSelect={selectedAction}/>}
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