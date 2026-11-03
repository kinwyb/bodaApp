import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {packBomMatrixApi, type packBomMatrixListReq} from "@/api/modules/nc/bomMatrix.ts";
import {BomMatrixView, type BomMatrixViewApi} from "@/components/nc/bomMatrix";
import type {PackBomMatrix, PackBomMatrixRule} from "@/api/schemas/nc/bomMatrix.ts";
import {type BomMatrixSection, DEFAULT_BOM_MATRIX_SECTION} from "@/components/nc/bomMatrix/sections.ts";
import {useUIBridgeHost} from "@/pages/agent/ui-bridge";
import {type BomMatrixBridgeContext, createBomMatrixBridge, type MatrixListResult} from "./bridged";
import {MATRIX_LIST_COLUMNS} from "./columns";
import {Button, Form, Input, message, Space, Splitter, type TabsProps} from "antd";
import {FilterTable, type FilterTableApi} from "@/components/grid-table";
import {ErrorMessage} from "@/api/request.ts";
import {SearchOutlined} from "@ant-design/icons";
import PushView from "@/components/nc/bomMatrix/pushView.tsx";

/**
 * V0277_V0354 包装 BOM 矩阵
 *
 * 界面桥的声明全在 `./bridged.ts`（guide、主表与三张明细表怎么拼、查询 / 翻页 / 切标签页）：
 * **那个文件存在本身就是「本页接入了界面桥」的标记**，工作台的导航清单靠它判定。
 * 所以本文件里没有桥的细节，只有「把当前状态交出去」这一句，以及受控的 activeKey 与分页。
 *
 * 主表（上方列表）与明细（下方三张表）是**从属关系**：主表选中哪一行，决定下方看哪个矩阵。
 * 界面桥要如实表达这件事，靠的是 `list.select` 之后等详情真的落地（见 `./bridged` 的
 * `waitForMatrixDetail`），以及页面把「请求落地了」这件事交出去（`reloadList`）。
 */
/** 主表每页条数：服务端分页，翻页要带着它一起发请求（界面桥的翻页命令也按它算页数） */
const PAGE_SIZE = 30;
/** 等一次列表请求落地的兜底时长：请求卡死时别让 agent 的 ui_act 一直挂着 */
const LIST_REQUEST_TIMEOUT_MS = 12000;
/**
 * 第四个标签页（发布情况）的 key。
 *
 * 与 `components/nc/bomMatrix/sections.ts` 里的 items / colors / sizes 并列，
 * 但那三个是控件自己渲染的、也是界面桥里的三张表；这一页是页面在 `tabs` 里追加的，
 * 所以 key 定在页面这一侧。
 */
const PUSH_RULE_SECTION = 'pushRules';

