import React, {useCallback, useEffect, useMemo, useState} from "react";
import {App, Button, DatePicker, Form, Select, Space} from "antd";
import {SearchOutlined} from "@ant-design/icons";
import {type Dayjs} from "dayjs";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {FilterTable} from "@/components/grid-table";
import type {YupaiOrder, YupaiOrderGroupDateType} from "@/api";
import {yupaiService} from "@/services/yupai.ts";
import {ErrorMessage} from "@/api/request.ts";
import {formatDate, now} from "@/utils";
import {PRESCHEDULE_COLUMNS} from "./columns.ts";

/**
 * V0189_V0279_V0282 计划管理 > 预排汇总
 *
 * 与旧客户端（`Views/V0189/V0279/V0282.cs`）逐项对应：
 * - 查询区：类型（全部/新增/更新）→ 开始日期 → 结束日期 → 查询
 * - 表格：默认按「出货月份」分组、组行显示 17 个机型尺码的合计
 * - 导出：旧客户端命令条上的 `exportBtn`（`ExportToExecl("预排汇总")`）→ 表格的 `exportName`
 *
 * 旧客户端的命令条有三样东西，**一样都没有搬成命令**：
 * 1. 「刷新」不迁 —— 查询按钮本身就是按当前条件重查；
 * 2. 「导出」交给 `FilterTable`，它自带导出按钮（文件名 = 前缀 + 当天日期）；
 * 3. 「查询」在页面的查询表单里。
 * 于是这一页**不需要 `command/`，也不渲染 `CommandBar`**。
 *
 * 另外两处**有意不照搬**：
 * - 旧客户端限制 `OrgID == BJ` 才能用（`CheckPower`）—— 新系统由菜单权限决定可见性；
 * - 第 18 个机型列（`MCSize18`，设计器里隐藏且标「无效」）不再显示，也不参与合计。
 */

/** 类型的三个取值：与旧客户端 `YupaiOrderGroupDateType` 一致 */
const DATE_TYPE_OPTIONS: Array<{ value: YupaiOrderGroupDateType; label: string }> = [
    {value: 0, label: '全部'},
    {value: 1, label: '新增'},
    {value: 2, label: '更新'},
];

/** 选「全部」时的日期口径（旧客户端固定「昨天 ~ 今天」，且禁用日期控件） */
function defaultDateRange(): [Dayjs, Dayjs] {
    const end = now();
    return [end.add(-1, 'day'), end];
}

interface SearchValues {
    dateType?: YupaiOrderGroupDateType;
    dateRange?: [Dayjs, Dayjs];
}

interface Query {
    startDate: string;
    endDate: string;
    dateType: YupaiOrderGroupDateType;
}

const PrescheduleSummaryPage: React.FC<ViewPageProps> = ({trail}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();

    const [orders, setOrders] = useState<YupaiOrder[]>([]);
    const [loading, setLoading] = useState(false);

    const [range] = useState<[Dayjs, Dayjs]>(defaultDateRange);
    const [query, setQuery] = useState<Query>(() => ({
        startDate: formatDate(range[0]),
        endDate: formatDate(range[1]),
        dateType: 0,
    }));

    /** 选「全部」时日期不参与筛选（旧客户端把两个 DateEdit 置灰），控件跟着禁用 */
    const dateType = Form.useWatch('dateType', form) ?? 0;

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            setOrders(await yupaiService.groupQuery(query.startDate, query.endDate, query.dateType));
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
        }
    }, [message, query]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    /** 表单初值只在挂载时给一次（与数据加载分开，否则每次查询都把用户选的条件冲掉） */
    useEffect(() => {
        form.setFieldsValue({dateType: 0, dateRange: range});
    }, [form, range]);

    /**
     * 「下单月份」是**界面派生列**：旧客户端用 `UnboundExpression`
     * `Concat(GetYear([QRDate]),'-',PadLeft(GetMonth([QRDate]),2,'0'))` 算出来，后端没有这个字段。
     * 确认下单期为空就是空串 —— 别拿 `0001-01` 之类占位值当月份。
     */
    const records = useMemo(
        () => orders.map((order) => ({
            ...order,
            XDMonth: order.QRDate ? order.QRDate.format('YYYY-MM') : '',
        })),
        [orders],
    );

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                onFinish={(values: SearchValues) => {
                    const [start, end] = values.dateRange ?? range;
                    setQuery({
                        startDate: formatDate(start),
                        endDate: formatDate(end),
                        dateType: values.dateType ?? 0,
                    });
                }}
            >
                <Form.Item name="dateType" label="类型">
                    <Select style={{width: 100}} options={DATE_TYPE_OPTIONS}/>
                </Form.Item>
                <Form.Item name="dateRange" label="日期">
                    {/* 与旧客户端同义：选「全部」时日期不参与筛选，控件禁用但值照传 */}
                    <DatePicker.RangePicker allowClear={false} disabled={dateType === 0}/>
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            查询
                        </Button>
                    </Space>
                </Form.Item>
            </Form>
            {/*
              不要在外面套 .grid-table-host：FilterTable 根节点是 flex:1 1 0，
              必须是 .page-container（flex 列）的直接子项才能拿到剩余高度，否则画布高度塌成 0。

              `exportName` 就是旧客户端的「导出」按钮：传了它表格自己出导出按钮，
              文件名 = 前缀 + 当天日期，不需要再写一条导出命令。
            */}
            <FilterTable
                columns={PRESCHEDULE_COLUMNS}
                records={records as unknown as Array<Record<string, unknown>>}
                rowKey="ID"
                loading={loading}
                exportName="预排汇总"
                groupable
            />
        </div>
    );
};

export default PrescheduleSummaryPage;
