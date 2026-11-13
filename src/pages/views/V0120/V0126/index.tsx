import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Input} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import type {MisProduceDataRow} from '@/api';
import {ErrorMessage} from '@/api/request';
import {CommandBar} from '@/components/CommandBar';
import {FilterTable, type FilterTableApi, type GridTableCellStyleHook} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {misProductionService} from '@/services/mis';
import {useAuth} from '@/store/auth-context';
import {formatDate, now, toDayjs} from '@/utils';
import {createProduceDataBridge, type ProduceDataBridgeContext, type ProduceDataQuery} from './bridged';
import {createProduceDataColumns} from './columns';
import {useProduceDataCommands, type ProduceDataCommandContext} from './command';
import {QtyChangeModal} from './models/qtyChange';

const VN_ORG_ID = '0001E610000000KWHO9D';

type SearchValues = {
    dateRange: [Dayjs, Dayjs];
    machCode?: string;
};

const ProduceDataPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const {userInfo} = useAuth();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [rows, setRows] = useState<MisProduceDataRow[]>([]);
    const [activeRow, setActiveRow] = useState<MisProduceDataRow | null>(null);
    const [loading, setLoading] = useState(false);
    const [qtyModalOpen, setQtyModalOpen] = useState(false);
    const [query, setQuery] = useState<ProduceDataQuery>(() => ({
        startDate: formatDate(now().add(-1, 'day')),
        endDate: formatDate(now()),
        machCode: '',
    }));
    const initialRange = useMemo<[Dayjs, Dayjs]>(() => [now().add(-1, 'day'), now()], []);
    const isVietnam = userInfo?.OrgID === VN_ORG_ID;
    const columns = useMemo(() => createProduceDataColumns(isVietnam), [isVietnam]);
    const pendingQueryRef = useRef<(() => void) | null>(null);

    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const machCode = Number(query.machCode);
            const result = await misProductionService.appletsData({
                StartTime: `${query.startDate} 06:00:00`,
                EndTime: `${query.endDate} 06:00:00`,
                ...(Number.isInteger(machCode) && machCode > 0 ? {MachCode: machCode} : {}),
            }, isVietnam);
            setRows(result);
            setActiveRow(null);
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
            settleQuery();
        }
    }, [isVietnam, message, query, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const applyQuery = useCallback((next: ProduceDataQuery): Promise<void> =>
        new Promise((resolve) => {
            pendingQueryRef.current = resolve;
            // 回写查询条：桥改的是 state，Form 的 store 不知道（不回写用户一按「查询」就把改动覆盖回去）
            form.setFieldsValue({
                dateRange: [toDayjs(next.startDate)!, toDayjs(next.endDate)!],
                machCode: next.machCode,
            });
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

    const clearDeletedRow = useCallback((id: string) => {
        setRows((previous) => previous.map((row) => row.ID === id ? {
            ...row,
            Barcode: '',
            CheckDown: false,
            CheckEmployee: '',
            CheckEmployeeNo: '',
            Color: '',
            DateShiftEnd: '',
            DispatchNo: '',
            Employee: '',
            EmployeeName: '',
            Flag: 0,
            InputTime: '',
            OrderCode: '',
            ProductName: '',
            ProductNo: '',
            Qty: 0,
            Size: '',
            StyleCode: '',
            YarnColor: '',
            CheckDownTime: null,
            CheckQty: 0,
            Status: isVietnam ? '未扫描' : '',
        } : row));
        setActiveRow(null);
    }, [isVietnam]);

    const commandContext = useMemo<ProduceDataCommandContext>(() => ({
        message,
        modal,
        tableRef,
        activeRow,
        isVietnam,
        openQtyChange: () => setQtyModalOpen(true),
        clearDeletedRow,
    }), [message, modal, activeRow, isVietnam, clearDeletedRow]);
    const allCommands = useProduceDataCommands(commandContext);
    const commands = useMemo(
        () => allCommands.filter(() => isVietnam),
        [allCommands, isVietnam],
    );

    const bridgeContext = useMemo<ProduceDataBridgeContext>(() => ({
        view,
        query,
        columns,
        commands,
        activeRow,
        applyQuery,
        readTable: () => tableRef.current,
    }), [view, query, columns, commands, activeRow, applyQuery]);
    const bridge = useMemo(() => createProduceDataBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    const cellStyle: GridTableCellStyleHook = useCallback(({field, record}) => {
        if (field !== 'Status' || !record) return undefined;
        const row = record as MisProduceDataRow;
        if (!row.DispatchNo) return {textColor: '#cf1322'};
        if (row.Flag === 1) return {textColor: '#389e0d'};
        return undefined;
    }, []);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <CommandBar view={view} items={commands}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                style={{marginTop: 12}}
                initialValues={{dateRange: initialRange}}
                onFinish={(values) => {
                    const [start, end] = values.dateRange;
                    setQuery({
                        startDate: formatDate(start),
                        endDate: formatDate(end),
                        machCode: values.machCode?.trim() ?? '',
                    });
                }}
            >
                <Form.Item name="dateRange" label="日期" rules={[{required: true}]}>
                    <DatePicker.RangePicker allowClear={false}/>
                </Form.Item>
                <Form.Item name="machCode" label="机台">
                    <Input allowClear style={{width: 100}}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>查询</Button>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={columns}
                records={rows}
                rowKey="ID"
                loading={loading}
                emptyTip="没有任何记录"
                exportName="挡车扫描"
                cellStyle={cellStyle}
                onSelectedChange={(info) => setActiveRow((info.record as MisProduceDataRow | undefined) ?? null)}
            />
            <QtyChangeModal
                open={qtyModalOpen}
                view={view}
                row={activeRow}
                onClose={() => setQtyModalOpen(false)}
                onSaved={(qty) => {
                    if (!activeRow) return;
                    setRows((previous) => previous.map((row) => row.ID === activeRow.ID ? {...row, Qty: qty} : row));
                    setActiveRow((previous) => previous ? {...previous, Qty: qty} : previous);
                }}
            />
        </div>
    );
};

export default ProduceDataPage;
