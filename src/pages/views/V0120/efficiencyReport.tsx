import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Empty, Form, Spin} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import type {SimpleDataTable} from '@/api';
import {ErrorMessage} from '@/api/request';
import {type AppColumnDef, FilterTable, type FilterTableApi} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import type {UIBridgeHost} from '@/pages/agent/ui-bridge';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {DataTable} from '@/services/sql';
import {formatDate, now} from '@/utils';
import type {EfficiencyBridgeContext, EfficiencyQuery} from './efficiencyBridge';

export type EfficiencyReportDefinition = {
    title: string;
    exportName: string;
    loadReport: (startDate: string, endDate: string) => Promise<SimpleDataTable>;
    createBridge: (read: () => EfficiencyBridgeContext) => UIBridgeHost;
};

export function EfficiencyReportPage({
                                         view,
                                         trail,
                                         title,
                                         exportName,
                                         loadReport,
                                         createBridge,
                                     }: ViewPageProps & EfficiencyReportDefinition): React.ReactElement {
    const {message} = App.useApp();
    const [form] = Form.useForm<{ dateRange: [Dayjs, Dayjs] }>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [columns, setColumns] = useState<AppColumnDef[]>([]);
    const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState<EfficiencyQuery>(() => {
        const start = now().add(-1, 'day');
        const end = now();
        return {startDate: formatDate(start), endDate: formatDate(end)};
    });
    const initialRange = useMemo<[Dayjs, Dayjs]>(
        () => [now().add(-1, 'day'), now()],
        [],
    );
    const pendingQueryRef = useRef<(() => void) | null>(null);

    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await loadReport(query.startDate, query.endDate);
            const dataTable = new DataTable(data, {
                width: 100,
                filterable: true,
                summarizeNumeric: true,
                rowKeyField: '_rowKey',
            });
            setColumns(dataTable.columns);
            setRecords(dataTable.datas);
        } catch (error) {
            void message.error(ErrorMessage(error, '查询失败'));
        } finally {
            setLoading(false);
            settleQuery();
        }
    }, [loadReport, message, query, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const applyQuery = useCallback((next: EfficiencyQuery): Promise<void> =>
        new Promise((resolve) => {
            pendingQueryRef.current = resolve;
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), []);

    const bridgeContext = useMemo<EfficiencyBridgeContext>(() => ({
        view,
        title,
        query,
        columns,
        applyQuery,
        readTable: () => tableRef.current,
    }), [view, title, query, columns, applyQuery]);
    const bridge = useMemo(() => createBridge(() => bridgeContext), [bridgeContext, createBridge]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                initialValues={{dateRange: initialRange}}
                onFinish={(values) => {
                    const [start, end] = values.dateRange;
                    setQuery({
                        startDate: formatDate(start),
                        endDate: formatDate(end),
                    });
                }}
            >
                <Form.Item name="dateRange" label="日期" rules={[{required: true}]}>
                    <DatePicker.RangePicker allowClear={false}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>查询</Button>
                </Form.Item>
            </Form>
            {columns.length === 0 ? (
                <div style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #f0f0f0',
                    borderRadius: 6,
                    background: '#fff',
                }}>
                    {loading ? (
                        <Spin description="数据加载中…">
                            <div style={{width: 220, height: 120}}/>
                        </Spin>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有任何记录"/>
                    )}
                </div>
            ) : (
                <FilterTable
                    ref={tableRef}
                    columns={columns}
                    records={records}
                    rowKey="_rowKey"
                    loading={loading}
                    emptyTip="没有任何记录"
                    exportName={exportName}
                />
            )}
        </div>
    );
}
