import React, {useCallback, useEffect, useRef, useState} from "react";
import type {BIList} from "@/api/modules/bi.ts";
import type {ColumnsDefine} from "@visactor/vtable";
import {VTable, type VTableApi} from "@/components/vtable";
import {biService} from "@/services/bi.ts";
import {DataTable} from "@/services/sql.ts";
import {buildColumns} from "@/components/vtable/columnBuilder.ts";

export interface BITableProps {
    node?: BIList
}

export const BITable: React.FC<BITableProps> = ({node}) => {

    const [columns, setColumns] = useState<ColumnsDefine>([]);
    const [datas, setDatas] = useState<Record<string, unknown>[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const tableRef = useRef<VTableApi | null>(null);

    const loadData = useCallback(async () => {
        if (!node) {
            return;
        }
        setLoading(true);
        const result = await biService.query(node);
        const dataTable = new DataTable(result);
        setColumns(buildColumns(dataTable.columns))
        setDatas(dataTable.datas);
        setLoading(false);
    }, [node])

    useEffect(() => {
        tableRef.current?.autoFitColumns();
    }, [datas]);

    useEffect(() => {
        void loadData();
    }, [node])

    return (
        <>
            <VTable ref={tableRef} columns={columns} records={datas} loading={loading}/>
        </>
    )
}

export default BITable;