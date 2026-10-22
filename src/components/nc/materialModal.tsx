import React, {type RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Button, Input, message, Modal, Splitter, Tree} from "antd";
import type {EditorRowAccessor} from "@/components/grid-table/editors/antd-editors.tsx";
import {registerAntdInputEditor} from "@/components/grid-table/editors/register.ts";
import type {BasicDataNode} from "antd/es/tree";
import type {NCMaterial, NCMaterialClassTree} from "@/api/schemas/nc/NCMaterial.ts";
import {ncMaterialApi, type NCMaterialQuery} from "@/api/modules/nc/material.ts";
import {isBlankExcept, toNumberOrNullIfZero, toStringOrEmpty} from "@/utils";
import {CheckOutlined} from "@ant-design/icons";
import {type AppColumnDef, GridTable, type GridTableApi} from "@/components/grid-table";
import {ErrorMessage} from "@/api/request.ts";


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

type NCMaterialProps = {
    /** 选择回调：双击行时，回传选中的整行记录 */
    onSelect?: (material: NCMaterial) => void;
    filter?: string[];
}

interface treeNode extends NCMaterialClassTree, BasicDataNode {
}

/**
 * 分类树占满面板剩余高度，超出的节点在树内部滚动。
 * 不给高度时树是自然高度，节点一多就把整个 Splitter 面板顶出滚动条
 * （面板自身 overflow:auto），滚轮一滚表头也跟着跑，看着像整页在动。
 */
const TREE_STYLE: React.CSSProperties = {
    userSelect: 'none',
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
};

