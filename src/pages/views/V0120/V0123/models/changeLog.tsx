import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Modal, Splitter} from 'antd';
import {misProductionMonitorApi, type ProductionMonitorDetail, type ProductMonitorBJLog} from '@/api';
import {ErrorMessage} from '@/api/request';
import {GridTable, type GridTableApi, type GridTableCellValueChangeInfo} from '@/components/grid-table';
import {registerAntdNumberEditor} from '@/components/grid-table/editors/register';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import {toNumberOrZero, toStringOrEmpty} from '@/utils';
import type {ProductionMonitorRow} from '../types';
import {type ChangeLogBridgeContext, createChangeLogBridge} from './changeLogBridge';
import {CHANGE_LOG_DETAIL_COLUMNS, CHANGE_LOG_LOG_COLUMNS} from './changeLogColumns';

registerAntdNumberEditor('production-monitor-detail-gx', {min: 0, precision: 0}, {
    validator: (value) => (Number.isInteger(value) && (value ?? 0) >= 0 ? undefined : '请输入有效数量'),
});
registerAntdNumberEditor('production-monitor-detail-cp', {min: 0, precision: 0}, {
    validator: (value) => (Number.isInteger(value) && (value ?? 0) >= 0 ? undefined : '请输入有效数量'),
});

const DETAIL_EDITABLE_FIELDS = {
    GxProduction: 'production-monitor-detail-gx',
    CpQty: 'production-monitor-detail-cp',
};

export type ChangeLogModalProps = {
    open: boolean;
    view: string;
    row: ProductionMonitorRow | null;
    onClose: () => void;
    onChanged: () => void;
};

export function ChangeLogModal({open, view, row, onClose, onChanged}: ChangeLogModalProps): React.ReactElement {
    const {message} = App.useApp();
    const detailTableRef = useRef<GridTableApi | null>(null);
    const logTableRef = useRef<GridTableApi | null>(null);
    const [details, setDetails] = useState<ProductionMonitorDetail[]>([]);
    const [logs, setLogs] = useState<ProductMonitorBJLog[]>([]);
    const [activeDetail, setActiveDetail] = useState<ProductionMonitorDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const isTwins = row?.IsTwins === true;
    const rowId = toNumberOrZero(row?.ID);

    const loadDetail = useCallback(async (id: number) => {
        setLoading(true);
        setError(undefined);
        try {
            const result = await misProductionMonitorApi.detail(id);
            const list = result.data ?? [];
            setDetails(list);
        } catch (loadError) {
            const text = ErrorMessage(loadError, '数据加载失败');
            setError(text);
            void message.error(text);
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        const first = details[0] ?? null;
        detailTableRef.current?.selectRowsByKeys([toStringOrEmpty(first?.ID)]);
    }, [details]);

    useEffect(() => {
        if (!open) return;
        if (rowId < 1) return;
        void loadDetail(rowId);
    }, [open, rowId, loadDetail]);

    const persistDetail = useCallback(async (
        target: ProductionMonitorDetail,
        patch: { GxProduction?: number; CpQty?: number },
    ) => {
        const next = {...target, ...patch};
        const fmid = toNumberOrZero(next.FMID);
        if (fmid < 1) throw new Error('明细缺少 FMID，无法保存');
        const num = toNumberOrZero(next.GxProduction);
        const cpnum = isTwins ? toNumberOrZero(next.CpQty) : -1;
        await misProductionMonitorApi.qtyChange(fmid, num, cpnum);
        setDetails((previous) => previous.map((item) => (item.ID === target.ID ? next : item)));
        setActiveDetail((previous) => (previous?.ID === target.ID ? next : previous));
        onChanged();
    }, [isTwins, onChanged]);

    const handleCellValueChange = useCallback((info: GridTableCellValueChangeInfo) => {
        if (info.field !== 'GxProduction' && info.field !== 'CpQty') return;
        const target = info.record as ProductionMonitorDetail | undefined;
        if (!target) return;
        const value = toNumberOrZero(info.value);
        void persistDetail(target, {[info.field]: value}).catch((saveError) => {
            void message.error(ErrorMessage(saveError, '数据修改失败'));
        });
    }, [message, persistDetail]);

    const updateDetail = useCallback(async (patch: { GxProduction?: number; CpQty?: number }) => {
        if (!activeDetail) throw new Error('请先选中一条明细');
        setError(undefined);
        try {
            await persistDetail(activeDetail, patch);
        } catch (saveError) {
            const text = ErrorMessage(saveError, '数据修改失败');
            setError(text);
            throw new Error(text);
        }
    }, [activeDetail, persistDetail]);

    const bridgeContext = useMemo<ChangeLogBridgeContext>(() => ({
        recordId: rowId < 1 ? null : rowId,
        orderCode: row?.OrderCode ?? '',
        dispatchNo: row?.DispatchNo ?? '',
        machCode: toStringOrEmpty(row?.MachCode),
        isTwins,
        loading,
        error,
        activeDetail,
        readDetailTable: () => detailTableRef.current,
        readLogTable: () => logTableRef.current,
        updateDetail,
        close: onClose,
    }), [rowId, row, isTwins, loading, error, activeDetail, updateDetail, onClose]);
    const bridge = useMemo(() => createChangeLogBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeDialog(view, bridge, open);

    return (
        <Modal
            open={open}
            title="产量差异调整表"
            width={1050}
            footer={null}
            destroyOnHidden
            onCancel={onClose}
        >
            <div style={{display: 'flex', flexDirection: 'column', height: 480, marginTop: 12}}>
                <Splitter vertical style={{flex: 1, minHeight: 0, height: 'auto'}}>
                    <Splitter.Panel className="splitter-pane-body" defaultSize={150} min={100}
                                    style={{overflow: 'hidden'}}>
                        <GridTable
                            ref={detailTableRef}
                            columns={CHANGE_LOG_DETAIL_COLUMNS}
                            records={details}
                            rowKey="ID"
                            loading={loading}
                            emptyTip="没有任何记录"
                            editableFields={DETAIL_EDITABLE_FIELDS}
                            editCellTrigger="click"
                            canEditCell={({field}) => field === 'GxProduction' || (field === 'CpQty' && isTwins)}
                            cellTooltip={({field}) => (field === 'CpQty' && !isTwins ? '非双胞胎订单不能修改次品数' : undefined)}
                            onCellValueChange={handleCellValueChange}
                            onSelectedChange={(info) => {
                                const detail = (info.record as ProductionMonitorDetail | undefined) ?? null;
                                setActiveDetail(detail);
                                setLogs(detail?.Detail ?? []);
                            }}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel className="splitter-pane-body" style={{overflow: 'hidden'}}>
                        <div style={{display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0}}>
                            <span style={{padding: '6px 8px', fontWeight: 600}}>明细详情</span>
                            <div style={{flex: 1, minHeight: 0}}>
                                <GridTable
                                    ref={logTableRef}
                                    columns={CHANGE_LOG_LOG_COLUMNS}
                                    records={logs}
                                    rowKey="ID"
                                    emptyTip="没有任何记录"
                                />
                            </div>
                        </div>
                    </Splitter.Panel>
                </Splitter>
            </div>
        </Modal>
    );
}
