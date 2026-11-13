import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, Form, Input, Select, Space} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {YupaiOrderCompleteGroup} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {yupaiService} from '@/services/yupai';
import {formatDate, now, toStringOrEmpty} from '@/utils';
import {
    COMPLETE_GROUP_ORG_OPTIONS,
    createYupaiCompleteGroupBridge,
    type YupaiCompleteGroupBridgeContext,
    type YupaiCompleteGroupQuery,
} from './bridged';
import {YUPAI_COMPLETE_GROUP_COLUMNS} from './columns';

type SearchValues = {
    org: string;
    orderCode: string;
};

/**
 * V0189_V0279_V0295 计划管理 > 已下单汇总
 *
 * 旧页面只有查询、刷新、导出；刷新不迁，导出交给 FilterTable。
 * 单表按下单月份分组，不做主从明细布局。
 */
const YupaiCompleteGroupPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [orders, setOrders] = useState<YupaiOrderCompleteGroup[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState<YupaiCompleteGroupQuery>({
        org: '',
        orderCode: '',
    });

    const [range] = useState<[string, string]>(() => [
        formatDate(now().add(-1, 'year')),
        formatDate(now().add(1, 'year')),
    ]);

    /** `query.set` 在等这次请求落地 */
    const pendingQueryRef = useRef<(() => void) | null>(null);
    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const result = await yupaiService.completeGroup({
                StartDate: range[0],
                EndDate: range[1],
                OrderCode: query.orderCode,
            });
            setOrders(result.filter((row) => {
                if (!query.org) return true;
                if (query.org === '~') return row.SubCompany;
                return !row.SubCompany && toStringOrEmpty(row.OrgID) === query.org;
            }));
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
            settleQuery();
        }
    }, [message, query, range, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const applyQuery = useCallback((next: YupaiCompleteGroupQuery): Promise<void> =>
        new Promise<void>((resolve) => {
            pendingQueryRef.current = resolve;
            /*
             * 回写查询条：桥改的是 state，Form 的 store 不知道。
             * 不回写的话组织下拉还停在原值，用户一按「查询」就把 agent 的设置覆盖回去。
             */
            form.setFieldsValue({org: next.org, orderCode: next.orderCode});
            setQuery({...next});
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

    const records = useMemo(
        () => [...orders].sort((left, right) => {
            const month = left.CompleteMonth.localeCompare(right.CompleteMonth);
            return month !== 0 ? month : left.OrderCode.localeCompare(right.OrderCode);
        }),
        [orders],
    );

    const bridgeContext = useMemo<YupaiCompleteGroupBridgeContext>(() => ({
        view,
        query,
        applyQuery,
        readTable: () => tableRef.current,
    }), [applyQuery, query, view]);
    const bridge = useMemo(() => createYupaiCompleteGroupBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    const initialValues: SearchValues = {org: '', orderCode: ''};

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                initialValues={initialValues}
                onFinish={(values) => {
                    setQuery({
                        org: values.org ?? '',
                        orderCode: values.orderCode?.trim() ?? '',
                    });
                }}
            >
                <Form.Item name="org" label="组织">
                    <Select style={{width: 110}} options={[...COMPLETE_GROUP_ORG_OPTIONS]}/>
                </Form.Item>
                <Form.Item name="orderCode" label="订单号">
                    <Input allowClear style={{width: 160}}/>
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            查询
                        </Button>
                    </Space>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={YUPAI_COMPLETE_GROUP_COLUMNS}
                records={records}
                rowKey="OrderCode"
                loading={loading}
                emptyTip={loading ? '加载中…' : '没有任何记录'}
                exportName="已下单汇总"
                groupable
            />
        </div>
    );
};

export default YupaiCompleteGroupPage;
