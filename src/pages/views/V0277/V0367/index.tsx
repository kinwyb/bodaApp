import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {processRouteMatrixApi, type processRouteMatrixListReq} from "@/api/modules/nc/processRouteMatrix.ts";
import {
    ProcessRouteMatrixView,
    type ProcessRouteMatrixViewApi,
} from "@/components/nc/processRouteMatrix";
import {DEFAULT_PROCESS_ROUTE_SECTION, processRouteSectionLabel} from "@/components/nc/processRouteMatrix/sections.ts";
import type {ProcessRouteMatrix, ProcessRouteMatrixRule} from "@/api/schemas/nc/processRouteMatrix.ts";
import {emitActiveUIEvent, useUIBridgeHost} from "@/pages/agent/ui-bridge";
import {App, Button, Form, Input, Space, Splitter, type TabsProps} from "antd";
import {FilterTable, type FilterTableApi, type GridTableSelectedRowChangeInfo} from "@/components/grid-table";
import {CommandBar} from "@/components/CommandBar";
import MatrixPushView from "@/components/nc/matrixPushView.tsx";
import MatrixPushModal, {type MatrixPushApi} from "@/components/nc/matrixPushModal.tsx";
import {useProcessRouteMatrixCommands, type FormMode, type ProcessRouteMatrixCommandContext} from "./command";
import ProcessRouteMatrixEdit from "./models/processRouteMatrixEdit";
import {PROCESS_MATRIX_LIST_COLUMNS} from "./columns";
import {toStringOrEmpty} from "@/utils";
import {ErrorMessage} from "@/api/request.ts";
import {SearchOutlined} from "@ant-design/icons";
import {createProcessRouteMatrixBridge, type ProcessRouteMatrixBridgeContext} from "./bridged";

/**
 * V0277_V0367 工艺路线矩阵
 *
 * 布局与包装 BOM 矩阵（V0277_V0354）一致：上方是列表，下方是矩阵详情。
 * 区别只有一个：详情里**没有配色 / 配码**，只有工序明细，加一页「发布情况」。
 *
 * 界面桥的声明全在 `./bridged.ts`：那个文件存在本身就是「本页接入了界面桥」的标记。
 * 所以本文件里没有桥的细节，只有「把当前状态交出去」这一句。
 */

/** 主表每页条数：服务端分页，翻页要带着它一起发请求（界面桥的翻页命令也按它算页数） */
const PAGE_SIZE = 30;
/** 等一次列表请求落地的兜底时长：请求卡死时别让 agent 的 ui_act 一直挂着 */
const LIST_REQUEST_TIMEOUT_MS = 12000;

/**
 * 「发布情况」页签的 key。
 *
 * 与 `components/nc/processRouteMatrix/sections.ts` 里的声明同一口径 —— 那里是键名的唯一来源，
 * 这里只是取个短名字，避免页面里到处写字符串。
 */
const PUSH_RULE_SECTION = 'pushRules';

/**
 * 发布弹窗要的四个接口（页面与编辑弹窗各一份）。
 *
 * 模块级常量：它是 `MatrixPushModal` 的 `loadRules` 依赖，每次渲染新建对象会让
 * 「打开就取规则」的 effect 反复触发。
 */
const PUSH_API: MatrixPushApi = {
    rules: processRouteMatrixApi.pushRules,
    push: processRouteMatrixApi.push,
    cancelPush: processRouteMatrixApi.cancelPush,
    updatePush: processRouteMatrixApi.updatePush,
};

