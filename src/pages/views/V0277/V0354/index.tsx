import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {packBomMatrixApi, type packBomMatrixListReq} from "@/api/modules/nc/bomMatrix.ts";
import {BomMatrixView, type BomMatrixViewApi} from "@/components/nc/bomMatrix";
import type {BomMatrix} from "@/api/schemas/nc/bomMatrix.ts";
import {type BomMatrixSection, DEFAULT_BOM_MATRIX_SECTION} from "@/components/nc/bomMatrix/sections.ts";
import {useUIBridgeHost} from "@/pages/agent/ui-bridge";
import {type BomMatrixBridgeContext, createBomMatrixBridge} from "./bridged";
import {Button, Form, Input, message, Space, Splitter} from "antd";
import {type AppColumnDef, FilterTable, type FilterTableApi} from "@/components/grid-table";
import {ErrorMessage} from "@/api/request.ts";
import {SearchOutlined} from "@ant-design/icons";

/**
 * V0277_V0354 包装 BOM 矩阵
 *
 * 界面桥的声明全在 `./bridged.ts`（guide、三张表怎么拼、切标签页）：**那个文件存在本身就是
 * 「本页接入了界面桥」的标记**，工作台的导航清单靠它判定。所以本文件里没有桥的细节，
 * 只有「把当前状态交出去」这一句，以及一个受控的 activeKey。
 */
const NCPackBomMatrixPage: React.FC<ViewPageProps> = ({view, trail}) => {

    const [bomMatrix, setBomMatrix] = useState<BomMatrix>({});
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
    const [datas, setDatas] = useState<BomMatrix[]>([]);
    const [query, setQuery] = useState<packBomMatrixListReq>({});
    const [form] = Form.useForm<{ materialCode?: string }>();
    const tableRef = useRef<FilterTableApi | null>(null);

    const columns = useMemo((): AppColumnDef[] => {
        return [
            {field: 'PackMaterialCode', title: '物料编码', minWidth: 100, filterType: 'enum'},
            {field: 'PackMaterialName', title: '物料名称', minWidth: 100, filterType: 'text'},
            {field: 'ProjectCode', title: '项目', minWidth: 100, filterType: 'text'},
            {field: 'PackMethod', title: '包装方式', filterType: 'text'},
            {field: 'PackNum', title: '包装方法', filterType: 'text'},
            {field: 'MatrixVersion', title: '矩阵版本'}
        ]
    }, [])

    const loadMatrix = useCallback(async (matrixID: string) => {
        if (!matrixID || matrixID === bomMatrix.PackBomMatrixID) {
            return;
        }
        const matrix = await packBomMatrixApi.detail(matrixID);
        setBomMatrix(matrix.data ?? {});
    }, [])

    /**
     * 加载主数据
     */
    const loadData = useCallback(async () => {
        try {
            const result = await packBomMatrixApi.list(query);
            if (result.data && result.data.length > 0) {
                const matrixID = result.data[0].PackBomMatrixID;
                if (matrixID) {
                    void loadMatrix(matrixID)
                    console.log(matrixID);
                    const num = tableRef?.current?.selectRowsByKeys([matrixID]);
                    console.log(num);
                }
            }
            setDatas(result.data ?? []);
        } catch (err) {
            void message.error(ErrorMessage(err, '数据加载失败'))
        } finally {
            setLoaded(false)
        }
    }, [query])

    useEffect(() => {
        void loadData();
    }, []);

    /** 交给桥的就绪判断：只看「接口回来没有」，不看内容（内容为空也是一份合法的快照） */
    const isReady = useCallback(() => loaded, [loaded]);

    /**
     * 取某张表的实例（`() => matrixRef.current?.readTable(key)`）。
     *
     * 桥要的是取值函数而不是快照：表格实例会随标签页挂载/卸载而变，
     * 「此刻有没有」只有调用那一刻才作数 —— 这也是 `readable` 的唯一数据来源。
     */
    const readTable = useCallback(
        (section: BomMatrixSection) => matrixRef.current?.readTable(section) ?? null,
        [],
    );

    /** 交给桥的状态与能力：桥通过取值函数读它，不直接持有 */
    const bridgeContext = useMemo<BomMatrixBridgeContext>(
        () => ({view, bomMatrix, activeKey, readTable, setActiveKey, isReady}),
        [view, bomMatrix, activeKey, readTable, isReady],
    );

    /**
     * 界面桥：三张表的目录 + 切标签页。
     *
     * 依赖里的 `bomMatrix` 是必须的 —— 配色/配码的列跟着尺码/颜色表走，列变了就得重建宿主
     * （列目录变了本来就该发整页快照，桥会自己判定）。
     */
    const bridge = useMemo(() => createBomMatrixBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);


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
                onFinish={(values: { materialCode?: string }) => {
                    setQuery({PackMaterialCode: values.materialCode});
                }}
            >
                <div className="preorder-form-toolbar">
                    <span className="pf-label">物料: </span>
                    <Form.Item name="materialCode">
                        <Input/>
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
                     */}
                    <Splitter.Panel className="splitter-pane-body">
                        <FilterTable ref={tableRef} columns={columns} records={datas} rowKey={'PackBomMatrixID'}
                                     widthMode={'autoWidth'} onSelectedChange={(values) => loadMatrix(values.rowKey)}/>
                    </Splitter.Panel>
                    <Splitter.Panel className="splitter-pane-body">
                        <BomMatrixView ref={matrixRef} bomMatrix={bomMatrix}
                                       activeKey={activeKey} onActiveKeyChange={setActiveKey}/>
                    </Splitter.Panel>
                </Splitter>
            </div>
        </div>
    );
}

export default NCPackBomMatrixPage;
