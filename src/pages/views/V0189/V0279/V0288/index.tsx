import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Select, Space} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import type {YupaiOrder, YupaiOrderCompleteDateType} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable, type FilterModel, type FilterTableApi} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {yupaiService} from '@/services/yupai';
import {DATE_FORMAT, now, toDayjs, toStringOrEmpty} from '@/utils';
import {
    createYupaiCompletedBridge,
    type YupaiCompletedBridgeContext,
    type YupaiCompletedQuery,
} from './bridged';
import {YUPAI_COMPLETED_COLUMNS} from './columns';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0189_V0279_V0288");


const DATE_TYPE_OPTIONS: Array<{value: YupaiOrderCompleteDateType; label: string}> = [
    {value: 1, label: '下单日期'},
    {value: 2, label: '走货日期'},
];

type SearchValues = {
    dateType: YupaiOrderCompleteDateType;
    startDate: Dayjs;
    endDate: Dayjs;
};

/**
 * V0189_V0279_V0288 计划管理 > 预订单 > 已下单列表
 *
 * 旧页面只有查询、刷新、导出：
 * - 刷新不迁，查询按钮会重新请求；
 * - 导出交给 FilterTable 的 exportName；
 * - 因此没有 command/，也不渲染 CommandBar。
 */
const YupaiCompletedPage: React.FC<ViewPageProps> = ({view, trail, params}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [orders, setOrders] = useState<YupaiOrder[]>([]);
    const [loading, setLoading] = useState(false);
    /** `query.set` 等这次查询真正落地再回执 */
    const requestIDRef = useRef(0);
    const pendingLoadRef = useRef<{id: number; resolve: (ok: boolean) => void} | null>(null);

    const currentYear = now().year();
    const [defaultRange] = useState<[Dayjs, Dayjs]>(() => [
        now().year(currentYear).month(0).date(1).startOf('day'),
        now().year(currentYear).month(11).date(31).startOf('day'),
    ]);

    const [query, setQuery] = useState<YupaiCompletedQuery>(() => ({
        startDate: defaultRange[0].format(DATE_FORMAT),
        endDate: defaultRange[1].format(DATE_FORMAT),
        // 旧窗体 Load 时 `SelectedIndex = 1`，即默认按走货日期查询。
        dateType: 2,
    }));

    /**
     * 从生产计划等页面跳转进来时会带 orderCode，对应旧客户端 `ShowNotification`：
     * 它把订单号填进订单号列的自动筛选，而不是改查询日期。
     */
    const initialOrderCode = toStringOrEmpty(params?.orderCode);
    const initialFilters: FilterModel = {};
    if (initialOrderCode) initialFilters.OrderCode = {values: [initialOrderCode]};
    const [filters, setFilters] = useState<FilterModel>(initialFilters);

    const loadData = useCallback(async () => {
        const requestID = ++requestIDRef.current;
        setLoading(true);
        let ok = true;
        try {
            setOrders(await yupaiService.completeList({
                StartDate: query.startDate,
                EndDate: query.endDate,
                DateType: query.dateType,
            }));
        } catch (error) {
            ok = false;
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
            if (pendingLoadRef.current?.id === requestID) {
                pendingLoadRef.current.resolve(ok);
                pendingLoadRef.current = null;
            }
        }
    }, [message, query]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    /** 旧客户端按出货月份升序分组，并默认收起所有组 */
    const records = useMemo(
        () => [...orders].sort((left, right) => left.YPMonth.localeCompare(right.YPMonth)),
        [orders],
    );

    /**
     * 界面桥改查询条件：同步表单显示，落 state，并等 useEffect 驱动的请求完成。
     * 页面只保留这一条查询路径，避免桥和查询按钮各发一套请求。
     */
    const applyQuery = useCallback((next: YupaiCompletedQuery): Promise<boolean> => {
        form.setFieldsValue({
            dateType: next.dateType,
            startDate: toDayjs(next.startDate),
            endDate: toDayjs(next.endDate),
        });

        pendingLoadRef.current?.resolve(false);
        return new Promise<boolean>((resolve) => {
            pendingLoadRef.current = {
                id: requestIDRef.current + 1,
                resolve,
            };
            setQuery(next);
        });
    }, [form]);

    const readTable = useCallback(() => tableRef.current, []);
    const bridgeContext = useMemo<YupaiCompletedBridgeContext>(() => ({
        view,
        query,
        applyQuery,
        readTable,
    }), [applyQuery, query, readTable, view]);
    const bridge = useMemo(() => createYupaiCompletedBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form<SearchValues>
                className="page-search"
                form={form}
                layout="inline"
                initialValues={{
                    dateType: 2,
                    startDate: defaultRange[0],
                    endDate: defaultRange[1],
                }}
                onFinish={(values) => {
                    setQuery({
                        startDate: values.startDate.format(DATE_FORMAT),
                        endDate: values.endDate.format(DATE_FORMAT),
                        dateType: values.dateType,
                    });
                }}
            >
                <Form.Item name="dateType" label={t("日期类型")}>
                    <Select style={{width: 110}} options={DATE_TYPE_OPTIONS}/>
                </Form.Item>
                <Form.Item name="startDate" label={t("开始日期")}>
                    <DatePicker allowClear={false}/>
                </Form.Item>
                <Form.Item name="endDate" label={t("结束日期")}>
                    <DatePicker allowClear={false}/>
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            {t("查询")}</Button>
                    </Space>
                </Form.Item>
            </Form>
            <FilterTable
                ref={tableRef}
                columns={YUPAI_COMPLETED_COLUMNS}
                records={records}
                rowKey="ID"
                loading={loading}
                emptyTip={loading ? '加载中…' : '没有任何记录'}
                exportName={t("预订单已下单")}
                groupable
                filters={filters}
                onFilterChange={setFilters}
            />
        </div>
    );
};

export default YupaiCompletedPage;
