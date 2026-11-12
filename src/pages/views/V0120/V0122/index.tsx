import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Splitter} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import {
    misScheduleApi,
    type MisScheduleEmployee,
    type ScheduleBJ,
} from '@/api';
import {ErrorMessage} from '@/api/request';
import {CommandBar} from '@/components/CommandBar';
import {
    FilterTable,
    type FilterTableApi,
    type GridTableCellValueChangeInfo,
    type GridTableSelectedRowChangeInfo,
} from '@/components/grid-table';
import {registerAntdSelectEditor} from '@/components/grid-table/editors/register';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {formatDate, now, toDayjs, toNumberOrZero, toStringOrEmpty} from '@/utils';
import {
    createScheduleMaintenanceBridge,
    type ScheduleMaintenanceBridgeContext,
} from './bridged';
import {SCHEDULE_COLUMNS} from './columns';
import {
    useScheduleMaintenanceCommands,
    type ScheduleMaintenanceCommandContext,
} from './command';
import {
    applyEmployeeCode as applyEmployeeSelection,
    EMPLOYEE_FIELDS,
    EMPLOYEE_FIELD_META,
    EMPLOYEE_GROUPS,
    employeeCodes,
    employeeOptions as buildEmployeeOptions,
    type EmployeeDirectory,
    type EmployeeField,
    findScheduleEmployee,
    groupMachineSchedules,
    isEmployeeField,
    type ScheduleMutationResult,
    type ScheduleQuery,
    type ScheduleQueryResult,
    toScheduleUpdateReq,
} from './schedule';
import MachineTiles from './MachineTiles';

type SearchValues = {
    date: Dayjs;
};

const today = (): string => formatDate(now());

