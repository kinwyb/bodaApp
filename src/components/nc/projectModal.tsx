/**
 * 项目选择弹窗，结构照抄 `NCMaterialView`：**左侧项目分类树 + 右侧项目表格**，
 * 双击一行（或点「选择」）把整行 `NCProject` 回传给调用方。
 *
 * 与物料弹窗的差别（都是后端接口决定的，不是刻意的设计选择）：
 * - 项目分页查询 `/nc/base/project/queryWithPage` **必须带分类**（`projectClassID` 是必填），
 *   不像物料那样「不选分类=查全部」。所以打开时先取分类树、**自动选中第一个根分类**，
 *   右侧才不是空白 —— 否则用户看到的是一个永远空的表，像是坏了；
 * - 结果是分页的（`pageIndex`），前端只翻页，**页大小由后端说了算**（接口没有 pageSize），
 *   每页条数从响应的 `page.rows` 取，取不到就按本次返回的行数兜底；
 * - 分类下没有项目才是真的没有（分类是必填条件），所以空表提示分两种：没选分类 / 该分类为空。
 *
 * 搜索框只在**当前这一页**里做本地包含匹配（编码 / 名称）：接口只支持按分类分页查，
 * 没有关键字参数，做成「输入即请求」会给人「全库搜索」的错觉。
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Input, message, Pagination, Splitter, Tree} from 'antd';
import type {BasicDataNode} from 'antd/es/tree';
import {CheckOutlined} from '@ant-design/icons';
import {type AppColumnDef, GridTable, type GridTableApi} from '@/components/grid-table';
import {RegisterInputModal, type RegisterModalProps} from '@/components/registerModal.tsx';
import {ncBaseApi} from '@/api/modules/nc/base.ts';
import type {NCProject, NCProjectClass} from '@/api/schemas/nc/NCBase.ts';
import {ErrorMessage} from '@/api/request.ts';
import {toNumberOrZero, toStringOrEmpty} from '@/utils';

/** 项目编辑器注册名 */
export const PROJECT_EDITOR = 'project-editor';

export type NCProjectViewProps = {
    /** 选中回调：双击行或点「选择」时，回传选中的整行记录 */
    onSelect?: (project: NCProject) => void;
    /**
     * 打开时预填的搜索关键字（`ProjectSelect` 会把输入框里已有的编码带进来）。
     *
     * 只在挂载时取一次：弹窗是 `destroyOnHidden`，每次打开都是新实例，
     * 所以「每次打开都按外部那个值起头」是成立的；打开后用户改成什么就是什么。
     */
    defaultKeyword?: string;
};

interface ProjectTreeNode extends NCProjectClass, BasicDataNode {
}

/** 树占满面板剩余高度，节点多了在树内部滚动（同物料弹窗） */
const TREE_STYLE: React.CSSProperties = {
    userSelect: 'none',
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
};

/** 分页控件在拿到后端页大小之前的兜底值，只影响页码显示 */
const DEFAULT_PAGE_ROWS = 20;

/** 本地过滤字段：编码与名称，项目上也没有别的可认的字段 */
const SEARCH_FIELDS: Array<keyof NCProject> = ['project_code', 'project_name'];

/** 只有两列，够用就行 —— 弹窗不用铺满一屏 */
const PROJECT_COLUMNS: AppColumnDef[] = [
    {field: 'project_code', title: '项目编码', width: 150},
    {field: 'project_name', title: '项目名称', width: 240},
];

/**
 * 补上 `isLeaf`：`children` 为 `null` / 空数组时 antd 仍会画一个展开箭头，
 * 点下去什么都不发生。父节点也顺手把 null 归一成 undefined（Tree 只认数组）。
 */
function toTreeNode(source: NCProjectClass): ProjectTreeNode {
    const children = source.children ?? [];
    const node: ProjectTreeNode = {...source, children: children.length > 0 ? children.map(toTreeNode) : undefined};
    if (!node.children) {
        node.isLeaf = true;
    }
    if (!node.pk_projectclass) {
        node.pk_projectclass = "~"
    }
    return node;
}

/**
 * 所有**有子分类**的 key —— 默认全部展开。
 *
 * 与物料分类树的「只展开第一级」不同：项目分类一般只有两三层、节点也不多，
 * 全展开能一眼看到底；只展开一级的话，用户还得自己点开两次才够得着要选的那一支。
 */
function expandableKeys(nodes: ProjectTreeNode[]): string[] {
    const keys: string[] = [];
    const walk = (list: ProjectTreeNode[]) => {
        list.forEach((node) => {
            const key = toStringOrEmpty(node.pk_projectclass);
            if (!key || !node.children || node.children.length === 0) return;
            keys.push(key);
            walk(node.children);
        });
    };
    walk(nodes);
    return keys;
}

