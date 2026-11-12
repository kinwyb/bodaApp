import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {App, Modal} from 'antd';
import type {SalaryBonusMachRate} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable} from '@/components/grid-table';
import type {AppColumnDef} from '@/components/grid-table';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import type {UIDialogHost} from '@/pages/agent/ui-bridge';

const MACH_RATE_COLUMNS: AppColumnDef[] = [
    {field: 'WorkDate', title: '日期', width: 110, dataType: 'date', filterType: 'date'},
    {field: 'EmployeeNo', title: '员工号', width: 100, filterType: 'text'},
    {field: 'Employee', title: '员工', width: 100, filterType: 'text'},
    {field: 'MachCode', title: '机台号', width: 90, dataType: 'int', filterType: 'number'},
    {field: 'Rate', title: '效率', width: 90, dataType: 'double', filterType: 'number'},
    {field: 'Qty', title: '产量', width: 90, dataType: 'int', aggregate: 'sum', filterType: 'number'},
    {field: 'Bonus', title: '奖金', width: 100, dataType: 'double', aggregate: 'sum', filterType: 'number'},
];

export type MachRateModalProps = {
    open: boolean;
    view: string;
    title: string;
    month: string;
    employeeNo: string;
    loadRate: (month: string, employeeNo: string) => Promise<SalaryBonusMachRate[]>;
    onClose: () => void;
};

export function MachRateModal({
    open,
    view,
    title,
    month,
    employeeNo,
    loadRate,
    onClose,
}: MachRateModalProps): React.ReactElement {
    const {message} = App.useApp();
    const [rows, setRows] = useState<SalaryBonusMachRate[]>([]);
    const [loading, setLoading] = useState(false);

    const reload = useCallback(async () => {
        if (!open || !month || !employeeNo) {
            setRows([]);
            return;
        }
        setLoading(true);
        try {
            const result = await loadRate(month, employeeNo);
            setRows(result.map((row, index) => ({
                ...row,
                _rowKey: `${row.WorkDate}|${row.EmployeeNo}|${row.MachCode}|${index}`,
            })));
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
        }
    }, [employeeNo, loadRate, message, month, open]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const dialogBridge = useMemo<UIDialogHost>(() => ({
        snapshot: () => ({
            id: 'machRate',
            title,
            mode: 'view',
            recordId: employeeNo || null,
            fields: [
                {id: 'Month', label: '月份', type: 'text', value: month, readOnly: true},
                {id: 'EmployeeNo', label: '员工号', type: 'text', value: employeeNo, readOnly: true},
                {
                    id: 'Rows',
                    label: '效率明细',
                    type: 'text',
                    value: JSON.stringify(rows),
                    readOnly: true,
                    hint: '只读明细 JSON；包含日期、员工、机台、效率、产量和奖金',
                },
            ],
            errors: [],
        }),
        actions: () => [
            {id: 'rate.reload', label: '重新加载效率明细', group: 'form'},
            {id: 'form.cancel', label: '关闭', group: 'form'},
        ],
        handlers: {
            'rate.reload': async () => {
                await reload();
                return '效率明细已重新加载';
            },
            'form.cancel': () => onClose(),
        },
        guide: {
            summary: `${title}：查看员工在指定月份的机台效率、产量和奖金明细`,
            cautions: ['弹窗是只读的；Rows 字段是当前明细的 JSON 投影。'],
        },
        ready: () => !loading,
    }), [employeeNo, loading, month, onClose, reload, rows, title]);
    useUIBridgeDialog(view, dialogBridge, open);

    return (
        <Modal
            open={open}
            title={`${title}${employeeNo ? ` - ${employeeNo}` : ''}`}
            width={860}
            footer={null}
            destroyOnHidden
            onCancel={onClose}
        >
            <div style={{height: 460, display: 'flex', flexDirection: 'column'}}>
                <FilterTable
                    columns={MACH_RATE_COLUMNS}
                    records={rows}
                    rowKey="_rowKey"
                    loading={loading}
                    emptyTip="没有任何记录"
                />
            </div>
        </Modal>
    );
}
