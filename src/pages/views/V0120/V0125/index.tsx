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
import {formatDate, now, toDayjs} from '@/utils';
import {createSalaryGroupBridge, type SalaryGroupBridgeContext, type SalaryGroupQuery} from './bridged';
import {SALARY_GROUP_COLUMNS} from './columns';
import {OrderCodeSelect} from '@/components/quick-select';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0125");


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
            // 回写查询条：桥改的是 state，Form 的 store 不知道（不回写用户一按「查询」就把改动覆盖回去）
            form.setFieldsValue({
                dateRange: [toDayjs(next.startDate)!, toDayjs(next.endDate)!],
                orderCode: next.orderCode,
            });
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

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
                <Form.Item name="dateRange" label={t("日期")} rules={[{required: true}]}>
                    <DatePicker.RangePicker allowClear={false}/>
                </Form.Item>
                <Form.Item name="orderCode" label={t("订单号")}>
                    <OrderCodeSelect style={{width: 130}}/>
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>{t("查询")}</Button>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={SALARY_GROUP_COLUMNS}
                records={rows}
                rowKey="OpeCode"
                loading={loading}
                emptyTip={t("没有任何记录")}
                exportName={t("工资汇总")}
            />
        </div>
    );
};

export default SalaryGroupPage;
