import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {App, Button, DatePicker, Form, Input, Select, Space} from "antd";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {ReloadOutlined, SearchOutlined} from "@ant-design/icons";
import {
    FilterTable,
    type FilterTableApi,
    type GridTableCellStyle,
    type GridTableCellStyleInfo,
    type MergeGroupConfig
} from "@/components/grid-table";
import {type Dayjs} from "dayjs";
import type {YupaiOrderChangeAction, YupaiOrderChangeDetail} from "@/api/modules/yupai.ts";
import {yupaiService} from "@/services/yupai.ts";
import {ErrorMessage} from "@/api/request.ts";
import {DATE_FORMAT, formatDate, now} from "@/utils";
import {buildYupaiOrderChangeListColumns} from "@/pages/views/V0189/V0279/V0281/columns.ts";
import {usePageTitle, useTabTitle} from "@/store/tab-title-context";

interface SearchValues {
    orderCode?: string;
    dateRange?: [Dayjs, Dayjs];
}

const actionMap: Record<YupaiOrderChangeAction, { color: string; label: string }> = {
    0: {color: '#FF20B2AA', label: '新增'},
    1: {color: '#FFEEE8AA', label: '更新'},
    2: {color: '#FFDB7093', label: '删除'},
    3: {color: '#FF7FFFD4', label: '恢复'},
    4: {color: '#FF000000', label: '下生产单'},
};

const mergeColumnGroup: MergeGroupConfig = {
    mergeColumnSort: ["ChangeDate", "OrderCode", "WorkPlace", "StyleCode", "ProductName", "Number", "QRDate", "ZHDate", "ActionName"],
    topMergeColumn: ["ChangeDate", "OrderCode"]
} as const;

const actionOptions = Object.entries(actionMap).map(([value, {label}]) => ({value, label}));

const YupaiOrderChangePage: React.FC<ViewPageProps> = ({trail, params}) => {

    const startDate = now().add(-7, "day");
    const endDate = now();

    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const [dataSource, setDataSource] = useState<YupaiOrderChangeDetail[]>([]);
    const [loading, setLoading] = useState(false);
    /**
     * 初始订单号：页面是被「带着订单号」打开的（openView 传了 orderCode 参数）时用它。
     * 页面自己搜索时以查询条件为准，所以初值只取 params。
     */
    const initialOrderCode = typeof params?.orderCode === 'string' ? params.orderCode : '';
    /**
     * 默认时间范围：**带订单号打开时不限时间**（要看的是这一单的全部变更，
     * 套上「最近 7 天」会把更早的变更漏掉）；从左侧菜单进来才默认最近 7 天。
     */
    const defaultDateRange: [Dayjs, Dayjs] | undefined = initialOrderCode ? undefined : [startDate, endDate];
    const [query, setQuery] = useState<{
        orderCode?: string,
        startDate?: string,
        endDate?: string
    }>({
        orderCode: initialOrderCode,
        startDate: defaultDateRange ? formatDate(defaultDateRange[0]) : undefined,
        endDate: defaultDateRange ? formatDate(defaultDateRange[1]) : undefined,
    });
    const tableRef = useRef<FilterTableApi | null>(null);

    /**
     * 页签标题跟着订单号走：看哪一单，页签上就显示哪一单。
     * 订单号为空（菜单直接进来 / 清了搜索）时恢复成菜单名。
     */
    const {baseLabel} = useTabTitle();
    usePageTitle(query.orderCode ? `${baseLabel} · ${query.orderCode}` : undefined);

    const loadData = useCallback(
        async () => {
            setLoading(true);
            try {
                const res = await yupaiService.changeList(query.orderCode, query.startDate, query.endDate);
                setDataSource(res.data ?? []);
            } catch (error) {
                void message.error(ErrorMessage(error, '加载数据失败'));
            } finally {
                setLoading(false);
            }
        },
        [message, query],
    );

    const columns = useMemo(() => buildYupaiOrderChangeListColumns(), []);

    const cellStyle = useCallback((info: GridTableCellStyleInfo) => {
        if (info.isSummaryRow || !info.record || info.field != 'ActionName') return undefined;
        let styles: GridTableCellStyle = {}
        const actionOptions = actionMap[info.record.ActionCode as YupaiOrderChangeAction];
        styles.backgroundColor = actionOptions.color;
        return styles
    }, [dataSource, columns])

    useEffect(() => {
        void loadData();
    }, [loadData, query]);

    useEffect(() => {
        // 带着订单号打开时，搜索框要回填 —— 否则「框里是空的、列表却只有这一单」看着像 bug
        if (initialOrderCode) form.setFieldValue("orderCode", initialOrderCode);
        // 时间范围：带订单号打开时**不设默认值**（不限时间），菜单进来才给最近 7 天
        form.setFieldValue("dateRange", defaultDateRange);
    }, []);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                style={{marginTop: 20}}
                onFinish={(values: SearchValues) => {
                    setQuery({
                        orderCode: values?.orderCode,
                        startDate: values.dateRange?.[0]?.format(DATE_FORMAT),
                        endDate: values.dateRange?.[1]?.format(DATE_FORMAT),
                    });
                }}
            >
                <Form.Item name="status" hidden={true}>
                    <Select placeholder="状态" allowClear style={{width: 120}} options={actionOptions}/>
                </Form.Item>
                <Form.Item name="dateRange">
                    <DatePicker.RangePicker/>
                </Form.Item>
                <Form.Item name="orderCode">
                    <Input placeholder="订单号" allowClear/>
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            搜索
                        </Button>
                        <Button
                            icon={<ReloadOutlined/>}
                            onClick={() => {
                                // 重置 = 回到「打开这个页面时的状态」：
                                // 菜单进来 → 订单号空、日期最近 7 天；
                                // 带订单号打开 → 订单号保留、不限时间
                                form.resetFields();
                                form.setFieldValue("dateRange", defaultDateRange);
                                if (initialOrderCode) form.setFieldValue("orderCode", initialOrderCode);
                                setQuery({
                                    orderCode: initialOrderCode || undefined,
                                    startDate: defaultDateRange ? formatDate(defaultDateRange[0]) : undefined,
                                    endDate: defaultDateRange ? formatDate(defaultDateRange[1]) : undefined,
                                })
                            }}
                        >
                            重置
                        </Button>
                    </Space>
                </Form.Item>
            </Form>

            {/*
              不要在外面再包一层 .grid-table-host：FilterTable 自身根节点是 .filter-table（flex:1 1 0），
              必须作为 .page-container（flex 列）的直接子项才能拿到剩余高度。
              外面套一个 .grid-table-host（它只是 flex item，不是 flex 容器），.filter-table 的高度就变成 auto，
              里面那层 .grid-table-host（flex-basis:0）会塌成 0 高 —— 画布高度 0，表现为整块空白。
            */}
            <FilterTable ref={tableRef} columns={columns} records={dataSource} loading={loading}
                         rowKey={'YupaiOrderChangeID'} exportName={'预订单变更记录'}
                         cellStyle={cellStyle} mergeGroups={mergeColumnGroup}/>

        </div>
    );
};

export default YupaiOrderChangePage;
