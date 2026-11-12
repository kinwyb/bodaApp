import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Input, Space} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import {misProductionMonitorApi, type ProductionMonitorQueryRes} from '@/api';
import {ErrorMessage} from '@/api/request';
import {CommandBar} from '@/components/CommandBar';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import type {FilterModel} from '@/components/grid-table/TableFilter';
import {registerAntdNumberEditor} from '@/components/grid-table/editors/register';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {OrderCodeQuickSelect} from '@/components/quick-select';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {formatDate, now, toDayjs, toNumberOrZero} from '@/utils';
import {createProductionMonitorBridge, type ProductionMonitorBridgeContext} from './bridged';
import {PRODUCTION_MONITOR_COLUMNS} from './columns';
import {type ProductionMonitorCommandContext, useProductionMonitorCommands} from './command';
import {runProductionMonitorAudit} from './command/auditAction';
import {ChangeLogModal} from './models/changeLog';
import type {ProductionMonitorQueryState, ProductionMonitorRow} from './types';

registerAntdNumberEditor('production-monitor-pieces', {min: 0, precision: 0}, {
    validator: (value) => (Number.isInteger(value) && (value ?? 0) >= 0 ? undefined : '请输入有效数量'),
});

const PIECES_EDITABLE_FIELDS = {Pieces: 'production-monitor-pieces'};

type SearchValues = {
    startDate: Dayjs;
    endDate: Dayjs;
    orderCode?: string;
    machineCode?: string;
    roomCode?: string;
    dispatchNo?: string;
};

function toRow(row: ProductionMonitorQueryRes): ProductionMonitorRow {
    const pieces = toNumberOrZero(row.Pieces);
    const cycle = toNumberOrZero(row.Cycle);
    const audit = toNumberOrZero(row.Flag) === 1 ? '审核' : '';
    const adjust = toNumberOrZero(row.Flag2) === 1 ? '调整' : '';
    return {...row, ZPTime: cycle * pieces / 3600, Status: `${audit}${adjust}`};
}

const ProductionMonitorPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const pendingQueryRef = useRef<(() => void) | null>(null);
    const [rows, setRows] = useState<ProductionMonitorRow[]>([]);
    const [query, setQuery] = useState<ProductionMonitorQueryState | null>(null);
    const [loading, setLoading] = useState(false);
    const [activeRow, setActiveRow] = useState<ProductionMonitorRow | null>(null);
    const [selectionCount, setSelectionCount] = useState(0);
    const [filters, setFilters] = useState<FilterModel>({});
    const [orderPickerOpen, setOrderPickerOpen] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogRow, setDialogRow] = useState<ProductionMonitorRow | null>(null);
    const initialStart = useMemo(() => now().add(-1, 'day'), []);
    const initialEnd = useMemo(() => now(), []);

    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        if (!query) return;
        setLoading(true);
        try {
            const result = await misProductionMonitorApi.queryList({
                StartDate: query.startDate,
                EndDate: query.endDate,
                OrderCode: query.orderCode,
                MachineCode: query.machineCode,
                RoomCode: query.roomCode,
            });
            setRows((result.data ?? []).map(toRow));
            setActiveRow(null);
            setSelectionCount(0);
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
            settleQuery();
        }
    }, [message, query, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const applyQuery = useCallback((next: ProductionMonitorQueryState): Promise<void> =>
        new Promise((resolve) => {
            pendingQueryRef.current = resolve;
            form.setFieldsValue({
                startDate: toDayjs(next.startDate),
                endDate: toDayjs(next.endDate),
                orderCode: next.orderCode,
                machineCode: next.machineCode,
                roomCode: next.roomCode,
            });
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

    const getSelectedRows = useCallback((): ProductionMonitorRow[] => {
        const selection = tableRef.current?.getSelection();
        return (selection?.rows ?? []).filter((row) => row.ID !== undefined && row.ID !== null) as ProductionMonitorRow[];
    }, []);

    const changePieces = useCallback(async (rowId: string, pieces: number) => {
        const target = rows.find((row) => String(row.ID ?? '') === rowId);
        if (!target) throw new Error(`未找到行 ${rowId}，请重新 data.page 取 rowId`);
        await misProductionMonitorApi.qtyChange(toNumberOrZero(target.ID), pieces, -1);
        await loadData();
    }, [rows, loadData]);

    const openChangeLog = useCallback((rowId: string) => {
        const target = rows.find((row) => String(row.ID ?? '') === rowId);
        if (!target) throw new Error(`未找到行 ${rowId}，请重新 data.page 取 rowId`);
        if (toNumberOrZero(target.ID) < 1) throw new Error('缺少 fmid，无法打开调整记录');
        setDialogRow(target);
        setDialogOpen(true);
    }, [rows]);

    const handlePiecesChange = useCallback((info: {
        field: string;
        record?: Record<string, unknown>;
        value: unknown
    }) => {
        if (info.field !== 'Pieces') return;
        const rowId = String(info.record?.ID ?? '');
        if (!rowId) return;
        void changePieces(rowId, toNumberOrZero(info.value)).catch((error) => {
            void message.error(ErrorMessage(error, '数据修改失败'));
        });
    }, [changePieces, message]);

    const commandContext = useMemo<ProductionMonitorCommandContext>(() => ({
        message,
        modal,
        tableRef,
        selectionCount,
        getSelectedRows,
        reload: loadData,
    }), [message, modal, selectionCount, getSelectedRows, loadData]);
    const commands = useProductionMonitorCommands(commandContext);
    const auditSelected = useCallback(() => runProductionMonitorAudit(commandContext), [commandContext]);

    const bridgeContext = useMemo<ProductionMonitorBridgeContext>(() => ({
        view,
        query,
        commands,
        activeRow,
        selectionCount,
        applyQuery,
        auditSelected,
        changePieces,
        openChangeLog,
        readTable: () => tableRef.current,
    }), [view, query, commands, activeRow, selectionCount, applyQuery, auditSelected, changePieces, openChangeLog]);
    const bridge = useMemo(() => createProductionMonitorBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <CommandBar view={view} items={commands}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                style={{marginTop: 12}}
                initialValues={{startDate: initialStart, endDate: initialEnd}}
                onFinish={(values) => {
                    const dispatchText = values.dispatchNo?.trim() ?? '';
                    setFilters((previous) => {
                        const next = {...previous};
                        if (dispatchText) next.DispatchNo = {text: dispatchText};
                        else delete next.DispatchNo;
                        return next;
                    });
                    setQuery({
                        startDate: formatDate(values.startDate),
                        endDate: formatDate(values.endDate),
                        orderCode: values.orderCode?.trim() ?? '',
                        machineCode: values.machineCode?.trim() ?? '',
                        roomCode: values.roomCode?.trim() ?? '',
                    });
                }}
            >
                <Form.Item name="startDate" label="开始日期" rules={[{required: true}]}>
                    <DatePicker allowClear={false} style={{width: 130}}/>
                </Form.Item>
                <Form.Item name="endDate" label="结束日期" rules={[{required: true}]}>
                    <DatePicker allowClear={false} style={{width: 130}}/>
                </Form.Item>
                <Form.Item label="订单号">
                    <Space.Compact>
                        <Form.Item name="orderCode" noStyle>
                            <Input allowClear style={{width: 130}}/>
                        </Form.Item>
                        <Button aria-label="选择订单号" icon={<SearchOutlined/>}
                                onClick={() => setOrderPickerOpen(true)}/>
                    </Space.Compact>
                </Form.Item>
                <Form.Item name="machineCode" label="机台号">
                    <Input allowClear style={{width: 100}}/>
                </Form.Item>
                <Form.Item name="roomCode" label="厂别">
                    <Input allowClear style={{width: 120}}/>
                </Form.Item>
                <Form.Item name="dispatchNo" label="派工单号">
                    <Input allowClear style={{width: 160}}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>查询</Button>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={PRODUCTION_MONITOR_COLUMNS}
                records={rows}
                rowKey="ID"
                checkboxSelection
                loading={loading}
                emptyTip="没有任何记录"
                exportName="产量差异调整"
                filters={filters}
                onFilterChange={setFilters}
                editableFields={PIECES_EDITABLE_FIELDS}
                editCellTrigger="click"
                onCellValueChange={handlePiecesChange}
                onSelectedChange={(info) => setActiveRow((info.record as ProductionMonitorRow | undefined) ?? null)}
                onActiveSelectionChange={(info) => setSelectionCount(info.rowCount)}
                onCellDblClick={(info) => {
                    if (info.isSummaryRow) return;
                    if (info.field === 'Pieces' || info.field === '__grid_selection_checkbox__') return;
                    const rowId = String(info.record?.ID ?? '');
                    if (!rowId) return;
                    try {
                        openChangeLog(rowId);
                    } catch (error) {
                        void message.warning(ErrorMessage(error, '无法打开调整记录'));
                    }
                }}
            />
            <OrderCodeQuickSelect
                open={orderPickerOpen}
                onCancel={() => setOrderPickerOpen(false)}
                onSelect={(orderCode) => {
                    form.setFieldValue('orderCode', orderCode);
                    setOrderPickerOpen(false);
                }}
            />
            <ChangeLogModal
                open={dialogOpen}
                view={view}
                row={dialogRow}
                onClose={() => setDialogOpen(false)}
                onChanged={() => void loadData()}
            />
        </div>
    );
};

export default ProductionMonitorPage;