const NCProcessRouteMatrixPage: React.FC<ViewPageProps> = ({view, trail, params}) => {

    /** antd 的上下文版 message / modal：命令条那层要用 */
    const {message, modal} = App.useApp();

    const [matrix, setMatrix] = useState<ProcessRouteMatrix>({});
    /** 最新矩阵（ref 版）：桥的命令在 `await` 之后要判断「详情落地没有」 */
    const matrixRef = useRef<ProcessRouteMatrix>({});
    /** 列表接口回来没有（成功失败都算）—— 桥的 `ready` 读它 */
    const [loaded, setLoaded] = useState<boolean>(false);

    /**
     * 当前标签页。**放在页面上而不是控件里**：界面桥必须如实回答「用户在看哪一张表」，
     * 控件内部再存一份就会和屏幕上分叉。
     */
    const [activeKey, setActiveKey] = useState<string>(DEFAULT_PROCESS_ROUTE_SECTION);
    /** 控件交出的读能力：工序明细表的实例都在它里面 */
    const matrixViewRef = useRef<ProcessRouteMatrixViewApi | null>(null);

    /** 主表数据 */
    const [datas, setDatas] = useState<ProcessRouteMatrix[]>([]);
    /**
     * 主表当前选中的那一行 —— 命令条的 disabled 读它。
     *
     * 与 `matrix` 是两件事：这个跟着「用户点了哪一行」立刻变，`matrix` 要等详情接口回来。
     */
    const [selectedMatrix, setSelectedMatrix] = useState<ProcessRouteMatrix | null>(null);
    /**
     * 查询条件。
     *
     * 初值读 `params.materialCode`：从包装 BOM 页的「工艺矩阵」跳过来时带着那个物料编码，
     * 用户点过去想看的就是这个物料的工艺 —— 不用再手敲一遍。
     * 同 view 不同参数进来时组件会被重挂载（见 `pages/types.ts`），所以这里只当初始值用。
     */
    const [query, setQuery] = useState<processRouteMatrixListReq>(() => {
        const code = toStringOrEmpty(params?.materialCode).trim();
        return code ? {MaterialCode: code} : {};
    });
    const [form] = Form.useForm<{ materialCode?: string, ProjectCode?: string }>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [page, setPage] = useState<number>(1);
    const [totalRows, setTotalRows] = useState<number>(0);
    /** 发布情况（第二个页签的数据） */
    const [pushData, setPushData] = useState<ProcessRouteMatrixRule[]>([]);

    /**
     * 当前矩阵详情：`current` 是已加载成功的 id，`loading` 是在路上的 id。
     *
     * 首屏 loadData 与「数据落地后选中第一行」的回调会同时要同一个 id，
     * 只靠 `matrix.ProcessRouteMatrixID` 去重挡不住 —— 那会儿 state 还没更新，会发两遍请求。
     */
    const currentMatrixIDRef = useRef<string>('');
    const loadingMatrixIDRef = useRef<string>('');

    const loadMatrix = useCallback(async (matrixID?: string) => {
        if (!matrixID || matrixID === currentMatrixIDRef.current || matrixID === loadingMatrixIDRef.current) {
            return;
        }
        loadingMatrixIDRef.current = matrixID;
        // 先清空发布情况：那是上一份矩阵的发布会话，留在页签上就是串数据
        setPushData([]);
        try {
            const detail = await processRouteMatrixApi.detail(matrixID);
            currentMatrixIDRef.current = matrixID;
            const next = detail.data ?? {};
            // ref 与 state 一起写：桥的命令在 await 之后只能靠 ref 读最新值
            matrixRef.current = next;
            setMatrix(next);
        } catch (err) {
            void message.error(ErrorMessage(err, '矩阵详情加载失败'));
            // 详情都没拿到，发布规则更没有意义，别再发一趟
            return;
        } finally {
            loadingMatrixIDRef.current = '';
        }
        /*
         * 发布情况单独一趟、单独报错：它只是页签的附属数据，
         * 拿不到不该被扣成「矩阵详情加载失败」—— 那时详情其实已经成功了。
         */
        try {
            const rules = await processRouteMatrixApi.pushRules(matrixID);
            setPushData(rules.data ?? []);
        } catch (err) {
            void message.error(ErrorMessage(err, '发布情况加载失败'));
        }
    }, [message]);

    /**
     * 一次列表请求的等待者。
     *
     * `loadData` 是**唯一**的请求路径（由 query / page 驱动），桥的 `query.set` /
     * `list.goto` 只是把 state 落下去，再在这里等「请求真的回来」——
     * 两条路径各写一份请求，参数与副作用迟早会分叉。
     */
    const pendingListRef = useRef<((result: {ok: boolean; page: number; rows: number; total: number}) => void) | null>(null);

    const settleList = useCallback((result: {ok: boolean; page: number; rows: number; total: number}) => {
        const settle = pendingListRef.current;
        pendingListRef.current = null;
        settle?.(result);
    }, []);

    /** 加载主数据 */
    const loadData = useCallback(async () => {
        /** 这次请求落地的样子：成功失败都要交出去，否则等它的那条命令会一直挂着 */
        let snapshot = {ok: true, page, rows: 0, total: 0};
        try {
            const result = await processRouteMatrixApi.list(query, {page, pageSize: PAGE_SIZE});
            const rows = result.data ?? [];
            snapshot = {ok: true, page, rows: rows.length, total: result.page?.total ?? 0};
            // 第一行先加载详情：不必等选中回调（那一步要等表格重绘，慢一帧）
            const matrixID = rows[0]?.ProcessRouteMatrixID;
            if (matrixID) void loadMatrix(matrixID);
            // 换了一批行，旧的选中已经不在了（紧接着的 selectRowsByKeys 会重新选第一行并回调）
            setSelectedMatrix(null);
            setDatas(rows);
            setTotalRows(snapshot.total);
        } catch (err) {
            // 失败要如实说：桥不能拿 rows:0 当成「没有匹配数据」回给模型
            snapshot = {ok: false, page, rows: 0, total: 0};
            void message.error(ErrorMessage(err, '数据加载失败'));
        } finally {
            setLoaded(true);
            settleList(snapshot);
        }
    }, [query, page, loadMatrix, settleList, message]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    /**
     * 主表数据落地后选中第一行（下方面板展示的矩阵跟着切换）。
     *
     * 这一步**不能**放在 loadData 里：那时 setDatas 还没提交，表格里是上一批行，
     * `selectRowsByKeys` 按主键反查显示行号必然是 0 命中。
     */
    useEffect(() => {
        const key = datas[0]?.ProcessRouteMatrixID;
        if (!key) return;
        tableRef.current?.selectRowsByKeys([key]);
    }, [datas]);

    /**
     * 主表选中变化：既驱动命令条（按「有没有选中行」算 disabled），又加载这一行的矩阵详情。
     */
    const handleSelectedChange = useCallback((info: GridTableSelectedRowChangeInfo) => {
        const record = info.record ? (info.record as ProcessRouteMatrix) : null;
        setSelectedMatrix(record);
        emitActiveUIEvent('selection.change', {
            table: 'list',
            rowId: record?.ProcessRouteMatrixID ?? null,
        });
        if (info.rowKey) void loadMatrix(info.rowKey);
    }, [loadMatrix]);

    const handleActiveKeyChange = useCallback((key: string) => {
        setActiveKey(key);
        emitActiveUIEvent('tab.change', {section: key});
    }, []);

    /**
     * 新增 / 编辑 / 复制的表单弹窗。
     *
     * 模式按打开那一刻定下来，弹窗开着时改选中行不会让标题跟着变。
     */
    const [formOpen, setFormOpen] = useState(false);
    const [formMode, setFormMode] = useState<FormMode>('add');
    const [formRecord, setFormRecord] = useState<ProcessRouteMatrix | null>(null);
    /**
     * 每次打开弹窗换一个 key：弹窗自己持有表单与工序明细，
     * 不换 key 会带着上一次打开的残留（`destroyOnHidden` 只销毁内容，不重置组件的 state）。
     */
    const [formKey, setFormKey] = useState(0);

    const handleOpenForm = useCallback((mode: FormMode, record: ProcessRouteMatrix | null) => {
        setFormMode(mode);
        // 新增没有底稿：即便调用方传了 record 也忽略，避免把上一份带进空表单
        setFormRecord(mode === 'add' ? null : record);
        setFormKey((key) => key + 1);
        setFormOpen(true);
    }, []);

    const handleCloseForm = useCallback(() => setFormOpen(false), []);

    /**
     * 发布弹窗（「工艺路线矩阵明细」）。
     *
     * `pushRecord` 是**打开那一刻**的那一行：弹窗按它的主键取规则，
     * 弹窗开着时切换主表选中行不应让它偷偷换成另一份矩阵（那会发布错对象）。
     */
    const [pushOpen, setPushOpen] = useState(false);
    const [pushRecord, setPushRecord] = useState<ProcessRouteMatrix | null>(null);

    const handleOpenPush = useCallback((record: ProcessRouteMatrix) => {
        setPushRecord(record);
        setPushOpen(true);
    }, []);

    const handleClosePush = useCallback(() => setPushOpen(false), []);

    /**
     * 重拉「发布情况」页签（发布 / 取消发布 / 更新之后）。
     *
     * 单独一趟而不是复用 `loadMatrix`：那个按「当前矩阵主键」去重，
     * 同一份矩阵第二次调用会被挡掉 —— 发布完恰恰就是同一份矩阵。
     */
    const reloadPushRules = useCallback(async () => {
        const matrixID = currentMatrixIDRef.current;
        if (!matrixID) return;
        try {
            const rules = await processRouteMatrixApi.pushRules(matrixID);
            setPushData(rules.data ?? []);
        } catch (err) {
            void message.error(ErrorMessage(err, '发布情况加载失败'));
        }
    }, [message]);

    /**
     * 命令的公共依赖（框架能力 + 本页业务依赖）。
     *
     * 与 V0354 同样的两层写法：**先把依赖装成一个稳定对象，再交给 useProcessRouteMatrixCommands**。
     * 别合成一行 `useMemo(() => factory({..., tableRef}), [...])` —— 那等于在 render 期
     * 把 ref 实例当参数递给普通函数，lint 会按「可能读到 ref.current」拦下来。
     */
    const commandContext = useMemo<ProcessRouteMatrixCommandContext>(() => ({
        message,
        modal,
        tableRef,
        // 主表没开多选：选中就是那一行，没选中就是空
        getSelectedRows: () => (selectedMatrix ? [selectedMatrix] : []),
        activeRow: selectedMatrix,
        hasSelection: !!selectedMatrix,
        reload: loadData,
        openForm: handleOpenForm,
        openPush: handleOpenPush,
    }), [message, modal, selectedMatrix, loadData, handleOpenForm, handleOpenPush]);

    /**
     * 命令条（装配在 ./command/index.ts）。
     *
     * 与界面桥的动作表**同源**：桥直接读这份 commands 生成 `actions`，
     * 所以加按钮只改 command/ 那一处 —— 屏幕上多一个按钮，模型那儿就多一条命令。
     */
    const commands = useProcessRouteMatrixCommands(commandContext);

    /** 交给桥的就绪判断：只看「接口回来没有」，不看内容（内容为空也是一份合法的快照） */
    const isReady = useCallback(() => loaded, [loaded]);

    /**
     * 取某张明细表的实例（`() => matrixViewRef.current?.readTable(key)`）。
     *
     * 桥要的是取值函数而不是快照：表格实例会随页签挂载/卸载而变，
     * 「此刻有没有」只有调用那一刻才作数 —— 这也是 `readable` 的唯一数据来源。
     */
    const readTable = useCallback(
        (section: string) => matrixViewRef.current?.readTable(section) ?? null,
        [],
    );

    /**
     * 按新条件 / 页码重新查库（界面桥的 `query.set` / `list.goto` 用它）。
     *
     * 只落 state，请求仍由 `loadData` 发 —— 这里把 resolve 交给它，等它落地再回执。
     * `{...nextQuery}` 换一个新引用是必须的：内容相同时 React 认为没变就不重渲染，
     * `loadData` 不重建、effect 不跑，promise 永远等不到。
     */
    const reloadList = useCallback(
        (nextQuery: processRouteMatrixListReq, nextPage: number): Promise<{ok: boolean; page: number; rows: number; total: number}> =>
            new Promise((resolve) => {
                pendingListRef.current = resolve;
                setQuery({...nextQuery});
                setPage(nextPage);
                window.setTimeout(() => {
                    if (pendingListRef.current !== resolve) return;
                    pendingListRef.current = null;
                    resolve({ok: false, page: nextPage, rows: 0, total: 0});
                }, LIST_REQUEST_TIMEOUT_MS);
            }),
        [],
    );

    /** 交给桥的状态与能力：桥通过取值函数读它，不直接持有 */
    const bridgeContext = useMemo<ProcessRouteMatrixBridgeContext>(
        () => ({
            view, matrix, activeKey, readTable, setActiveKey, isReady,
            readMatrix: () => matrixRef.current,
            query, page, pageSize: PAGE_SIZE, totalRows,
            readListTable: () => tableRef.current,
            reloadList,
            commands,
        }),
        [view, matrix, activeKey, readTable, isReady, query, page, totalRows, reloadList, commands],
    );

    /**
     * 界面桥：主表的查询 / 翻页 / 选中，工序明细的目录，切页签。
     */
    const bridge = useMemo(() => createProcessRouteMatrixBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    /**
     * 第二个页签：发布情况。
     *
     * `ProcessRouteMatrixView` 的 `tabs` 是**拼在内置工序明细后面**的，
     * 所以这里必须是 antd Tabs 的 item 形状（key / label / children）。
     *
     * 依赖必须带 `pushData` —— 换矩阵时会重新拉发布规则，锁成 [] 就永远显示第一次那份。
     */
    const pushRuleTab = useMemo((): TabsProps['items'] => [
        {
            key: PUSH_RULE_SECTION,
            label: processRouteSectionLabel(PUSH_RULE_SECTION),
            children: <MatrixPushView Datas={pushData}
                                     RowKeyField={'ProcessRouteMatrixRuleID'}
                                     VersionField={'PRVersion'}
                                     VersionFieldName={'工艺版本'}/>,
        },
    ], [pushData]);

    const selectedLabel = useMemo(() => {
        const parts = [toStringOrEmpty(pushRecord?.MaterialCode), toStringOrEmpty(pushRecord?.MaterialName)]
            .map((text) => text.trim())
            .filter((text) => text !== '');
        return parts.join(' ');
    }, [pushRecord]);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            {/* 命令条：与界面桥的动作表同源（桥直接读这份 commands），加按钮只改 ./command */}
            {commands.length > 0 && <CommandBar view={view} items={commands}/>}
            {/*
             * 框（边框 / 圆角 / 留白）单独放一层，**不挂在 Splitter 上**：
             * antd 用 `offsetHeight` 量分隔容器来算每个面板的像素尺寸，边框与 padding 也算在里面，
             * 面板按 50% 分完就比可用高度多出一截，两张表各自冒滚动条。
             */}
            <Form
                className="page-search"
                form={form}
                layout="inline"
                // 跳转带过来的物料编码先填在输入框里：条件已经生效，界面上看得见才不会被误以为没查
                initialValues={{materialCode: toStringOrEmpty(params?.materialCode)}}
                style={{marginTop: 20}}
                onFinish={(values: { materialCode?: string, ProjectCode?: string }) => {
                    /*
                     * 与界面桥的 query.set 保持同一个语义：换了条件就回第 1 页。
                     * 留在第 3 页看新条件的结果，多半是一片空白，用户会以为「查不到」。
                     */
                    setQuery({MaterialCode: values.materialCode, ProjectCode: values.ProjectCode});
                    setPage(1);
                }}
            >
                <div className="preorder-form-toolbar">
                    <span className="pf-label">物料: </span>
                    <Form.Item name="materialCode">
                        <Input allowClear/>
                    </Form.Item>
                    <span className="pf-label">项目: </span>
                    <Form.Item name="ProjectCode">
                        <Input allowClear/>
                    </Form.Item>
                    <Form.Item>
                        <Space>
                            <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                                查询
                            </Button>
                        </Space>
                    </Form.Item>
                </div>
            </Form>
            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                padding: 5,
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '10px',
                overflow: 'hidden',
            }}>
                {/*
                 * Splitter 三件套：`flex:1` + `minHeight:0` + `height:'auto'`。
                 * `.ant-splitter` 自带 `height:100%`，放进 `.page-container`（flex 列）里不会
                 * 「占剩余高度」而是等于整页高度 —— 面包屑一压，分割区就被顶出可视区。
                 */}
                <Splitter vertical style={{
                    flex: 1,
                    minHeight: 0,
                    height: 'auto',
                }}>
                    {/*
                     * 面板必须挂 `.splitter-pane-body`：`.ant-splitter-panel` 是块级元素、
                     * 不是 flex 容器，FilterTable 与 Tabs 的 flex 属性在块级父级里全部失效，
                     * 里面的 GridTable 参照不到确定高度就塌成 0。
                     */}
                    <Splitter.Panel className="splitter-pane-body"
                                    style={{paddingBottom: 10, overflow: 'hidden'}}>
                        {/* 列定义在 `./columns`：页面与界面桥共用同一份，桥的列目录才不会和屏幕分叉 */}
                        <FilterTable ref={tableRef} columns={PROCESS_MATRIX_LIST_COLUMNS} records={datas}
                                     rowKey={'ProcessRouteMatrixID'}
                                     widthMode={'autoWidth'} onSelectedChange={handleSelectedChange}
                                     page={page} total={totalRows} pageSize={PAGE_SIZE}
                                     onPageChange={(next) => {
                                         setPage(next);
                                     }}
                                     showPagination={true}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel className="splitter-pane-body" style={{overflow: 'hidden'}}>
                        <ProcessRouteMatrixView ref={matrixViewRef} matrix={matrix}
                                                activeKey={activeKey}
                                                onActiveKeyChange={handleActiveKeyChange}
                                                tabs={pushRuleTab}/>
                    </Splitter.Panel>
                </Splitter>
            </div>
            {/* 发布弹窗：命令条的「发布」与编辑弹窗里的「发布」打开的是同一个通用界面 */}
            <MatrixPushModal open={pushOpen}
                             title={'工艺路线矩阵明细'}
                             matrixID={toStringOrEmpty(pushRecord?.ProcessRouteMatrixID)}
                             matrixLabel={selectedLabel}
                             RuleKeyField={'ProcessRouteMatrixRuleID'}
                             VersionField={'PRVersion'}
                             VersionFieldName={'工艺版本'}
                             api={PUSH_API}
                             // 发布状态变了：页签要跟着刷新，否则关掉弹窗还是发布前那份
                             onChanged={() => void reloadPushRules()}
                             onClose={handleClosePush}/>
            {/* 新增 / 编辑 / 复制的表单弹窗（保存 / 发布都在它自己的工具栏里） */}
            <ProcessRouteMatrixEdit key={formKey} open={formOpen} mode={formMode} record={formRecord}
                                    // 保存成功后刷新主表：不刷的话新存的这份关掉弹窗也看不见
                                    onSaved={() => void loadData()}
                                    onClose={handleCloseForm}/>
        </div>
    );
}

export default NCProcessRouteMatrixPage;
