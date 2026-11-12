import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Input, Space} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import {misProductionMonitorApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {CommandBar} from '@/components/CommandBar';
import {
    FilterTable,
    type FilterTableApi,
    type GridTableCellValueChangeInfo,
    type GridTableSelectedRowChangeInfo,
} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {OrderCodeQuickSelect} from '@/components/quick-select';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {formatDate, toDayjs, toNumberOrZero} from '@/utils';
import {createOrderInfoBridge, type OrderInfoBridgeContext} from './bridged';
import {ORDER_INFO_COLUMNS} from './columns';
import {type OrderInfoCommandContext, useOrderInfoCommands} from './command';
import {commitActiveEditor} from './editorSession';
import {
    createDefaultQuery,
    editLockReason,
    isBlankStLot,
    isEditableField,
    isMoLinkedField,
    type OrderInfoQuery,
    type OrderInfoQueryResult,
    type OrderInfoRow,
    type OrderInfoSaveResult,
    queryToReq,
    rowIdFromRecord,
    sameShiftStart,
    toSavePayload,
    validateEditableValue,
    validateQuery,
    validateSaveRows,
    withFlagString,
} from './orderInfo';
import {useOrderInfoEditors} from './useOrderInfoEditors';

type SearchValues = {
    startDate: Dayjs;
    endDate: Dayjs;
    orderCode?: string;
    machineCode?: string;
};

const OrderInfoPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [query, setQuery] = useState<OrderInfoQuery>(createDefaultQuery);
    const initialQueryRef = useRef(query);
    const [initialSearchValues] = useState(() => ({
        startDate: toDayjs(query.startDate),
        endDate: toDayjs(query.endDate),
        orderCode: query.orderCode,
        machineCode: query.machineCode,
    }));
    const [rows, setRows] = useState<OrderInfoRow[]>([]);
    const rowsRef = useRef<OrderInfoRow[]>([]);
    const [activeRow, setActiveRow] = useState<OrderInfoRow | null>(null);
    const activeRowRef = useRef<OrderInfoRow | null>(null);
    const [editing, setEditing] = useState(false);
    const editingRef = useRef(false);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);
    const [dirtyCount, setDirtyCount] = useState(0);
    const dirtyIdsRef = useRef(new Set<number>());
    const [orderPickerOpen, setOrderPickerOpen] = useState(false);
    const pendingReselectRef = useRef<string | null>(null);
    const querySeqRef = useRef(0);
    const queryAbortRef = useRef<AbortController | null>(null);

    const commitRows = useCallback((next: OrderInfoRow[]) => {
        rowsRef.current = next;
        setRows(next);
    }, []);

    const updateEditing = useCallback((value: boolean) => {
        editingRef.current = value;
        setEditing(value);
    }, []);

    const updateActiveRow = useCallback((row: OrderInfoRow | null) => {
        activeRowRef.current = row;
        setActiveRow(row);
    }, []);

    const applyRowPatch = useCallback((id: number, patch: Partial<OrderInfoRow>) => {
        const current = rowsRef.current;
        const index = current.findIndex((row) => row.ID === id);
        if (index < 0) return;
        const nextRow = withFlagString({...current[index], ...patch});
        const next = [...current];
        next[index] = nextRow;
        commitRows(next);
        dirtyIdsRef.current.add(id);
        setDirtyCount(dirtyIdsRef.current.size);
        if (activeRowRef.current?.ID === id) {
            activeRowRef.current = nextRow;
            setActiveRow(nextRow);
        }
        pendingReselectRef.current = String(id);
    }, [commitRows]);

    const fillDownStLot = useCallback((sourceId: number, stLot: string) => {
        const source = rowsRef.current.find((row) => row.ID === sourceId);
        const table = tableRef.current;
        if (!source || !table || isBlankStLot(stLot)) return;
        const sourceInfo = table.getRowByKey(String(sourceId));
        if (!sourceInfo) return;
        const nextInfo = table.getRowByIndex(sourceInfo.rowIndex + 1);
        if (!nextInfo || nextInfo.isSummaryRow || nextInfo.isGroupRow) return;
        const next = nextInfo.record as OrderInfoRow;
        const nextId = rowIdFromRecord(next);
        if (nextId === null || next.Flag === 1 || !isBlankStLot(next.StLot)) return;
        if (!sameShiftStart(next.DateStartShift, source.DateStartShift)) return;
        if (toNumberOrZero(next.MachCode) !== toNumberOrZero(source.MachCode)) return;
        applyRowPatch(nextId, {StLot: stLot});
    }, [applyRowPatch]);

    const editors = useOrderInfoEditors({
        isEditing: () => editingRef.current,
        applyPatch: applyRowPatch,
        fillDownStLot,
    });

    const executeQuery = useCallback(async (payload: OrderInfoQuery): Promise<OrderInfoQueryResult> => {
        const seq = ++querySeqRef.current;
        queryAbortRef.current?.abort();
        const controller = new AbortController();
        queryAbortRef.current = controller;
        let timedOut = false;
        const timer = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, 15000);
        setLoading(true);
        try {
            const result = await misProductionMonitorApi.orderList(queryToReq(payload), controller.signal);
            if (seq !== querySeqRef.current) {
                return {ok: false, message: '查询已被新的查询取代', total: rowsRef.current.length};
            }
            const next = (result.data ?? []).map(withFlagString);
            tableRef.current?.getTable()?.cancelEditCell();
            commitRows(next);
            dirtyIdsRef.current.clear();
            setDirtyCount(0);
            updateEditing(false);
            updateActiveRow(null);
            pendingReselectRef.current = null;
            return {ok: true, message: `查询成功，共 ${next.length} 条记录`, total: next.length};
        } catch (error) {
            if (seq !== querySeqRef.current) {
                return {ok: false, message: '查询已被新的查询取代', total: rowsRef.current.length};
            }
            const text = timedOut ? '查询超时，请稍后重试' : ErrorMessage(error, '数据加载失败');
            void message.error(text);
            return {ok: false, message: text, total: rowsRef.current.length};
        } finally {
            window.clearTimeout(timer);
            if (seq === querySeqRef.current) {
                setLoading(false);
                queryAbortRef.current = null;
            }
        }
    }, [commitRows, message, updateActiveRow, updateEditing]);

    useEffect(() => {
        void executeQuery(initialQueryRef.current);
        return () => {
            querySeqRef.current += 1;
            queryAbortRef.current?.abort();
        };
    }, [executeQuery]);

    const applyQuery = useCallback((next: OrderInfoQuery): Promise<OrderInfoQueryResult> => {
        const normalized: OrderInfoQuery = {
            ...next,
            orderCode: next.orderCode.trim(),
            machineCode: next.machineCode.trim(),
        };
        const issue = validateQuery(normalized);
        if (issue) {
            return Promise.resolve({ok: false, message: issue, total: rowsRef.current.length});
        }
        setQuery(normalized);
        form.setFieldsValue({
            startDate: toDayjs(normalized.startDate),
            endDate: toDayjs(normalized.endDate),
            orderCode: normalized.orderCode,
            machineCode: normalized.machineCode,
        });
        return executeQuery(normalized);
    }, [executeQuery, form]);

    const startEdit = useCallback(() => {
        if (loading || saving) return;
        updateEditing(true);
    }, [loading, saving, updateEditing]);

    const save = useCallback(async (): Promise<OrderInfoSaveResult> => {
        if (!editingRef.current) return {ok: true, message: '当前没有处于编辑态'};
        const committed = await commitActiveEditor(tableRef);
        if (!committed) {
            const text = '当前单元格校验未通过，请修正后重试，或按 ESC 放弃本次输入';
            void message.warning(text);
            return {ok: false, message: text};
        }
        const dirtyRows = rowsRef.current.filter((row) => {
            const id = rowIdFromRecord(row);
            return id !== null && dirtyIdsRef.current.has(id);
        });
        if (dirtyRows.length === 0) {
            updateEditing(false);
            return {ok: true, message: '没有改动，已退出编辑'};
        }
        const issues = validateSaveRows(dirtyRows);
        if (issues.length > 0) {
            const text = issues.join('；');
            void message.error(text);
            return {ok: false, message: text};
        }
        setSaving(true);
        try {
            await misProductionMonitorApi.orderChange(dirtyRows.map(toSavePayload));
            dirtyIdsRef.current.clear();
            setDirtyCount(0);
            updateEditing(false);
            const text = `已保存 ${dirtyRows.length} 条记录`;
            void message.success(text);
            return {ok: true, message: text};
        } catch (error) {
            const text = ErrorMessage(error, '数据保存失败');
            void message.error(text);
            return {ok: false, message: text};
        } finally {
            setSaving(false);
        }
    }, [message, updateEditing]);

    const removeRow = useCallback((id: number) => {
        commitRows(rowsRef.current.filter((row) => row.ID !== id));
        dirtyIdsRef.current.delete(id);
        setDirtyCount(dirtyIdsRef.current.size);
        updateActiveRow(null);
        pendingReselectRef.current = null;
        tableRef.current?.clearSelection();
    }, [commitRows, updateActiveRow]);

    const insertCopy = useCallback((sourceId: number, row: OrderInfoRow) => {
        const current = rowsRef.current;
        const index = current.findIndex((item) => item.ID === sourceId);
        const next = index < 0
            ? [...current, row]
            : [...current.slice(0, index + 1), row, ...current.slice(index + 1)];
        commitRows(next);
        updateActiveRow(null);
        pendingReselectRef.current = null;
        tableRef.current?.clearSelection();
    }, [commitRows, updateActiveRow]);

    const handleSelectedChange = useCallback((info: GridTableSelectedRowChangeInfo) => {
        const row = (info.record as OrderInfoRow | undefined) ?? null;
        updateActiveRow(row);
        if (row && row.Flag !== 1 && row.Reason === 999) {
            editors.prefetchShifts(formatDate(row.DateStartShift));
        }
    }, [editors, updateActiveRow]);

    const handleCellValueChange = useCallback((info: GridTableCellValueChangeInfo) => {
        if (!editingRef.current) return;
        const id = rowIdFromRecord(info.record);
        if (id === null) return;
        const row = rowsRef.current.find((item) => item.ID === id);
        if (!row || row.Flag === 1) return;
        const field = info.field;
        if (!isEditableField(field) && !isMoLinkedField(field)) return;
        if (isEditableField(field)) {
            const shiftReady = field === 'ShiftName' ? editors.isShiftReady(row.DateStartShift) : true;
            if (editLockReason(row, field, shiftReady)) return;
        }
        applyRowPatch(id, {[field]: info.value} as Partial<OrderInfoRow>);
    }, [applyRowPatch, editors]);

    useLayoutEffect(() => {
        const rowId = pendingReselectRef.current;
        if (!rowId) return;
        pendingReselectRef.current = null;
        tableRef.current?.selectRowsByKeys([rowId]);
    }, [rows]);

    const editableFields = useMemo(
        () => editors.editableFieldsFor(activeRow),
        [activeRow, editors],
    );

    const inlineFieldLock = useCallback((id: string): string | null => {
        if (!editingRef.current) return '先执行 edit 进入编辑态';
        const row = activeRowRef.current;
        if (!row) return '先用 data.select 选中一行';
        return editLockReason(row, id, editors.isShiftReady(row.DateStartShift));
    }, [editors]);

    const writeInline = useCallback((patch: Partial<OrderInfoRow>) => {
        const row = activeRowRef.current;
        const id = rowIdFromRecord(row);
        if (!editingRef.current || id === null) {
            throw new Error('先执行 edit 并用 data.select 选中一行，再写入字段');
        }
        const issues = Object.entries(patch).flatMap(([field, value]) => {
            const lock = inlineFieldLock(field);
            if (lock) return [`${field}：${lock}`];
            const issue = validateEditableValue(field, value);
            return issue ? [`${field}：${issue}`] : [];
        });
        if (issues.length > 0) throw new Error(issues.join('；'));
        applyRowPatch(id, patch);
    }, [applyRowPatch, inlineFieldLock]);

    const applyInlinePatch = useCallback((patch: Partial<OrderInfoRow>) => {
        const row = activeRowRef.current;
        const id = rowIdFromRecord(row);
        if (!editingRef.current || id === null) {
            throw new Error('先执行 edit 并用 data.select 选中一行，再写入字段');
        }
        applyRowPatch(id, patch);
    }, [applyRowPatch]);

    const commandContext = useMemo<OrderInfoCommandContext>(() => ({
        message,
        modal,
        tableRef,
        activeRow,
        editing,
        saving,
        loading,
        startEdit,
        save,
        removeRow,
        insertCopy,
    }), [activeRow, editing, insertCopy, loading, message, modal, removeRow, save, saving, startEdit]);
    const commands = useOrderInfoCommands(commandContext);

    const bridgeContext = useMemo<OrderInfoBridgeContext>(() => ({
        view,
        query,
        commands,
        editing,
        activeRow,
        dirtyCount,
        loading,
        saving,
        applyQuery,
        readTable: () => tableRef.current,
        save,
        readActiveRow: () => activeRowRef.current,
        fieldLock: inlineFieldLock,
        writeInline,
        applyInlinePatch,
        loadShifts: editors.loadShifts,
        resolveMo: editors.resolveMo,
        isShiftReady: editors.isShiftReady,
        shiftOptions: editors.shiftOptions,
    }), [
        activeRow,
        applyInlinePatch,
        applyQuery,
        commands,
        dirtyCount,
        editing,
        editors,
        inlineFieldLock,
        loading,
        query,
        save,
        saving,
        view,
        writeInline,
    ]);
    const bridge = useMemo(() => createOrderInfoBridge(() => bridgeContext), [bridgeContext]);
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
                initialValues={initialSearchValues}
                onFinish={(values) => {
                    void applyQuery({
                        startDate: formatDate(values.startDate),
                        endDate: formatDate(values.endDate),
                        orderCode: values.orderCode ?? '',
                        machineCode: values.machineCode ?? '',
                    });
                }}
            >
                <Form.Item name="startDate" label="开始日期" rules={[{required: true, message: '请选择开始日期'}]}>
                    <DatePicker allowClear={false} style={{width: 140}}/>
                </Form.Item>
                <Form.Item
                    name="endDate"
                    label="结束日期"
                    dependencies={['startDate']}
                    rules={[
                        {required: true, message: '请选择结束日期'},
                        ({getFieldValue}) => ({
                            validator(_, value: Dayjs | undefined) {
                                const start = getFieldValue('startDate') as Dayjs | undefined;
                                if (!value || !start || !value.isBefore(start, 'day')) {
                                    return Promise.resolve();
                                }
                                return Promise.reject(new Error('结束日期不能早于开始日期'));
                            },
                        }),
                    ]}
                >
                    <DatePicker allowClear={false} style={{width: 140}}/>
                </Form.Item>
                <Form.Item label="订单号">
                    <Space.Compact>
                        <Form.Item name="orderCode" noStyle>
                            <Input allowClear style={{width: 160}}/>
                        </Form.Item>
                        <Button
                            aria-label="选择订单号"
                            icon={<SearchOutlined/>}
                            onClick={() => setOrderPickerOpen(true)}
                        />
                    </Space.Compact>
                </Form.Item>
                <Form.Item name="machineCode" label="机台号">
                    <Input allowClear style={{width: 100}}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>} loading={loading}>
                        查询
                    </Button>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={ORDER_INFO_COLUMNS}
                records={rows}
                rowKey="ID"
                loading={loading}
                emptyTip="没有任何记录"
                exportName="订单信息补充"
                editableFields={editableFields}
                canEditCell={editors.canEditCell}
                cellTooltip={editors.cellTooltip}
                onCellValueChange={handleCellValueChange}
                onSelectedChange={handleSelectedChange}
            />
            <OrderCodeQuickSelect
                open={orderPickerOpen}
                onCancel={() => setOrderPickerOpen(false)}
                onSelect={(orderCode) => {
                    form.setFieldValue('orderCode', orderCode);
                    setOrderPickerOpen(false);
                }}
            />
        </div>
    );
};

export default OrderInfoPage;