const NCPackBomMatrixPage: React.FC<ViewPageProps> = ({view, trail}) => {

    const [bomMatrix, setBomMatrix] = useState<PackBomMatrix>({});
    /**
     * 最新矩阵（ref 版）。
     *
     * 界面桥的命令在执行中途（`await` 之后）要判断「详情落地没有」，那时它手里的 ctx 是
     * 命令启动时的闭包，`bomMatrix` 恒为旧值 —— 只有 ref 读得到最新那份。
     */
    const bomMatrixRef = useRef<PackBomMatrix>({});
    /** 详情接口回来没有（成功失败都算）—— 桥的 `ready` 读它，见 `./bridged` 的 `isReady` */
    const [loaded, setLoaded] = useState<boolean>(false);

    /**
     * 当前标签页。**放在页面上而不是控件里**：界面桥必须如实回答「用户在看哪一张表」，
     * 控件内部再存一份就会和屏幕上分叉（详见 BomMatrixView 的 activeKey 注释）。
     */
    const [activeKey, setActiveKey] = useState<string>(DEFAULT_BOM_MATRIX_SECTION);
    /** 控件交出的读能力：三个表格实例都在它里面，桥按标签页名取 */
    const matrixRef = useRef<BomMatrixViewApi | null>(null);

    /**
     * 主表数据
     */
    const [datas, setDatas] = useState<PackBomMatrix[]>([]);
    const [query, setQuery] = useState<packBomMatrixListReq>({});
    const [form] = Form.useForm<{ materialCode?: string, ProjectCode?: string }>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [page, setPage] = useState<number>(1);
    const [totalRows, setTotalRows] = useState<number>(0);
    /**
     * 发布情况
     */
    const [pushData, setPushData] = useState<PackBomMatrixRule[]>([]);

    /**
     * 当前矩阵详情：`current` 是已加载成功的 id，`loading` 是在路上的 id。
     *
     * 首屏 loadData 与「数据落地后选中第一行」的回调会同时要同一个 id，
     * 只靠 `bomMatrix.PackBomMatrixID` 去重挡不住 —— 那会儿 state 还没更新，会发两遍请求。
     */
    const currentMatrixIDRef = useRef<string>('');
    const loadingMatrixIDRef = useRef<string>('');

    const loadMatrix = useCallback(async (matrixID?: string) => {
        if (!matrixID || matrixID === currentMatrixIDRef.current || matrixID === loadingMatrixIDRef.current) {
            return;
        }
        loadingMatrixIDRef.current = matrixID;
        // 先清空发布情况：那是上一份矩阵的发布会话，留在第四页上就是串数据
        setPushData([]);
        try {
            const matrix = await packBomMatrixApi.detail(matrixID);
            currentMatrixIDRef.current = matrixID;
            const next = matrix.data ?? {};
            // ref 与 state 一起写：桥的命令在 await 之后只能靠 ref 读最新值
            bomMatrixRef.current = next;
            setBomMatrix(next);
        } catch (err) {
            void message.error(ErrorMessage(err, '矩阵详情加载失败'));
            // 详情都没拿到，发布规则更没有意义，别再发一趟
            return;
        } finally {
            loadingMatrixIDRef.current = '';
        }
        /*
         * 发布情况单独一趟、单独报错：它只是第四个标签页的附属数据，
         * 拿不到不该被扣成「矩阵详情加载失败」—— 那时详情其实已经成功了。
         */
        try {
            const rules = await packBomMatrixApi.pushRules(matrixID);
            setPushData(rules.data ?? []);
        } catch (err) {
            void message.error(ErrorMessage(err, '发布情况加载失败'));
        }
    }, [])

    /**
     * 一次列表请求的等待者。
     *
     * `loadData` 是**唯一**的请求路径（由 query / page 驱动），桥的 `query.set` /
     * `list.goto` 只是把 state 落下去，再在这里等「请求真的回来」——
     * 两条路径各写一份请求，参数与副作用迟早会分叉。
     */
    const pendingListRef = useRef<((result: MatrixListResult) => void) | null>(null);

    const settleList = useCallback((result: MatrixListResult) => {
        const settle = pendingListRef.current;
        pendingListRef.current = null;
        settle?.(result);
    }, []);

    /**
     * 加载主数据
     */
    const loadData = useCallback(async () => {
        /** 这次请求落地的样子：成功失败都要交出去，否则等它的那条命令会一直挂着 */
        let snapshot: MatrixListResult = {ok: true, page, rows: 0, total: 0};
        try {
            const result = await packBomMatrixApi.list(query, {page: page, pageSize: PAGE_SIZE});
            const rows = result.data ?? [];
            snapshot = {ok: true, page, rows: rows.length, total: result.page?.total ?? 0};
            // 第一行先加载详情：不必等选中回调（那一步要等表格重绘，慢一帧）
            const matrixID = rows[0]?.PackBomMatrixID;
            if (matrixID) void loadMatrix(matrixID);
            setDatas(rows);
            setTotalRows(snapshot.total)
        } catch (err) {
            // 失败要如实说：桥不能拿 rows:0 当成「没有匹配数据」回给模型
            snapshot = {ok: false, page, rows: 0, total: 0};
            void message.error(ErrorMessage(err, '数据加载失败'))
        } finally {
            setLoaded(true)
            settleList(snapshot);
        }
    }, [query, page, loadMatrix, settleList])

    useEffect(() => {
        void loadData();
    }, [loadData]);

    /**
     * 主表数据落地后选中第一行（下方面板展示的矩阵跟着切换）。
     *
     * 这一步**不能**放在 loadData 里：那时 setDatas 还没提交，表格里是上一批行（首屏是空表），
     * `selectRowsByKeys` 按主键反查显示行号必然是 0 命中。
     * 也不能在 setDatas 之后紧跟一句：GridTable 在 rows 变化的 layout effect 里会
     * `setRecords` → `clearSelected()`，早于它的选中会被这一下清掉。
     * 父组件的 useEffect 排在子组件 layout effect 之后 —— 此时新行已进表格、清理也做完了。
     */
    useEffect(() => {
        const key = datas[0]?.PackBomMatrixID;
        if (!key) return;
        tableRef.current?.selectRowsByKeys([key]);
    }, [datas]);

    /** 交给桥的就绪判断：只看「接口回来没有」，不看内容（内容为空也是一份合法的快照） */
    const isReady = useCallback(() => loaded, [loaded]);

    /**
     * 取某张明细表的实例（`() => matrixRef.current?.readTable(key)`）。
     *
     * 桥要的是取值函数而不是快照：表格实例会随标签页挂载/卸载而变，
     * 「此刻有没有」只有调用那一刻才作数 —— 这也是 `readable` 的唯一数据来源。
     */
    const readTable = useCallback(
        (section: BomMatrixSection) => matrixRef.current?.readTable(section) ?? null,
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
        (nextQuery: packBomMatrixListReq, nextPage: number): Promise<MatrixListResult> =>
            new Promise<MatrixListResult>((resolve) => {
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
    const bridgeContext = useMemo<BomMatrixBridgeContext>(
        () => ({
            view, bomMatrix, activeKey, readTable, setActiveKey, isReady,
            readMatrix: () => bomMatrixRef.current,
            query, page, pageSize: PAGE_SIZE, totalRows,
            readListTable: () => tableRef.current,
            reloadList,
        }),
        [view, bomMatrix, activeKey, readTable, isReady, query, page, totalRows, reloadList],
    );

    /**
     * 界面桥：主表的查询 / 翻页 / 选中，三张明细表的目录，切标签页。
     *
     * 依赖里的 `bomMatrix` 是必须的 —— 配色/配码的列跟着尺码/颜色表走，列变了就得重建宿主
     * （列目录变了本来就该发整页快照，桥会自己判定）。
     */
    const bridge = useMemo(() => createBomMatrixBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    /**
     * 第四个标签页：发布情况。
     *
     * `BomMatrixView` 的 `tabs` 是**拼在内置三张表后面**的（见 bomMatrix.tsx 的 `items`），
     * 所以这里必须是 antd Tabs 的 item 形状（key / label / children）：
     * 直接塞一个元素进去，antd 找不到 key 与 label，类型也过不了。
     *
     * 依赖必须带 `pushData` —— 换矩阵时会重新拉发布规则，锁成 [] 就永远显示第一次那份（多半是空表）。
     */
    const pushRuleTab = useMemo((): TabsProps['items'] => [
        {
            key: PUSH_RULE_SECTION,
            label: '发布情况',
            children: <PushView Datas={pushData} VersionFieldName={'Bom矩阵版本'} VersionField={'BomVersion'}/>,
        },
    ], [pushData]);


    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            {/*
             * 框（边框 / 圆角 / 留白）单独放一层，**不挂在 Splitter 上**：
             * antd 用 `offsetHeight` 量分隔容器来算每个面板的像素尺寸，边框与 padding 也算在里面，
             * 面板按 50% 分完就比可用高度多出一截，两张表各自冒滚动条。
             * 框留给外层，Splitter 只管分高度与拖拽。
             */}
            <Form
                className="page-search"
                form={form}
                layout="inline"
                style={{marginTop: 20}}
                onFinish={(values: { materialCode?: string, ProjectCode?: string }) => {
                    /*
                     * 与界面桥的 query.set 保持同一个语义：换了条件就回第 1 页。
                     * 留在第 3 页看新条件的结果，多半是一片空白，用户会以为「查不到」。
                     */
                    setQuery({PackMaterialCode: values.materialCode, ProjectCode: values.ProjectCode});
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
                <Splitter vertical style={{
                    flex: 1,
                    minHeight: 0,
                    // `.ant-splitter` 自带 `height: 100%`。放进 `.page-container`（flex 列）里它不会
                    // 「占剩余高度」，而是等于整页高度 —— 面包屑一压，分割区就被顶出可视区，
                    // 表现就是「表格不见了」。改回 auto，高度交给 flex 分配。
                    height: 'auto',
                }}>
                    {/*
                     * 面板必须挂 `.splitter-pane-body`：`.ant-splitter-panel` 是块级元素、不是 flex 容器，
                     * FilterTable 根节点（flex:1 + min-height:0）和 Tabs（page-tabs-fill）的 flex 属性
                     * 在块级父级里全部失效，高度退化成 auto；里面的 GridTable 是 height:100%，
                     * 参照不到确定高度就塌成 0 —— 表格整块空白。
                     *
                     * `overflow: hidden`：面板高度按百分比分栏、还夹着分隔条，常常和内容差 1~2px，
                     * 而 antd 给面板的默认 `overflow: auto` 一溢出就画一条「只能滚几像素」的滚动条。
                     * 面板里只有表格，滚动交回表格自己（canvas 内滚），这里裁掉即可。
                     *
                     * 间距用 `paddingBottom` 而不是 `marginBottom`：margin 在 flex item 上会额外占用主轴空间，
                     * 两个面板加起来的占用就超过 splitter 高度了（比内容差几 px 更能确定地溢出）。
                     */}
                    <Splitter.Panel className="splitter-pane-body"
                                    style={{paddingBottom: 10, overflow: 'hidden'}}>
                        {/* 列定义在 `./columns`：页面与界面桥共用同一份，桥的列目录才不会和屏幕分叉 */}
                        <FilterTable ref={tableRef} columns={MATRIX_LIST_COLUMNS} records={datas}
                                     rowKey={'PackBomMatrixID'}
                                     widthMode={'autoWidth'} onSelectedChange={(values) => loadMatrix(values.rowKey)}
                                     page={page} total={totalRows} pageSize={PAGE_SIZE}
                                     onPageChange={(page) => {
                                         setPage(page);
                                     }}
                                     showPagination={true}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel className="splitter-pane-body" style={{overflow: 'hidden'}}>
                        <BomMatrixView ref={matrixRef} bomMatrix={bomMatrix}
                                       activeKey={activeKey} onActiveKeyChange={setActiveKey} tabs={pushRuleTab}/>
                    </Splitter.Panel>
                </Splitter>
            </div>
        </div>
    );
}

export default NCPackBomMatrixPage;
