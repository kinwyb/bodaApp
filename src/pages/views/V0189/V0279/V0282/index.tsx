import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {App, Button, DatePicker, Form, Select, Space} from "antd";
import {SearchOutlined} from "@ant-design/icons";
import {type Dayjs} from "dayjs";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {FilterTable, type FilterTableApi} from "@/components/grid-table";
import type {YupaiOrder, YupaiOrderGroupDateType} from "@/api";
import {yupaiService} from "@/services/yupai.ts";
import {ErrorMessage} from "@/api/request.ts";
import {formatDate, now, toDayjs} from "@/utils";
import {useUIBridgeHost} from "@/pages/agent/ui-bridge";
import {PRESCHEDULE_COLUMNS} from "./columns.ts";
import {createPrescheduleBridge, type PrescheduleBridgeContext, type PrescheduleQuery} from "./bridged";

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0189_V0279_V0282");


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
 * 界面桥声明在 `./bridged.ts`：**那个文件存在就是「本页接入了界面桥」的标记**，
 * 工作台的导航清单靠它判定。本文件只把当前状态与「怎么重查」交出去。
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

const PrescheduleSummaryPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const tableRef = useRef<FilterTableApi | null>(null);

    const [orders, setOrders] = useState<YupaiOrder[]>([]);
    const [loading, setLoading] = useState(false);

    const [range] = useState<[Dayjs, Dayjs]>(defaultDateRange);
    const [query, setQuery] = useState<PrescheduleQuery>(() => ({
        startDate: formatDate(range[0]),
        endDate: formatDate(range[1]),
        dateType: 0,
    }));

    /** 选「全部」时日期不参与筛选（旧客户端把两个 DateEdit 置灰），控件跟着禁用 */
    const dateType = Form.useWatch('dateType', form) ?? 0;

    /**
     * 一次查询的等待者（界面桥的 `query.set` 在等它）。
     *
     * 请求只留 `loadData` 一条路径（由 query 驱动），桥的「改条件」只落 state，再在这里等
     * 请求真的回来 —— 否则回执补丁里的行数还是旧值，模型会以为查询没生效。
     */
    const pendingQueryRef = useRef<(() => void) | null>(null);
    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            setOrders(await yupaiService.groupQuery(query.startDate, query.endDate, query.dateType));
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
            // 失败也要放行，否则等它的那条 ui_act 会一直挂着
            settleQuery();
        }
    }, [message, query, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    /**
     * 按新条件重查（界面桥的 `query.set` 用它）。
     *
     * `{...next}` 换一个新引用是必须的：内容相同时 React 认为没变就不重渲染，
     * `loadData` 不重建、effect 不跑，promise 永远等不到。
     */
    const applyQuery = useCallback((next: PrescheduleQuery): Promise<void> =>
        new Promise<void>((resolve) => {
            pendingQueryRef.current = resolve;
            /*
             * 回写查询条：桥改的是页面 state，Form 的 store 不知道。
             * 不回写的话，用户看到的是「旧条件 + 新数据」，再点一次「查询」还会把条件退回去。
             * 注意 dateType=0（全部）时日期控件是禁用的，但仍要有值 —— 否则 rc-picker 报
             * `disabled should not set with empty value`。
             */
            form.setFieldsValue({
                dateType: next.dateType,
                dateRange: [toDayjs(next.startDate)!, toDayjs(next.endDate)!],
            });
            setQuery({...next});
            // 兜底：请求卡死时别让 agent 的 ui_act 一直挂着
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        }), [form]);

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

    /**
     * 查询表单的初值，交给 `Form` 的 `initialValues`（只在挂载时生效一次），
     * **别用 effect 里 `setFieldsValue` 后补**：`dateType` 缺省就是 0，`RangePicker` 首帧就已经是
     * `disabled`，而 effect 要等到首帧之后才把日期写进 store —— 那一瞬间「禁用了、值却是空的」，
     * rc-picker 会报 `disabled should not set with empty value`。
     */
    const initialValues: SearchValues = {dateType: 0, dateRange: range};

    /** 交给界面桥的状态与能力：桥通过取值函数读，不直接持有 */
    const bridgeContext = useMemo<PrescheduleBridgeContext>(() => ({
        view,
        query,
        applyQuery,
        readTable: () => tableRef.current,
    }), [view, query, applyQuery]);

    /**
     * 界面桥：表格的列目录 / 取数 / 筛选全在 `createTableBridge`，本页只补「查询条件」。
     *
     * 依赖里的 `query` 是必须的 —— 快照的 query 段要跟着用户改条件变；
     * 装配细节全在 `./bridged.ts`，**那个文件存在即「本页接入了界面桥」**（工作台导航靠它判定）。
     */
    const bridge = useMemo(() => createPrescheduleBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                initialValues={initialValues}
                onFinish={(values: SearchValues) => {
                    const [start, end] = values.dateRange ?? range;
                    setQuery({
                        startDate: formatDate(start),
                        endDate: formatDate(end),
                        dateType: values.dateType ?? 0,
                    });
                }}
            >
                <Form.Item name="dateType" label={t("类型")}>
                    <Select style={{width: 100}} options={DATE_TYPE_OPTIONS}/>
                </Form.Item>
                <Form.Item name="dateRange" label={t("日期")}>
                    {/* 与旧客户端同义：选「全部」时日期不参与筛选，控件禁用但值照传 */}
                    <DatePicker.RangePicker allowClear={false} disabled={dateType === 0}/>
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            {t("查询")}</Button>
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
                ref={tableRef}
                columns={PRESCHEDULE_COLUMNS}
                records={records as unknown as Array<Record<string, unknown>>}
                rowKey="ID"
                loading={loading}
                exportName={t("预排汇总")}
                groupable
            />
        </div>
    );
};

export default PrescheduleSummaryPage;
