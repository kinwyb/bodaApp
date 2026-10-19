import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {BIList} from "@/api/modules/bi.ts";
import type {ColumnsDefine} from "@visactor/vtable";
import {VTable, type VTableApi} from "@/components/vtable";
import {biService} from "@/services/bi.ts";
import {DataTable} from "@/services/sql.ts";
import {buildColumns} from "@/components/vtable/columnBuilder.ts";
import {toNumberOrZero} from "@/utils";
import {Empty, Typography} from "antd";

export interface BITableProps {
    node?: BIList
}

export const BITable: React.FC<BITableProps> = ({node}) => {

    const [columns, setColumns] = useState<ColumnsDefine>([]);
    const [datas, setDatas] = useState<Record<string, unknown>[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    /**
     * 已经查完的 node。与当前 node 不是同一个引用 = 有一轮查询在路上
     * （node 刚变到 effect 真正发起请求之间还隔着一帧，那一帧要靠它顶住 loading）
     */
    const [loadedNode, setLoadedNode] = useState<BIList>();
    const tableRef = useRef<VTableApi | null>(null);
    const [summaryColumns, setSummaryColumns] = useState<string[]>([]);

    const loadData = useCallback(async () => {
        if (!node) {
            return;
        }
        setLoading(true);
        try {
            const result = await biService.query(node);
            const dataTable = new DataTable(result);
            let summaryCols = dataTable.columns.filter(col => col.dataType === 'number').map(col => col.field);
            setSummaryColumns(summaryCols);
            setColumns(buildColumns(dataTable.columns))
            setDatas(dataTable.datas);
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
                            <Typography.Text>请先选择报表</Typography.Text>
                            <br/>
                            <Typography.Text type="secondary" style={{fontSize: 12}}>
                                在左侧选择报表，设置查询条件后点击「确定」
                            </Typography.Text>
                        </>
                    }
                />
            </div>
        );
    }

    // node 变了但这一轮还没查完：立刻显示加载态，别让上一张表的空壳闪一下
    const pending = node !== loadedNode;

    return (
        <>
            <VTable ref={tableRef} columns={columns} records={datas} loading={loading || pending}
                    summary={resolvedSummary}/>
        </>
    )
}

export default BITable;