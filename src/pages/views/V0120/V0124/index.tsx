import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Input} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import {type SalaryDetail, misScheduleApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {formatDate, now, toDayjs} from '@/utils';
import {createSalaryDetailBridge, type SalaryDetailBridgeContext, type SalaryDetailQuery} from './bridged';
import {SALARY_DETAIL_COLUMNS} from './columns';
import {OrderCodeSelect} from '@/components/quick-select';

type SearchValues = {
    dateRange: [Dayjs, Dayjs];
    orderCode?: string;
    machineCode?: string;
};

const SalaryDetailPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [rows, setRows] = useState<SalaryDetail[]>([]);
    const [query, setQuery] = useState<SalaryDetailQuery | null>(null);
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
            const result = await misScheduleApi.salary({
                StartDate: query.startDate,
                EndDate: query.endDate,
                OrderCode: query.orderCode,
                MachineCode: query.machineCode,
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

    const applyQuery = useCallback((next: SalaryDetailQuery): Promise<void> =>
        new Promise((resolve) => {
            pendingQueryRef.current = resolve;
            /*
             * 必须回写查询条：桥改的是页面 state，Form 的 store 不知道。
             * 不回写的话列表已按新条件刷新，控件还显示旧值 —— 用户随后点一次「查询」，
             * 就会按旧值把 agent 刚改的条件覆盖回去。
             */
            form.setFieldsValue({
                dateRange: [toDayjs(next.startDate)!, toDayjs(next.endDate)!],
                orderCode: next.orderCode,
                machineCode: next.machineCode,
            });
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

    const bridgeContext = useMemo<SalaryDetailBridgeContext>(() => ({
        view,
        query,
        applyQuery,
        readTable: () => tableRef.current,
    }), [view, query, applyQuery]);
    const bridge = useMemo(() => createSalaryDetailBridge(() => bridgeContext), [bridgeContext]);
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
                        machineCode: values.machineCode?.trim() ?? '',
                    });
                }}
            >
                <Form.Item name="dateRange" label="日期" rules={[{required: true}]}>
                    <DatePicker.RangePicker allowClear={false}/>
                </Form.Item>
                <Form.Item name="orderCode" label="订单号">
                    <OrderCodeSelect style={{width: 130}}/>
                </Form.Item>
                <Form.Item name="machineCode" label="机台号">
                    <Input allowClear style={{width: 100}}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>查询</Button>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={SALARY_DETAIL_COLUMNS}
                records={rows}
                rowKey="ID"
                loading={loading}
                emptyTip="没有任何记录"
                exportName="工资明细"
            />
        </div>
    );
};

export default SalaryDetailPage;
