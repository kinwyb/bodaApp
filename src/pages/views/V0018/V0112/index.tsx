import React, {useCallback, useMemo, useRef, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import BITree from "./biTree";
import {BIQueryParam} from "./biQuery.tsx";
import type {BIList} from "@/api/modules/bi.ts";
import {App, Descriptions, Splitter} from "antd";
import BITable from "@/pages/views/V0018/V0112/biTable.tsx";
import {isDebugEnv} from "@/utils";
import type {ColumnsDefine} from "@visactor/vtable";
import type {GridTableApi} from "@/components/grid-table";
import {emitActiveUIEvent, useUIBridgeHost} from "@/pages/agent/ui-bridge";
import {createBIReportBridge, type BIReportBridgeContext} from "./bridged";
import {ORG_NAME} from "@/store/orgs";


/**
 * 常规报表界面
 * @param param0
 * @param param0.view
 * @param param0.trail
 */
const BIPage: React.FC<ViewPageProps> = ({view, trail}) => {

    const {modal} = App.useApp();
    const [queryNode, setQueryNode] = useState<BIList>();
    const [selectedNode, setSelectedNode] = useState<BIList>();
    const [openQuery, setOpenQuery] = useState<boolean>(false);
    /** 报表目录（biTree 加载完成后上报），界面桥的 reports.find / report.query 用它 */
    const [reports, setReports] = useState<BIList[]>([]);
    const [reportsLoading, setReportsLoading] = useState<boolean>(true);
    /** agent 发起的查询确认框是否已弹出 */
    const [confirming, setConfirming] = useState<boolean>(false);
    /** 结果表的列目录与加载态（biTable 上报），列随报表变化 */
    const [tableState, setTableState] = useState<{columns: ColumnsDefine; loading: boolean}>({columns: [], loading: false});
    const tableApiRef = useRef<GridTableApi | null>(null);

    const openReport = useCallback((node: BIList) => {
        setSelectedNode(node);
        setOpenQuery(true);
    }, []);

    const handleReportsLoaded = useCallback((nodes: BIList[]) => {
        setReports(nodes);
        setReportsLoading(false);
    }, []);

    const handleTableState = useCallback((state: {columns: ColumnsDefine; loading: boolean}) => {
        setTableState(state);
    }, []);

    /**
     * agent 的 report.query 入口：报表多且名称相近，先弹确认框把报表与全部条件摆给用户，
     * 用户点「执行查询」才真正查库；终态经 action.outcome 事件立即上报。
     * 用户手动双击报表走的仍是 BIQueryParam 弹窗，不经过这里。
     */
    const confirmQuery = useCallback((draft: BIList, path: string) => {
        setConfirming(true);
        modal.confirm({
            title: '确认查询这张报表？',
            width: 460,
            content: (
                <Descriptions
                    size="small"
                    column={1}
                    colon={false}
                    styles={{
                        label: {width: 90, color: 'rgba(0, 0, 0, 0.65)'},
                        content: {color: 'rgba(0, 0, 0, 0.88)', fontWeight: 500},
                    }}
                    items={[
                        {key: '__name', label: '报表', children: draft.BIName},
                        {key: '__path', label: '所在目录', children: path || '(根目录)'},
                        ...draft.Args.map((arg) => ({
                            key: arg.Field,
                            label: arg.Name,
                            children: arg.Val
                                ? (arg.Name.trim() === '组织' ? ORG_NAME(arg.Val) : arg.Val)
                                : '(未填)',
                        })),
                    ]}
                />
            ),
            okText: '执行查询',
            cancelText: '取消',
            onOk: () => {
                setConfirming(false);
                emitActiveUIEvent('action.outcome', {
                    actionId: 'report.query',
                    outcome: 'confirmed',
                    message: `用户已确认，报表「${draft.BIName}」查询已发起`,
                });
                setQueryNode({...draft});
            },
            onCancel: () => {
                setConfirming(false);
                emitActiveUIEvent('action.outcome', {
                    actionId: 'report.query',
                    outcome: 'cancelled',
                    message: '用户取消了查询，未执行',
                });
            },
        });
    }, [modal]);

    const bridgeContext = useMemo<BIReportBridgeContext>(() => ({
        view,
        reports,
        reportsLoading,
        queryNode,
        tableColumns: tableState.columns,
        tableLoading: tableState.loading,
        confirming,
        readTable: () => tableApiRef.current,
        confirmQuery,
    }), [view, reports, reportsLoading, queryNode, tableState, confirming, confirmQuery]);
    const bridge = useMemo(() => createBIReportBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <>
            <div className="page-container page-fill">
                <PageBreadcrumb trail={trail}/>
                <Splitter style={{
                    flex: 1,
                    minHeight: 0,
                    height: 'auto',
                    // 10px 圆角配 `0 0 10px` 的阴影，四个角的圆弧会被阴影填平，
                    // 看起来像圆角外多了四块灰色直角背景 —— 要阴影就往单侧加（0 2px 8px）。
                    borderRadius: '10px',
                    overflow: 'hidden',
                }}>
                    <Splitter.Panel defaultSize="20%" min="15%" max="40%">
                        <BITree open={openReport} onLoaded={handleReportsLoaded}></BITree>
                    </Splitter.Panel>
                    <Splitter.Panel>
                        <BITable node={queryNode} apiRef={tableApiRef} onStateChange={handleTableState}/>
                    </Splitter.Panel>
                </Splitter>
            </div>
            <BIQueryParam node={selectedNode} open={openQuery}
                          query={(node) => {
                              setQueryNode({...node});
                              isDebugEnv && console.log("查询：", node);
                              setOpenQuery(false);
                          }}
                          onClose={() => setOpenQuery(false)}/>
        </>
    );
}

export default BIPage;