const NCProjectView: React.FC<NCProjectViewProps> = ({onSelect, defaultKeyword}) => {

    const tableRef = useRef<GridTableApi | null>(null);
    const [keyword, setKeyword] = useState(defaultKeyword ?? '');

    const [treeData, setTreeData] = useState<ProjectTreeNode[]>();
    /**
     * 树的展开状态 —— **受控**。分类树是异步取回来的，`defaultExpandAll` 只在首帧生效，
     * 那一帧 `treeData` 还是空的，写默认值等于没写。想在数据到达时展开，
     * 只能把节点的 key 填进受控的 `expandedKeys`（同物料弹窗踩过的坑）。
     */
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

    const [classID, setClassID] = useState('');
    const [pageIndex, setPageIndex] = useState(1);
    const [pageRows, setPageRows] = useState(DEFAULT_PAGE_ROWS);
    const [total, setTotal] = useState(0);
    const [projects, setProjects] = useState<NCProject[]>([]);
    const [loading, setLoading] = useState(false);

    /** 定下一个分类：换分类要回到第一页，否则会停在上一个分类的页码上（可能早已越界） */
    const pickClass = useCallback((pkProjectClass: string) => {
        setSelectedKeys([pkProjectClass]);
        setClassID(pkProjectClass);
        setPageIndex(1);
    }, []);

    /**
     * 加载项目分类。数据到手后：**全展开分类树** + 自动选中第一个根分类。
     * 自动选中是因为分类是查询的必填条件 —— 不替用户选一个，右侧就一直是空的。
     */
    const loadTreeData = useCallback(async () => {
        try {
            const result = await ncBaseApi.projectClass();
            const datas = (result.data ?? []).map(toTreeNode);
            setTreeData(datas);
            setExpandedKeys(expandableKeys(datas));
            const first = datas.map((node) => toStringOrEmpty(node.pk_projectclass)).find((key) => key !== '');
            if (first) {
                pickClass(first);
            }
        } catch (error) {
            void message.error(ErrorMessage(error, '项目分类加载失败'));
        }
    }, [pickClass]);

    useEffect(() => {
        void loadTreeData();
    }, [loadTreeData]);

    /**
     * 按分类 + 页码取项目。
     *
     * `pageIndex` 是后端的分页参数（这个接口没有 pageSize，页大小由服务端决定），
     * 总数 / 页大小从响应的 `page` 里取，取不到就按本次返回的行数兜底 —— 至少翻页按钮能正常工作。
     */
    useEffect(() => {
        if (!classID) return;
        let alive = true;
        setLoading(true);
        void (async () => {
            try {
                const result = await ncBaseApi.projects({projectClassID: classID, pageIndex});
                if (!alive) return;
                const rows = result.data?.result ?? [];
                setProjects(rows);
                setTotal(toNumberOrZero(result.data?.countRows) || rows.length);
                setPageRows(toNumberOrZero(result.data?.pageRows) || rows.length || DEFAULT_PAGE_ROWS);
            } catch (error) {
                if (!alive) return;
                setProjects([]);
                setTotal(0);
                void message.error(ErrorMessage(error, '项目查询失败'));
            } finally {
                if (alive) setLoading(false);
            }
        })();
        // 翻页中途换分类 / 关弹窗：回来的旧结果直接丢掉，别把上一页的行铺到新分类上
        return () => {
            alive = false;
        };
    }, [classID, pageIndex]);

    /** 本页内的本地过滤（接口没有关键字参数，见文件头） */
    const filterText = keyword.trim().toLowerCase();
    const displayProjects = useMemo(() => {
        if (!filterText) {
            return projects;
        }
        return projects.filter((project) =>
            SEARCH_FIELDS.some((field) => toStringOrEmpty(project[field]).toLowerCase().includes(filterText)),
        );
    }, [projects, filterText]);

    /** 取当前选中行对应的项目：表格给的是 rowKey，按主键回查一份（同物料弹窗） */
    const getActiveProject = useCallback((): NCProject | null => {
        const activeRow = tableRef.current?.getActiveRow();
        if (!activeRow || activeRow.isSummaryRow || activeRow.isGroupRow) {
            return null;
        }
        return displayProjects.find((project) => project.pk_project === activeRow.rowKey) ?? null;
    }, [displayProjects]);

    const handleConfirm = useCallback(() => {
        const project = getActiveProject();
        if (!project) {
            void message.warning('请选择一行项目');
            return;
        }
        onSelect?.(project);
    }, [getActiveProject, onSelect]);

    const handleDblClick = useCallback(() => {
        const project = getActiveProject();
        if (project) {
            onSelect?.(project);
        }
    }, [getActiveProject, onSelect]);

    /*
     * 空表提示分三种，别让用户对着空白猜：
     * 没选分类 / 该分类确实没有 / 有关键字但只过滤了本页（很容易被当成「查不到这个项目」）。
     */
    const emptyTip = !classID
        ? '请先在左侧选择项目分类'
        : filterText && projects.length > 0
            ? `本页没有匹配「${keyword.trim()}」的项目：换左侧分类或翻页再试`
            : '该分类下暂无项目';

    return (
        <Splitter style={{
            flex: 1,
            minHeight: 0,
            height: 'auto',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            // 不要加 boxShadow：模糊半径等于圆角半径，会把四个角的圆弧「填平」
            borderRadius: '10px',
            overflow: 'hidden',
        }}>
            {/* Splitter 面板不是 flex 容器，树要占满高度得靠 .splitter-pane-body */}
            <Splitter.Panel defaultSize="32%" min="24%" max="50%" className="splitter-pane-body">
                <Tree
                    showLine
                    fieldNames={{title: 'type_name', key: 'pk_projectclass'}}
                    expandedKeys={expandedKeys}
                    onExpand={(keys) => setExpandedKeys([...keys])}
                    treeData={treeData}
                    style={TREE_STYLE}
                    selectedKeys={selectedKeys}
                    onSelect={(_, info) => {
                        const pkProjectClass = toStringOrEmpty(info.node.pk_projectclass);
                        // 重复点同一个分类不再查一遍（点已选中的节点 antd 会带空 selectedKeys 回调）
                        if (!pkProjectClass || pkProjectClass === classID) {
                            return;
                        }
                        pickClass(pkProjectClass);
                    }}
                />
            </Splitter.Panel>
            <Splitter.Panel className="splitter-pane-body">
                <div className="quick-select-toolbar" style={{margin: '10px'}}>
                    <span className="quick-select-label">搜索</span>
                    <Input
                        allowClear
                        value={keyword}
                        placeholder={'编码 / 名称（本页）'}
                        onChange={(event) => setKeyword(event.target.value)}
                        style={{width: 200}}
                    />
                    <Button type="primary" icon={<CheckOutlined/>} onClick={handleConfirm}>
                        选择
                    </Button>
                </div>

                <div className="grid-table-host quick-select-table">
                    <GridTable
                        ref={tableRef}
                        columns={PROJECT_COLUMNS}
                        records={displayProjects as unknown as Array<Record<string, unknown>>}
                        rowKey={'pk_project'}
                        highlightMode="row"
                        autoFillWidth={true}
                        emptyTip={emptyTip}
                        onCellDblClick={handleDblClick}
                        loading={loading}
                    />
                </div>

                {total > 0 && (
                    <div className="grid-footer" style={{margin: '8px 10px 10px'}}>
                        <span>共 {total} 条</span>
                        {/* 只有一页时不显示翻页箭头：一个「1/1」摆在那里纯属噪音 */}
                        {total > pageRows && (
                            <Pagination
                                size="small"
                                simple
                                current={pageIndex}
                                pageSize={pageRows}
                                showSizeChanger={false}
                                total={total}
                                onChange={(page) => setPageIndex(page)}
                            />
                        )}
                    </div>
                )}
            </Splitter.Panel>
        </Splitter>
    );
};

