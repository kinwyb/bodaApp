import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {App, Button, Input, Modal} from 'antd';
import {misProductionApi, type MisProduceDataRow} from '@/api';
import {ErrorMessage} from '@/api/request';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import {useAuth} from '@/store/auth-context';
import {toStringOrEmpty} from '@/utils';
import {createQtyChangeBridge, type QtyChangeBridgeContext} from './qtyChangeBridge';

export type QtyChangeModalProps = {
    open: boolean;
    view: string;
    row: MisProduceDataRow | null;
    onClose: () => void;
    onSaved: (qty: number) => void;
};

export function QtyChangeModal({open, view, row, onClose, onSaved}: QtyChangeModalProps): React.ReactElement {
    const {message} = App.useApp();
    const {userInfo} = useAuth();
    const [newQty, setNewQty] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();

    useEffect(() => {
        if (!open) return;
        setNewQty('');
        setError(undefined);
    }, [open, row]);

    const submit = useCallback(async () => {
        const qty = Number(newQty);
        if (!newQty.trim()) {
            setError('请输入新数量');
            return;
        }
        if (!Number.isInteger(qty) || qty < 0) {
            setError('请输入有效数字');
            return;
        }
        setError(undefined);
        setLoading(true);
        try {
            await misProductionApi.changeScanQty(toStringOrEmpty(row?.Barcode), qty, toStringOrEmpty(userInfo?.EmpID));
            onSaved(qty);
            void message.success('修改成功');
            onClose();
        } catch (submitError) {
            void message.error(ErrorMessage(submitError, '保存失败'));
        } finally {
            setLoading(false);
        }
    }, [message, newQty, onClose, onSaved, row?.Barcode, userInfo?.EmpID]);

    const bridgeContext = useMemo<QtyChangeBridgeContext>(() => ({
        date: row?.DateShiftStart ?? '',
        machCode: toStringOrEmpty(row?.MachCode),
        dispatchNo: row?.DispatchNo ?? '',
        employeeName: row?.EmployeeName ?? '',
        oldQty: row?.Qty ?? 0,
        newQty,
        loading,
        error,
        setNewQty,
        submit,
        close: onClose,
    }), [row, newQty, loading, error, submit, onClose]);
    const bridge = useMemo(() => createQtyChangeBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeDialog(view, bridge, open);

    return (
        <Modal open={open} title="修改挡车数量" width={420} destroyOnHidden footer={null} onCancel={onClose}>
            <div style={{display: 'grid', gap: 10, marginTop: 16}}>
                <span>日期：{row?.DateShiftStart || '-'}</span>
                <span>机台号：{row?.MachCode ?? '-'}</span>
                <span>派工单号：{row?.DispatchNo || '-'}</span>
                <span>挡车工：{row?.EmployeeName || '-'}</span>
                <span>原数量：{row?.Qty ?? 0}</span>
                <Input
                    autoFocus
                    value={newQty}
                    status={error ? 'error' : undefined}
                    placeholder="请输入新数量"
                    onChange={(event) => {
                        setNewQty(event.target.value);
                        setError(undefined);
                    }}
                />
                {error ? <span style={{color: '#cf1322'}}>{error}</span> : null}
            </div>
            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 20}}>
                <Button type="primary" loading={loading} onClick={() => void submit()}>保存</Button>
            </div>
        </Modal>
    );
}
