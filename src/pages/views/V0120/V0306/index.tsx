import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Splitter} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import {
    misProductionApi,
    type MisAppletsQRCodeData,
    type MisProductOutStoreBill,
} from '@/api';
import {ErrorMessage} from '@/api/request';
import {CommandBar} from '@/components/CommandBar';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {formatDate, now} from '@/utils';
import {createOutStoreBridge, type OutStoreBridgeContext, type OutStoreQuery} from './bridged';
import {OUT_STORE_BILL_COLUMNS, OUT_STORE_DETAIL_COLUMNS} from './columns';
import {useOutStoreCommands, type OutStoreCommandContext} from './command';
import {KnitOutStoreAdd} from './models/knitOutStoreAdd';

const OutStoreBillPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const [form] = Form.useForm<{dateRange: [Dayjs, Dayjs]}>();
    const billTableRef = useRef<FilterTableApi | null>(null);
    const detailTableRef = useRef<FilterTableApi | null>(null);
    const [bills, setBills] = useState<MisProductOutStoreBill[]>([]);
    const [details, setDetails] = useState<MisAppletsQRCodeData[]>([]);
    const [selected, setSelected] = useState<MisProductOutStoreBill | null>(null);
    const [loading, setLoading] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [query, setQuery] = useState<OutStoreQuery | null>(null);
    const pendingQueryRef = useRef<(() => void) | null>(null);
    const initialRange = useMemo<[Dayjs, Dayjs]>(() => [now(), now().add(1, 'day')], []);

    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        if (!query) return;
        setLoading(true);
        try {
            const result = await misProductionApi.productOutStoreBillList({
                StartDate: query.startDate,
                EndDate: query.endDate,
            });
            setBills(result.data ?? []);
            setDetails([]);
            setSelected(null);
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

    const applyQuery = useCallback((next: OutStoreQuery): Promise<void> =>
        new Promise((resolve) => {
            pendingQueryRef.current = resolve;
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), []);

    const commandContext = useMemo<OutStoreCommandContext>(() => ({
        message,
        modal,
        tableRef: billTableRef,
        billTableRef,
        selected,
        reload: loadData,
        openAdd: () => setAddOpen(true),
    }), [message, modal, selected, loadData]);
    const commands = useOutStoreCommands(commandContext);

    const bridgeContext = useMemo<OutStoreBridgeContext>(() => ({
        view,
        query: query ?? {startDate: '', endDate: ''},
        applyQuery,
        commands,
        selected,
        readBillTable: () => billTableRef.current,
        readDetailTable: () => detailTableRef.current,
    }), [view, query, applyQuery, commands, selected]);
    const bridge = useMemo(() => createOutStoreBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    const handleAddSaved = useCallback(() => {
        const [start, end] = form.getFieldValue('dateRange') ?? initialRange;
        setQuery({startDate: formatDate(start), endDate: formatDate(end)});
    }, [form, initialRange]);

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
                    setQuery({startDate: formatDate(start), endDate: formatDate(end)});
                }}
            >
                <Form.Item name="dateRange" label="日期" rules={[{required: true}]}>
                    <DatePicker.RangePicker allowClear={false}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>查询</Button>
                </Form.Item>
            </Form>
            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                padding: 5,
                border: '1px solid rgba(0,0,0,.1)',
                borderRadius: 8,
                overflow: 'hidden',
            }}>
                <Splitter vertical style={{flex: 1, minHeight: 0, height: 'auto'}}>
                    <Splitter.Panel className="splitter-pane-body" style={{overflow: 'hidden'}}>
                        <FilterTable
                            ref={billTableRef}
                            columns={OUT_STORE_BILL_COLUMNS}
                            records={bills}
                            rowKey="BillID"
                            loading={loading}
                            emptyTip="没有任何记录"
                            exportName="白坯出库单"
                            onSelectedChange={(info) => {
                                const bill = (info.record as MisProductOutStoreBill | undefined) ?? null;
                                setSelected(bill);
                                setDetails(bill?.Details ?? []);
                            }}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel className="splitter-pane-body" style={{overflow: 'hidden'}}>
                        <FilterTable
                            ref={detailTableRef}
                            columns={OUT_STORE_DETAIL_COLUMNS}
                            records={details}
                            rowKey="QRCode"
                            loading={loading}
                            emptyTip="没有任何记录"
                        />
                    </Splitter.Panel>
                </Splitter>
            </div>
            <KnitOutStoreAdd
                open={addOpen}
                view={view}
                onClose={() => setAddOpen(false)}
                onSaved={handleAddSaved}
            />
        </div>
    );
};

export default OutStoreBillPage;