const NCMaterial: React.FC<NCMaterialProps> = ({filter, onSelect}) => {

    const tableRef = useRef<GridTableApi | null>(null);
    const [keyword, setKeyword] = useState('');

    const [treeData, setTreeData] = useState<treeNode[]>();
    const [query, setQuery] = useState<NCMaterialQuery>({});
    const [nodeSelectedKeys, setSelectedNodes] = useState<string[]>([]);
    const [loadingMaterial, setLoadingMaterial] = useState<boolean>(false);
    const [materials, setMaterials] = useState<NCMaterial[]>([]);

    /**
     * 是否允许显示
     */
    const canShow = useCallback((code: string) => {
        if (!filter || filter.length === 0 || !code) {
            return true;
        }
        return filter.reduce((show, cur) => show || code.startsWith(cur) || cur.startsWith(code), false);
    }, [filter])


    const treeNodeParse = useCallback((node: treeNode) => {
        const hasChildren = node.children ? node.children.length > 0 : false;
        if (!hasChildren) {
            node.isLeaf = true;
            return
        }
        node.children?.forEach(child => {
            treeNodeParse(child);
        });
        node.children = node.children?.filter((node) => canShow(node.code ?? ''))
    }, [canShow])

    /**
     * 加载物料分类
     */
    const loadTreeData = useCallback(async () => {
        const result = await ncMaterialApi.classTree();
        if (result.data) {
            const datas = result.data.map((d) => {
                let node: treeNode = {...d};
                treeNodeParse(node);
                return node;
            }).filter((node) => canShow(node.code ?? ''));
            setTreeData(datas);
        }
    }, [treeNodeParse]);

    /**
     * 加载物料
     */
    const loadMaterialData = useCallback(async (query: NCMaterialQuery) => {
        if (isBlankExcept(query, [])) {
            return;
        }
        setLoadingMaterial(true);
        try {
            const result = await ncMaterialApi.query(query);
            const materials = result.data?.filter((d) => canShow(d.code ?? ''));
            setMaterials(materials ?? []);
        } catch (error) {
            void message.error(ErrorMessage(error, '查询失败'));
        } finally {
            setLoadingMaterial(false);
        }
    }, [canShow]);

    const columns = useMemo((): AppColumnDef[] => {
        return [
            {field: "name", title: '物料名称', minWidth: 150},
            {field: "code", title: '物料编码', minWidth: 150},
            {field: "materialspec", title: '规格', minWidth: 100},
            {field: "materialtype", title: '型号', minWidth: 100},
            {field: "measdoc", title: '主单位', minWidth: 100},
            {field: "IsFeature", title: '特征件', dataType: 'boolean'},
        ];
    }, []);

    useEffect(() => {
        void loadTreeData();
    }, []);

    useEffect(() => {
        void loadMaterialData(query);
    }, [query]);

    const handleDblClick = useCallback(() => {
        if (!tableRef.current || !onSelect) {
            return;
        }
        const activeRow = tableRef.current?.getActiveRow();
        if (!activeRow || activeRow.isSummaryRow || activeRow.isGroupRow) {
            return;
        }
        const m = materials?.find((m) => m.pk_material === activeRow.rowKey);
        if (!m) {
            return;
        }
        onSelect(m);
    }, [onSelect, materials]);

    return (
        <Splitter style={{
            flex: 1,
            minHeight: 0,
            height: 'auto',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            // 不要再加 boxShadow：`0 0 10px` 的模糊半径刚好等于 10px 圆角半径，
            // 阴影会把四个角的圆弧「填平」，看起来像圆角外面多了四块灰色直角背景。
            borderRadius: '10px',
            overflow: 'hidden',
        }}>
            {/* Splitter 面板不是 flex 容器，树要占满高度同样得靠 .splitter-pane-body */}
            <Splitter.Panel defaultSize="15%" min="10%" max="20%" className="splitter-pane-body">
                <Tree
                    showLine
                    fieldNames={{title: 'name', key: 'pkMarbasclass'}}
                    onSelect={(_, e) => {
                        let pkClass: string | undefined = undefined;
                        if (e.node) {
                            pkClass = toStringOrEmpty(e.node.pkMarbasclass);
                        }
                        if (!pkClass) {
                            pkClass = undefined;
                        }
                        if (query.PkClass === pkClass || !pkClass) {
                            return;
                        }
                        setSelectedNodes([pkClass]);
                        setQuery({
                            PkClass: pkClass,
                        });
                    }}
                    treeData={treeData}
                    style={TREE_STYLE}
                    selectedKeys={nodeSelectedKeys}
                />
            </Splitter.Panel>
            {/* Splitter 面板不是 flex 容器，表格需要外层给确定高度：见 .splitter-pane-body */}
            <Splitter.Panel className="splitter-pane-body">
                <div className="quick-select-toolbar" style={{margin: '10px'}}>
                    <span className="quick-select-label">搜索</span>
                    <Input
                        allowClear
                        value={keyword}
                        placeholder={'关键字'}
                        onChange={(event) => setKeyword(event.target.value)}
                        style={{width: 260}}
                    />
                    <Button type="primary" icon={<CheckOutlined/>} onClick={() => {
                        if (!keyword) {
                            return;
                        }
                        const query: NCMaterialQuery = {}
                        const mcode = toNumberOrNullIfZero(keyword);
                        if (mcode) {
                            query.Code = keyword;
                        } else {
                            query.Name = keyword;
                        }
                        setQuery(query);
                        setSelectedNodes([]);
                    }}>
                        搜索
                    </Button>
                </div>

                <div className="grid-table-host quick-select-table">
                    <GridTable
                        ref={tableRef}
                        columns={columns}
                        records={materials}
                        rowKey={'pk_material'}
                        highlightMode="row"
                        widthMode={'autoWidth'}
                        onCellDblClick={handleDblClick}
                        loading={loadingMaterial}
                    />
                </div>
            </Splitter.Panel>
        </Splitter>
    );
}

export type NCMaterialModalProps = {
    open: boolean;
    /** 选择回调：双击行时，回传选中的整行记录 */
    onSelect?: (material: NCMaterial, activeRow: EditorRowAccessor | null) => void;
    isEditor?: boolean;
    onCancel?: () => void;
    filter?: string[];
}

const NCMaterialModal: React.FC<NCMaterialModalProps> = ({open, onCancel, isEditor, onSelect, filter}) => {

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
        registerMaterialEditor(activeRowRef, openModal);
    }, [editor, openModal]);

    // 非编辑器模式（独立使用时）：开关完全跟着外部的 open 走
    useEffect(() => {
        if (editor) return;
        setIsOpen(open);
    }, [editor, open]);

    const selectedAction = useCallback((record: NCMaterial) => {
        onSelect?.(record, editingRow); // ← 回写目标，来自快照，不依赖 activeRow.current
        setIsOpen(false);
        editingRow?.endEdit();
        onCancel?.()
    }, [onSelect, editingRow]);

    return (
        <Modal
            open={isOpen}
            title={'物料选择'}
            width="60vw"
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
            {isOpen && <NCMaterial onSelect={selectedAction} filter={filter}/>}
        </Modal>
    );
}

export default NCMaterialModal;