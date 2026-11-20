import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {BIList} from "@/api/modules/bi.ts";
import type {ColumnsDefine} from "@visactor/vtable";
import {GridTable, type GridTableApi} from "@/components/grid-table";
import {biService} from "@/services/bi.ts";
import {DataTable} from "@/services/sql.ts";
import {buildColumns} from "@/components/grid-table/columnBuilder.ts";
import {toNumberOrZero} from "@/utils";
import {Empty, Typography} from "antd";
import {BI_REPORT_ROW_KEY} from "./bridged";

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0018_V0112");


export interface BITableProps {
    node?: BIList;
    /** 页面持有的表格实例引用（界面桥按显示行号取数用）；不传则组件内部自持 */
    apiRef?: React.RefObject<GridTableApi | null>;
    /** 列目录与加载态上报给页面（界面桥的快照结构随报表变化） */
    onStateChange?: (state: {columns: ColumnsDefine; loading: boolean}) => void;
}

export const BITable: React.FC<BITableProps> = ({node, apiRef, onStateChange}) => {

    const [columns, setColumns] = useState<ColumnsDefine>([]);
    const [datas, setDatas] = useState<Record<string, unknown>[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    /**
     * 已经查完的 node。与当前 node 不是同一个引用 = 有一轮查询在路上
     * （node 刚变到 effect 真正发起请求之间还隔着一帧，那一帧要靠它顶住 loading）
     */
    const [loadedNode, setLoadedNode] = useState<BIList>();
    const innerRef = useRef<GridTableApi | null>(null);
    const tableRef = apiRef ?? innerRef;
    const [summaryColumns, setSummaryColumns] = useState<string[]>([]);

    const loadData = useCallback(async () => {
        if (!node) {
            return;
        }
        setLoading(true);
        try {
            const result = await biService.query(node);
            const dataTable = new DataTable(result);
            let summaryCols = dataTable.columns.filter(col => col.dataType === 'int' || col.dataType === 'double').map(col => col.field);
            setSummaryColumns(summaryCols);
            setColumns(buildColumns(dataTable.columns))
            // 报表行没有业务主键：注入本次查询结果的序号作为行主键（界面桥 rowId 与选中都靠它）
            setDatas(dataTable.datas.map((row, index) => ({...row, [BI_REPORT_ROW_KEY]: String(index + 1)})));
        } finally {
            // 查询失败也要复位，否则会一直卡在「加载中」
            setLoading(false);
            setLoadedNode(node);
        }
    }, [node])

    useEffect(() => {
        tableRef.current?.autoFitColumns();
    }, [datas]);

    useEffect(() => {
        void loadData();
    }, [node])

    // node 变了但这一轮还没查完：立刻显示加载态，别让上一张表的空壳闪一下
    const pending = !!node && node !== loadedNode;

    // 把列目录与有效加载态同步给页面（界面桥据此重建列目录 / 标记读不到）
    useEffect(() => {
        onStateChange?.({columns, loading: loading || pending});
    }, [columns, loading, pending, onStateChange]);

    // 根据过滤后的数据计算汇总
    const resolvedSummary = useMemo(() => {
        if (summaryColumns.length < 1) return undefined;
        return datas.reduce((acc, item) => {
            summaryColumns.forEach((col) => {
                const totalNum = toNumberOrZero(acc[col]);
                const value = toNumberOrZero(item[col]);
                acc[col] = toNumberOrZero(totalNum + value);
            });
            return acc;
        }, Object.fromEntries(summaryColumns.map(col => [col, 0])))
    }, [summaryColumns, datas]);

    // 还没选过报表：不建空表（会被误读成「查出来是空的」），直接给一句引导
    if (!node) {
        return (
            <div style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                        <>
                            <Typography.Text>{t("请先选择报表")}</Typography.Text>
                            <br/>
                            <Typography.Text type="secondary" style={{fontSize: 12}}>
                                {t("在左侧选择报表，设置查询条件后点击「确定」")}</Typography.Text>
                        </>
                    }
                />
            </div>
        );
    }

    return (
        <>
            <GridTable ref={tableRef} rowKey={BI_REPORT_ROW_KEY} columns={columns} records={datas} loading={loading || pending}
                    summary={resolvedSummary}/>
        </>
    )
}

export default BITable;