const ScheduleMaintenancePage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const pageId = useId().replace(/[^a-zA-Z0-9]/g, '');
    const tableRef = useRef<FilterTableApi | null>(null);
    const rowsRef = useRef<ScheduleBJ[]>([]);
    const activeRowRef = useRef<ScheduleBJ | null>(null);
    const editingRef = useRef(false);
    const querySeqRef = useRef(0);
    const employeeDirectoryRef = useRef<EmployeeDirectory>({});
    const employeeLoadPromiseRef = useRef<Promise<boolean> | null>(null);
    const employeeSavingQueuesRef = useRef(new Map<number, Promise<void>>());
    const [rows, setRows] = useState<ScheduleBJ[]>([]);
    const [activeRow, setActiveRow] = useState<ScheduleBJ | null>(null);
    const [query, setQuery] = useState<ScheduleQuery>({date: today()});
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(false);
    const [employeeLoading, setEmployeeLoading] = useState(false);
    const [employeeVersion, setEmployeeVersion] = useState(0);
    const initialDateRef = useRef(query.date);

    const employeeEditorNames = useMemo<Record<EmployeeField, string>>(() => ({
        OpeCode: `v0122-${pageId}-ope1`,
        OpeCode2: `v0122-${pageId}-ope2`,
        OpeCode3: `v0122-${pageId}-ope3`,
        OpeCode4: `v0122-${pageId}-ope4`,
    }), [pageId]);

    const commitRows = useCallback((next: ScheduleBJ[]) => {
        rowsRef.current = next;
        setRows(next);
    }, []);

    const updateEditing = useCallback((next: boolean) => {
        editingRef.current = next;
        setEditing(next);
    }, []);

    const updateActiveRow = useCallback((next: ScheduleBJ | null) => {
        activeRowRef.current = next;
        setActiveRow(next);
    }, []);

    const executeQuery = useCallback(async (date: string): Promise<ScheduleQueryResult> => {
        const seq = ++querySeqRef.current;
        setLoading(true);
        try {
            const result = await misScheduleApi.scheduleLoad(date);
            if (seq !== querySeqRef.current) {
                return {ok: false, message: '查询已被新的查询取代', total: rowsRef.current.length};
            }
            const next = result.data ?? [];
            tableRef.current?.getTable()?.cancelEditCell();
            commitRows(next);
            updateActiveRow(null);
            return {ok: true, message: `查询成功，共 ${next.length} 条排班记录`, total: next.length};
        } catch (error) {
            if (seq !== querySeqRef.current) {
                return {ok: false, message: '查询已被新的查询取代', total: rowsRef.current.length};
            }
            const text = ErrorMessage(error, '班次加载失败');
            void message.error(text);
            return {ok: false, message: text, total: rowsRef.current.length};
        } finally {
            if (seq === querySeqRef.current) setLoading(false);
        }
    }, [commitRows, message, updateActiveRow]);

    useEffect(() => {
        void executeQuery(initialDateRef.current);
        return () => {
            querySeqRef.current += 1;
        };
    }, [executeQuery]);

    const applyQuery = useCallback(async (next: ScheduleQuery): Promise<ScheduleQueryResult> => {
        if (!toDayjs(next.date)) {
            return {ok: false, message: '日期格式应为 YYYY-MM-DD', total: rowsRef.current.length};
        }
        setQuery({...next});
        form.setFieldValue('date', toDayjs(next.date));
        return executeQuery(next.date);
    }, [executeQuery, form]);

    const reload = useCallback(
        (): Promise<ScheduleQueryResult> => applyQuery({
            date: formatDate(form.getFieldValue('date')) || query.date,
        }),
        [applyQuery, form, query.date],
    );

    const loadEmployees = useCallback(async (): Promise<boolean> => {
        if (EMPLOYEE_GROUPS.every((group) => employeeDirectoryRef.current[group])) return true;
        const pending = employeeLoadPromiseRef.current;
        if (pending) return pending;

        setEmployeeLoading(true);
        const request = (async () => {
            try {
                const results = await Promise.all(
                    EMPLOYEE_GROUPS.map(async (group) => ({
                        group,
                        rows: (await misScheduleApi.employees(group)).data ?? [],
                    })),
                );
                const directory: EmployeeDirectory = {};
                results.forEach(({group, rows: employees}) => {
                    directory[group] = employees;
                });
                employeeDirectoryRef.current = directory;
                setEmployeeVersion((version) => version + 1);
                return true;
            } catch (error) {
                void message.error(ErrorMessage(error, '员工资料加载失败'));
                return false;
            } finally {
                employeeLoadPromiseRef.current = null;
                setEmployeeLoading(false);
            }
        })();
        employeeLoadPromiseRef.current = request;
        return request;
    }, [message]);

    useEffect(() => {
        if (employeeVersion === 0) return;
        EMPLOYEE_FIELDS.forEach((field) => {
            registerAntdSelectEditor(
                employeeEditorNames[field],
                {
                    allowClear: true,
                    options: buildEmployeeOptions(employeeDirectoryRef.current, field),
                },
            );
        });
    }, [employeeEditorNames, employeeVersion]);

    const toggleEditing = useCallback(async (): Promise<boolean> => {
        tableRef.current?.getTable()?.cancelEditCell();
        if (editingRef.current) {
            updateEditing(false);
            return true;
        }
        const ready = await loadEmployees();
        if (!ready) return false;
        updateEditing(true);
        return true;
    }, [loadEmployees, updateEditing]);

    const writeEmployeeCode = useCallback(async (
        rowId: number,
        field: EmployeeField,
        code: unknown,
    ): Promise<ScheduleMutationResult> => {
        if (rowId <= 0) return {ok: false, message: '排班记录缺少有效 ID，无法保存'};
        const source = rowsRef.current.find((row) => toNumberOrZero(row.ID) === rowId);
        if (!source) {
            return {ok: false, message: `没有找到 ID = ${rowId} 的排班记录，可能已被重新查询替换`};
        }
        const value = toStringOrEmpty(code).trim();
        const employee = findScheduleEmployee(employeeDirectoryRef.current, field, value);
        if (value && !employee) {
            return {ok: false, message: `员工编号「${value}」不在当前候选列表中，请重新选择`};
        }
        const nextRow = applyEmployeeSelection(source, field, value, employeeDirectoryRef.current);
        const nextRows = rowsRef.current.map((row) =>
            toNumberOrZero(row.ID) === rowId ? nextRow : row,
        );
        commitRows(nextRows);
        if (activeRowRef.current && toNumberOrZero(activeRowRef.current.ID) === rowId) {
            updateActiveRow(nextRow);
        }

        const payload = toScheduleUpdateReq(nextRow);
        const previous = employeeSavingQueuesRef.current.get(rowId) ?? Promise.resolve();
        const request = previous
            .catch(() => undefined)
            .then(() => misScheduleApi.scheduleUpdate(payload));
        const settled = request.then(() => undefined, () => undefined);
        employeeSavingQueuesRef.current.set(rowId, settled);
        try {
            await request;
            const employeeLabel = employee
                ? `${toStringOrEmpty(employee.No)} ${toStringOrEmpty(employee.Name)}`.trim()
                : '空';
            return {
                ok: true,
                message: `已更新${EMPLOYEE_FIELD_META[field].label}为 ${employeeLabel || '空'}`,
            };
        } catch (error) {
            return {ok: false, message: ErrorMessage(error, '编辑失败')};
        } finally {
            if (employeeSavingQueuesRef.current.get(rowId) === settled) {
                employeeSavingQueuesRef.current.delete(rowId);
            }
        }
    }, [commitRows, updateActiveRow]);

    const handleCellValueChange = useCallback(({
        field,
        record,
        value,
    }: GridTableCellValueChangeInfo) => {
        if (!isEmployeeField(field) || !record) return;
        const rowId = toNumberOrZero(record.ID);
        void writeEmployeeCode(rowId, field, value).then((result) => {
            if (!result.ok) void message.error(result.message);
        });
    }, [message, writeEmployeeCode]);

    const handleSelectedChange = useCallback(({record}: GridTableSelectedRowChangeInfo) => {
        if (!record) {
            updateActiveRow(null);
            return;
        }
        const rowId = toNumberOrZero(record.ID);
        updateActiveRow(rowsRef.current.find((row) => toNumberOrZero(row.ID) === rowId) ?? null);
    }, [updateActiveRow]);

    const editableFields = useMemo<Record<string, string> | undefined>(() => {
        if (!editing || employeeVersion === 0) return undefined;
        return {
            OpeCode: employeeEditorNames.OpeCode,
            OpeCode2: employeeEditorNames.OpeCode2,
            OpeCode3: employeeEditorNames.OpeCode3,
            OpeCode4: employeeEditorNames.OpeCode4,
        };
    }, [editing, employeeEditorNames, employeeVersion]);

    const machineRows = useMemo(() => groupMachineSchedules(rows), [rows]);

    const commandContext = useMemo<ScheduleMaintenanceCommandContext>(() => ({
        message,
        modal,
        tableRef,
        editing,
        employeeLoading,
        loading,
        toggleEditing,
        reload,
    }), [editing, employeeLoading, loading, message, modal, reload, toggleEditing]);
    const commands = useScheduleMaintenanceCommands(commandContext);

    const employeeCodesFor = useCallback((field: EmployeeField): string[] =>
        employeeCodes(employeeDirectoryRef.current, field), []);

    const findEmployee = useCallback((field: EmployeeField, code: unknown): MisScheduleEmployee | undefined =>
        findScheduleEmployee(employeeDirectoryRef.current, field, code), []);

    const writeEmployeeField = useCallback((
        rowId: number,
        field: EmployeeField,
        value: unknown,
    ): Promise<ScheduleMutationResult> => writeEmployeeCode(rowId, field, value), [writeEmployeeCode]);

    const bridgeContext = useMemo<ScheduleMaintenanceBridgeContext>(() => ({
        view,
        query,
        editing,
        employeeLoading,
        reload,
        activeRow,
        commands,
        applyQuery,
        toggleEditing,
        employeeCodes: employeeCodesFor,
        findEmployee,
        writeEmployeeField,
        readScheduleTable: () => tableRef.current,
    }), [
        activeRow,
        applyQuery,
        commands,
        editing,
        employeeLoading,
        employeeCodesFor,
        findEmployee,
        query,
        reload,
        toggleEditing,
        view,
        writeEmployeeField,
    ]);
    const bridge = useMemo(() => createScheduleMaintenanceBridge(() => bridgeContext), [bridgeContext]);
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
                initialValues={{date: toDayjs(query.date)}}
                onFinish={(values) => {
                    const date = formatDate(values.date);
                    if (date) void applyQuery({date});
                }}
            >
                <Form.Item name="date" label="日期" rules={[{required: true}]}>
                    <DatePicker allowClear={false}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>} loading={loading}>
                        查询
                    </Button>
                </Form.Item>
            </Form>
            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                padding: 5,
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: 8,
                overflow: 'hidden',
            }}>
                <Splitter style={{flex: 1, minHeight: 0, height: 'auto'}}>
                    <Splitter.Panel
                        className="splitter-pane-body"
                        min={320}
                        style={{overflow: 'hidden', paddingRight: 5}}
                    >
                        <FilterTable
                            ref={tableRef}
                            columns={SCHEDULE_COLUMNS}
                            records={rows as unknown as Array<Record<string, unknown>>}
                            rowKey="ID"
                            loading={loading}
                            emptyTip="没有任何记录"
                            editableFields={editableFields}
                            onCellValueChange={handleCellValueChange}
                            onSelectedChange={handleSelectedChange}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel
                        className="splitter-pane-body"
                        min={240}
                        defaultSize="30%"
                        style={{overflow: 'hidden', paddingLeft: 5}}
                    >
                        <MachineTiles rows={machineRows} loading={loading}/>
                    </Splitter.Panel>
                </Splitter>
            </div>
        </div>
    );
};

export default ScheduleMaintenancePage;
