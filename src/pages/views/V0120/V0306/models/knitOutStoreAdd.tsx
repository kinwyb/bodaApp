import React, {useCallback, useMemo, useState} from 'react';
import {App, Button, Input, Modal} from 'antd';
import {misProductionApi, type MisAppletsQRCodeData} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable} from '@/components/grid-table';
import {useAuth} from '@/store/auth-context';
import {now} from '@/utils';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import {
    createKnitOutStoreAddBridge,
    type KnitOutStoreAddBridgeContext,
} from './knitOutStoreAddBridge';

const SCAN_COLUMNS = [
    {field: 'RowNo', title: '行号', width: 60, dataType: 'int' as const},
    {field: 'OrderCode', title: '订单号', width: 115},
    {field: 'ProductCode', title: '物料编码', width: 110},
    {field: 'ProductName', title: '物料名称', width: 150},
    {field: 'Color', title: '颜色', width: 90},
    {field: 'Size', title: '尺码', width: 70},
    {field: 'DispatchNo', title: '派工单号', width: 125},
    {field: 'MachCode', title: '机台号', width: 90, dataType: 'int' as const},
    {field: 'Qty', title: '数量', width: 90, dataType: 'int' as const, aggregate: 'sum' as const},
];

export type KnitOutStoreAddProps = {
    open: boolean;
    view: string;
    onClose: () => void;
    onSaved: () => void;
};

export function KnitOutStoreAdd({
    open,
    view,
    onClose,
    onSaved,
}: KnitOutStoreAddProps): React.ReactElement {
    const {message} = App.useApp();
    const {userInfo} = useAuth();
    const [barcode, setBarcode] = useState('');
    const [rows, setRows] = useState<MisAppletsQRCodeData[]>([]);
    const [billCode, setBillCode] = useState('');
    const [loading, setLoading] = useState(false);
    const billDate = now().format('YYYY-MM-DD');
    const createUser = userInfo?.EmpName ?? '';

    const addBarcode = useCallback(async (code: string) => {
        const trimmed = code.trim();
        if (!trimmed) return;
        if (rows.some((row) => row.QRCode === trimmed)) {
            void message.warning('重复条码');
            return;
        }
        setLoading(true);
        try {
            const result = await misProductionApi.productOutStoreQrcodeData(trimmed);
            if (!result.data) {
                void message.warning('没有查到条码数据');
                return;
            }
            if (rows.some((row) => row.QRCode === result.data?.QRCode)) {
                void message.warning('重复条码');
                return;
            }
            setRows((previous) => [
                ...previous,
                {...result.data!, RowNo: previous.length + 1},
            ]);
            setBarcode('');
        } catch (error) {
            void message.error(ErrorMessage(error, '条码异常'));
        } finally {
            setLoading(false);
        }
    }, [message, rows]);

    const submit = useCallback(async () => {
        setLoading(true);
        try {
            const result = await misProductionApi.productOutStoreBillSave(rows);
            const [nextBillCode] = (result.data ?? '').split('|');
            setBillCode(nextBillCode ?? '');
            void message.success('出库单保存成功');
            onSaved();
        } catch (error) {
            void message.error(ErrorMessage(error, '出库单保存失败'));
        } finally {
            setLoading(false);
        }
    }, [message, onSaved, rows]);

    const bridgeContext = useMemo<KnitOutStoreAddBridgeContext>(() => ({
        billCode,
        billDate,
        createUser,
        barcode,
        rows,
        loading,
        setBarcode,
        addBarcode,
        submit,
        close: onClose,
    }), [billCode, billDate, createUser, barcode, rows, loading, addBarcode, submit, onClose]);
    const bridge = useMemo(() => createKnitOutStoreAddBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeDialog(view, bridge, open);

    return (
        <Modal
            open={open}
            title="新增白坯出库单"
            width={980}
            destroyOnHidden
            footer={null}
            onCancel={onClose}
        >
            <div style={{display: 'flex', gap: 16, marginBottom: 12}}>
                <span>单据号：{billCode || '-'}</span>
                <span>制单日期：{billDate}</span>
                <span>制单人：{createUser || '-'}</span>
            </div>
            <Input.Search
                autoFocus
                allowClear
                value={barcode}
                loading={loading}
                placeholder="扫描或输入条码后回车"
                enterButton="添加条码"
                onChange={(event) => setBarcode(event.target.value)}
                onSearch={(value) => void addBarcode(value)}
                style={{marginBottom: 12}}
            />
            <div style={{height: 420, display: 'flex', flexDirection: 'column'}}>
                <FilterTable
                    columns={SCAN_COLUMNS}
                    records={rows}
                    rowKey="QRCode"
                    loading={loading}
                    emptyTip="没有任何记录"
                    showSummary
                />
            </div>
            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 16}}>
                <Button type="primary" loading={loading} disabled={rows.length === 0} onClick={() => void submit()}>
                    保存
                </Button>
            </div>
        </Modal>
    );
}
