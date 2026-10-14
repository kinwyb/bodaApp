import {Modal} from "antd";
import {VTable, type VTableCellStyle, type VTableCellStyleHook} from "@/components/VTable.tsx";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import {COLUMNS} from "../columns.ts";
import type {YupaiOrder} from "@/api";
import {yupaiService} from "@/services/yupai.ts";
import type {ColumnsDefine} from "@visactor/vtable";
import {type AppColumnDef, buildColumns} from "@/components/columnBuilder.ts";
import {toNumberOrZero} from "@/utils";

export interface yupaiOrderLogModalProps {
    open: boolean;
    /** 要看哪一单：由调用方在打开时决定（页面里记的是「打开那一刻的那一单」） */
    yupaiOrderID: string,
    onCancel: () => void;
}

const columns: AppColumnDef[] = [...COLUMNS,
    {field: 'CreateTime', title: '创建时间', width: 140, dataType: 'datetime'},
    {field: 'CreateUser', title: '创建人', width: 110,},
    {field: 'UpdateTime', title: '更新时间', width: 140, dataType: 'datetime'},
    {field: 'UpdateUser', title: '更新人', width: 110},
    {field: 'DelTime', title: '取消时间', width: 140, dataType: 'datetime'},
    {field: 'DelUser', title: '取消人', width: 110},
]

function buildPreorderColumns(): ColumnsDefine {
    return buildColumns(columns);
}


export const YupaiOrderLogModal: React.FC<yupaiOrderLogModalProps> = ({
                                                                          open,
                                                                          onCancel,
                                                                          yupaiOrderID,
                                                                      }) => {

    const [dataSource, setDataSource] = useState<YupaiOrder[]>([]);
    const columns = useMemo(() => buildPreorderColumns(), []);

    const loadData = useCallback(async () => {
        const data = await yupaiService.log(yupaiOrderID);
        setDataSource(data);
    }, [yupaiOrderID])

    // 依赖里必须带 open：只依赖 loadData 的话，关闭时不会走「清空」那一支，
    // 而「同一单第二次打开」时 loadData 引用没变（yupaiOrderID 没变）→ 也不会重新加载。
    useEffect(() => {
        if (!open) {
            setDataSource([]);
            return;
        }
        void loadData();
    }, [open, loadData])

    const cellStyle: VTableCellStyleHook = useCallback(
        ({rowKey, record, isSummaryRow, rowIndex}) => {
            // 统计行 / 空白补足行不参与业务标记
            if (!rowKey || isSummaryRow || !record) return undefined;
            const style: VTableCellStyle = {};
            if (record && rowIndex === 0) {
                style.textColor = '#389e0d';
            } else {
                const isDel = toNumberOrZero(record["IsDel"]) == 1;
                if (isDel) {
                    style.textColor = 'red';
                }
            }
            // 空对象 = 不改，翻译层会兜住
            return style;
        },
        [],
    );

    return (<Modal
        open={open}
        title={"修改日志"}
        width="94vw"
        destroyOnHidden
        style={{top: 24, maxWidth: 1600}}
        styles={{
            body: {
                height: 'calc(50vh - 168px)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            },
        }}
        centered
        footer={null}
        mask={{closable: false}}
        onCancel={onCancel}
    >
        <div
            style={{
                position: "relative",
                flex: 1,
                border: "1px solid #f0f0f0",
                borderRadius: "4px",
                overflow: "hidden"
            }}>
            <VTable columns={columns} records={dataSource} multiSelect={false} cellStyle={cellStyle} rowKey={"ID"}/>
        </div>
    </Modal>)
}