export type NCProjectModalProps = RegisterModalProps<NCProject, NCProjectViewProps> & {
    /**
     * 编辑器注册名，默认 `PROJECT_EDITOR`。
     *
     * 同一页面有多个表格实例时（页面只读一张 + 弹窗里可编辑一张）必须各用各的名字：
     * 注册表全局、同名先到先得，后注册的会被忽略（见 `bomMatrix/editorScope.ts`）。
     */
    editorKey?: string;
};

/**
 * 项目选择
 *
 * 弹窗尺寸比物料小一号：只有两列（编码 / 名称），分类树也只有两三层。
 */
const NCProjectModal: React.FC<NCProjectModalProps> = ({
                                                           open,
                                                           onCancel,
                                                           isEditor,
                                                           onSelect,
                                                           onInput,
                                                           defaultKeyword,
                                                           editorKey = PROJECT_EDITOR,
                                                       }) => {
    return (
        <RegisterInputModal<NCProject, NCProjectViewProps>
            open={open}
            isEditor={isEditor}
            title={'项目选择'}
            editorKey={editorKey}
            editorPlaceholder="项目"
            onCancel={onCancel}
            onSelect={onSelect}
            // 用户不走弹窗、直接在格子里输入后回车的那条路：不传下去就永远收不到
            onInput={onInput}
            width={640}
            // 分栏布局（分类树 + 表格）要占满内容区：不传 height 时弹窗按内容高，
            // 而这里的内容是 height:100% 的表格，没有确定高度就画不出来
            height={440}
            View={NCProjectView}
            // 预填的关键字只在 View 挂载时读一次（弹窗 destroyOnHidden，每次打开都是新实例）
            viewProps={{defaultKeyword}}
        />
    );
};

export default NCProjectModal;
