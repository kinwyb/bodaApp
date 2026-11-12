import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import {misScheduleApi, type SalaryPiecesCountGroup} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {formatDate, now} from '@/utils';
import {createSalaryGroupBridge, type SalaryGroupBridgeContext, type SalaryGroupQuery} from './bridged';
import {SALARY_GROUP_COLUMNS} from './columns';
import {OrderCodeSelect} from '@/components/quick-select';

type SearchValues = {
    dateRange: [Dayjs, Dayjs];
    orderCode?: string;
};

const SalaryGroupPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [rows, setRows] = useState<SalaryPiecesCountGroup[]>([]);
    const [query, setQuery] = useState<SalaryGroupQuery | null>(null);
    const [loading, setLoading] = useState(false);
    const pendingQueryRef = useRef<(() => void) | null>(null);
    const initialRange = useMemo<[Dayjs, Dayjs]>(() => [now().add(-1, 'day'), now()], []);

    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        if (!query) return;
        setLoading(true);
        try {
            const result = await misScheduleApi.piecesCountGroup({
                DateShiftStart: query.startDate,
                DateShiftEnd: query.endDate,
                OrderCode: query.orderCode,
            });
            setRows(result.data ?? []);
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

    const applyQuery = useCallback((next: SalaryGroupQuery): Promise<void> =>
        new Promise((resolve) => {
            pendingQueryRef.current = resolve;
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), []);

    const bridgeContext = useMemo<SalaryGroupBridgeContext>(() => ({
        view,
        query,
        applyQuery,
        readTable: () => tableRef.current,
    }), [view, query, applyQuery]);
    const bridge = useMemo(() => createSalaryGroupBridge(() => bridgeContext), [bridgeContext]);
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
                        orderCode: values.orderCode?.trim() ?? '',
                    });
                }}
            >
                <Form.Item name="dateRange" label="日期" rules={[{required: true}]}>
                    <DatePicker.RangePicker allowClear={false}/>
                </Form.Item>
                <Form.Item name="orderCode" label="订单号">
                    <OrderCodeSelect style={{width: 130}}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>查询</Button>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={SALARY_GROUP_COLUMNS}
                records={rows}
                rowKey="OpeCode"
                loading={loading}
                emptyTip="没有任何记录"
                exportName="工资汇总"
            />
        </div>
    );
};

export default SalaryGroupPage;
