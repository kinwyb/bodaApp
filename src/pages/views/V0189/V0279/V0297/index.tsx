import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Select, Space, Splitter} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import type {Dayjs} from 'dayjs';
import dayjs from 'dayjs';
import type {ViewPageProps} from '@/pages/types.ts';
import {PageBreadcrumb} from '@/components/PageBreadcrumb.tsx';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import {StackedBarChart, type StackedBarSeries} from '@/components/charts';
import type {YupaiOrderDeliverGroup, YupaiOrderDeliverGroupDepartment} from '@/api';
import {yupaiService} from '@/services/yupai.ts';
import {ErrorMessage} from '@/api/request.ts';
import {now, toStringOrEmpty} from '@/utils';
import {useAuth} from '@/store/auth-context.ts';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import {DEPARTMENT_SUMMARY_COLUMNS, MONTH_SUMMARY_COLUMNS} from './columns';
import {
    createMonthSummaryBridge,
    type ChartScope,
    type MonthSummaryBridgeContext,
    type MonthSummaryQuery,
} from './bridged';

/**
 * V0189_V0279_V0297 计划管理 > 月份汇总
 *
 * 与旧客户端（`Views/V0189/V0279/V0297.cs`）逐项对应：
 * - 查询区：「年份」+「图表」（隐藏 / 全部 / 义乌 / 越南 / 山西）+ 查询按钮
 *   （旧客户端是两个 `BarEditItem`，改年份会立刻重查，改图表只换图表数据源）
 * - 上方：左右两张汇总表（月份汇总 | 按部门汇总），各带导出
 * - 下方：堆叠柱图（预排量 / 下单量），选「隐藏」时折叠图表、表格占满
 *
 * **一个 `ChartControl` 换成一个 `StackedBarChart`**（不是另开一个页面或一张表）。
 *
 * 命令条上的东西一样都没搬成命令：
 * 1. 「导出月份汇总」「导出部门汇总」→ 两张表各自的 `exportName`（FilterTable 自带导出）；
 * 2. 「刷新」不迁 —— 这页有查询入口（年份 + 查询按钮）；
 * 3. 「年份」「图表」两个 `BarEditItem` → 顶部查询表单。
 * 于是本页**不需要 `command/`，也不渲染 `CommandBar`**。
 *
 * 界面桥声明在 `./bridged.ts`：那个文件存在即「本页接入了界面桥」。
 */

/** 图表维度：与 C# 的 `dataType` 一一对应（-1 隐藏，0 全部，1 义乌，2 越南，3 山西） */
const CHART_SCOPE_OPTIONS: Array<{value: ChartScope; label: string}> = [
    {value: -1, label: '隐藏'},
    {value: 0, label: '全部'},
    {value: 1, label: '义乌'},
    {value: 2, label: '越南'},
    {value: 3, label: '山西'},
];

/**
 * 维度 → 字段。**显式映射而不是拼字符串**：`m[`${prefix}YPQty`]` 这种写法
 * 在 TS 里要断言 keyof，改字段名时编译器也帮不上忙。
 */
const SCOPE_FIELDS: Record<Exclude<ChartScope, -1>, { yp: keyof YupaiOrderDeliverGroup; xd: keyof YupaiOrderDeliverGroup }> = {
    0: {yp: 'AllYPQty', xd: 'AllXDQty'},
    1: {yp: 'YwYPQty', xd: 'YwXDQty'},
    2: {yp: 'VnYPQty', xd: 'VnXDQty'},
    3: {yp: 'SxYPQty', xd: 'SxXDQty'},
};

/** 图例名与 C# 的 `chartControl1.Series[0].Name` 一致 */
const CHART_SERIES: StackedBarSeries[] = [
    {field: 'YPQty', name: '预排量'},
    {field: 'XDQty', name: '下单量'},
];

/** 部门汇总的行主键：接口没有主键，用「月份 + 部门」派生（稳定，不随排序变） */
function departmentRowKey(row: YupaiOrderDeliverGroupDepartment): string {
    return `${row.ZHMonth}__${row.DepartmentID}`;
}

/** 年份控件的值是「年」，接口要的是完整日期 —— 统一取年初（存储过程只读年份） */
function toYearArgument(year: Dayjs): string {
    return `${year.format('YYYY')}-01-01`;
}

const MonthSummaryPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message} = App.useApp();
    const {userInfo} = useAuth();
    /** 旧客户端把 `Common.userInfo.EmpID` 带给存储过程，用于部门数据权限 */
    const employeeNo = toStringOrEmpty(userInfo?.EmpID);

    const monthTableRef = useRef<FilterTableApi | null>(null);
    const departmentTableRef = useRef<FilterTableApi | null>(null);

    const [query, setQuery] = useState<MonthSummaryQuery>(() => ({year: toYearArgument(now().startOf('year'))}));
    const [chartScope, setChartScope] = useState<ChartScope>(0);

    /**
     * 年份控件显示的值 —— **从 `query` 派生**，不另存一份 state。
     *
     * 界面桥的 `query.set` 只会改 `query`；如果控件自己存一份年份，桥改完屏幕上还是旧年份
     * （「明明查的是 2024，控件显示 2026」）。派生就没有同步问题。
     */
    const yearValue = useMemo(() => dayjs(query.year), [query.year]);

    const [months, setMonths] = useState<YupaiOrderDeliverGroup[]>([]);
    const [departments, setDepartments] = useState<YupaiOrderDeliverGroupDepartment[]>([]);
    const [loading, setLoading] = useState(false);

    /** 一次查询的等待者（界面桥的 `query.set` 在等它） */
    const pendingQueryRef = useRef<(() => void) | null>(null);
    const settleQuery = useCallback(() => {
        const settle = pendingQueryRef.current;
        pendingQueryRef.current = null;
        settle?.();
    }, []);

    /**
     * 两个接口**并行**取数。
     *
     * 旧客户端也是同时发两个请求（`Common.ApiRequestAsync` 两次），但各自更新各自的表；
     * 这里合成一次 `Promise.all`：任意一个失败就整体报错，不会出现「上图有数据、下表空着」
     * 这种半截状态。
     */
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [monthRows, departmentRows] = await Promise.all([
                yupaiService.deliverGroup(query.year, employeeNo),
                yupaiService.deliverGroupDepartment(query.year, employeeNo),
            ]);
            setMonths(monthRows);
            setDepartments(departmentRows);
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
            // 失败也要放行，否则等它的那条 ui_act 会一直挂着
            settleQuery();
        }
    }, [query, employeeNo, message, settleQuery]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    /**
     * 换查询条件。
     *
     * **只有年份变了才重新查库**：旧客户端里「图表」下拉只切数据源（数据早就在
     * All/Yw/Vn/Sx 四组字段里），改它去重查库是纯浪费。这里把两种改动分开处理，
     * 桥的 `query.set` 也因此能立刻回执（改图表不用等请求）。
     */
    const applyQuery = useCallback((next: MonthSummaryQuery): Promise<void> => {
        const yearChanged = next.year !== query.year;
        setQuery({...next});

        if (!yearChanged) {
            // 只改了图表维度：数据不用重取，立即回执
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            pendingQueryRef.current = resolve;
            // 兜底：请求卡死时别让 agent 的 ui_act 一直挂着
            window.setTimeout(() => {
                if (pendingQueryRef.current !== resolve) return;
                pendingQueryRef.current = null;
                resolve();
            }, 12000);
        });
    }, [query]);

    /** 部门汇总的行：补一个稳定主键（接口本身没有） */
    const departmentRecords = useMemo(
        () => departments.map((row) => ({...row, _rowKey: departmentRowKey(row)})),
        [departments],
    );

    /**
     * 图表数据：从**月份汇总**里按维度挑两列。
     *
     * 与 C# 的 `refreshChart()` 等价 —— 它也是拿 `bindingSource1`（月份汇总）的数据，
     * 按 `dataType` 取不同的 YP/XD 字段，而不是重新请求。
     */
    const chartData = useMemo(() => {
        // 显式比 -1 而不是 `< 0`：TS 只对字面量比较收窄，`<` 收不掉 -1 这一支
        if (chartScope === -1) return [];
        const {yp, xd} = SCOPE_FIELDS[chartScope];
        return months.map((row) => ({
            ZHMonth: row.ZHMonth,
            YPQty: Number(row[yp] ?? 0),
            XDQty: Number(row[xd] ?? 0),
        }));
    }, [months, chartScope]);

    const chartVisible = chartScope !== -1;

    /** 上方两张表：图表隐藏时也复用这一段 */
    const tablesView = (
        <Splitter style={{flex: 1, minHeight: 0, height: 'auto'}}>
            {/*
              两张表的内边距**两边对称**（各 5px）：只给左边 `paddingRight` 会让
              左侧表格比右侧窄一截、两张表与容器的留白也不一样（实测宽度差 10px）。

              面板的 `size` 由 antd 按比例分配，padding 在面板内部 —— 两侧都给才对称。
            */}
            <Splitter.Panel
                className="splitter-pane-body"
                style={{overflow: 'hidden', paddingRight: 5}}
            >
                <FilterTable
                    ref={monthTableRef}
                    columns={MONTH_SUMMARY_COLUMNS}
                    records={months as unknown as Array<Record<string, unknown>>}
                    rowKey="ZHMonth"
                    loading={loading}
                    exportName="预订单月份汇总"
                />
            </Splitter.Panel>
            <Splitter.Panel
                className="splitter-pane-body"
                style={{overflow: 'hidden', paddingLeft: 5}}
            >
                {/* 旧客户端这里是一个粗体 LabelControl「按部门汇总」，压在表格上方 */}
                <div style={{fontWeight: 600, padding: '0 0 6px 2px'}}>按部门汇总</div>
                <FilterTable
                    ref={departmentTableRef}
                    columns={DEPARTMENT_SUMMARY_COLUMNS}
                    records={departmentRecords as unknown as Array<Record<string, unknown>>}
                    rowKey="_rowKey"
                    loading={loading}
                    exportName="预订单月份部门汇总"
                    /*
                     * 2 = 组行下面直接摊开部门明细。
                     * C# 那边是 `GroupCount = 1` + `GroupFooterShowMode.VisibleAlways`，
                     * 组标题、明细、组脚注一路展开；只展开到第 1 层会只剩四个月份标题，
                     * 部门行全被收起 —— 看着像「没有数据」。
                     */
                    groupExpandLevel={2}
                />
            </Splitter.Panel>
        </Splitter>
    );

    /** 交给界面桥的状态与能力：桥通过取值函数读，不直接持有 */
    const bridgeContext = useMemo<MonthSummaryBridgeContext>(() => ({
        view,
        query,
        chartScope,
        applyQuery,
        applyChartScope: setChartScope,
        readMonthTable: () => monthTableRef.current,
        readDepartmentTable: () => departmentTableRef.current,
    }), [view, query, chartScope, applyQuery]);

    const bridge = useMemo(() => createMonthSummaryBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                layout="inline"
                onFinish={() => {
                    /*
                     * 「查询」按钮 = 按当前年份**重查一次**。
                     *
                     * C# 那边没有这个按钮（改年份就自动查），但项目里每个查询页都有它，
                     * 而且它承担的正是 C#「刷新」按钮的职责 —— 数据被别人改了想再拉一次时用它。
                     * 传新对象是必须的：内容相同 React 不会重渲染，effect 不跑，等于没点。
                     */
                    setQuery((prev) => ({year: prev.year}));
                }}
            >
                <Form.Item label="年份">
                    {/*
                      年份直接受控在 query 上（而不是 Form 的 store）：界面桥 `query.set` 改年份后，
                      控件要跟着显示新年份。走 Form.Item 的 name 绑定做不到这一点 ——
                      桥改的是页面 state，Form 的 store 不知道。
                      改完**立即重查**，与旧客户端 `dateInput_EditValueChanged` 一致。
                    */}
                    <DatePicker
                        picker="year"
                        allowClear={false}
                        style={{width: 110}}
                        value={yearValue}
                        onChange={(value) => {
                            if (!value) return;
                            setQuery({year: toYearArgument(value)});
                        }}
                    />
                </Form.Item>
                <Form.Item label="图表">
                    {/*
                      「图表」只切换图表取哪两列，**不重新查库**（数据早就在表里的四组字段中）：
                      与旧客户端 `barEditItem1_EditValueChanged` 一致。
                    */}
                    <Select
                        style={{width: 100}}
                        options={CHART_SCOPE_OPTIONS}
                        value={chartScope}
                        onChange={(value: ChartScope) => setChartScope(value)}
                    />
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
              框（边框 / 圆角 / 留白）放外层，**不挂在 Splitter 上**：
              antd 用 offsetHeight 量分隔容器来算面板像素，边框与 padding 会让每块多出一截。
            */}
            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                padding: 5,
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: 10,
                overflow: 'hidden',
            }}>
                {chartVisible ? (
                    <Splitter
                        vertical
                        style={{
                            flex: 1,
                            minHeight: 0,
                            // `.ant-splitter` 自带 height:100%，放进 flex 列里会等于整页高
                            height: 'auto',
                        }}
                    >
                        <Splitter.Panel
                            className="splitter-pane-body"
                            style={{paddingBottom: 10, overflow: 'hidden'}}
                        >
                            {tablesView}
                        </Splitter.Panel>
                        <Splitter.Panel
                            className="splitter-pane-body"
                            style={{overflow: 'hidden'}}
                            /*
                             * 用 `defaultSize` 而不是 `size`：`size` 是**受控**尺寸，
                             * antd 会警告「要么配 onResize，要么改 defaultSize」。
                             * 这里只是给图表一个初始高度（用户仍可拖动分隔条），
                             * 不需要把拖拽结果回写到 state，所以用非受控的初始值。
                             */
                            defaultSize={280}
                        >
                            {/*
                              图表要**确定高度**：StackedBarChart 根节点是 height:100%，
                              ResponsiveContainer 在高度为 auto 的父级里会塌成 0（与 GridTable 同类坑）。
                              这里靠 Splitter.Panel 的初始高度给出高度。
                            */}
                            <StackedBarChart
                                data={chartData}
                                xField="ZHMonth"
                                series={CHART_SERIES}
                                loading={loading}
                                emptyTip="该年份没有汇总数据"
                            />
                        </Splitter.Panel>
                    </Splitter>
                ) : (
                    <div style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}>
                        {tablesView}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MonthSummaryPage;
