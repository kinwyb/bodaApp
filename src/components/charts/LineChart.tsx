import React, {useMemo} from 'react';
import {theme} from 'antd';
import {
    Area,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {toNumberOrZero} from '@/utils';
import {ChartLegend, ChartShell, ChartTooltip} from './chartParts';
import {formatCompactNumber, formatCompactOrBlank} from './format';
import {createChartTheme, seriesColor} from './theme';

/**
 * 折线图（对应 DevExpress 的 `ChartControl` + `LineSeriesView` / `StackedLineSeriesView`）。
 *
 * 与 `StackedBarChart` 的分工：柱状看「一个时点上的构成」，折线看「随时间的趋势」。
 * 两者共用主题、tooltip、图例、空态与数值缩写（都在 `chartParts` / `format` 里）。
 *
 * 典型来源：`Views/V0018/V0256.cs`（染厂看板，多系列折线 + 图例分组）、
 * `Views/V0189/V0201/V0203~V0206`（产能看板，折线 + 柱状混排）。
 */
export type LineChartSeries = {
    /** 数据字段名（与 records 里的字段一致，不要改写大小写） */
    field: string;
    /** 图例与 tooltip 里显示的名字（中文） */
    name: string;
    /** 指定颜色；不传按 antd 语义色板顺序取 */
    color?: string;
};

export type LineChartProps = {
    /** 每个 X 点一条记录 */
    data: ReadonlyArray<Record<string, unknown>>;
    /** X 轴字段（通常是月份 / 日期） */
    xField: string;
    series: readonly LineChartSeries[];
    /**
     * 是否堆叠（对应 `StackedLineSeriesView`）。
     *
     * 堆叠后各系列共享同一根 Y 轴刻度，数值是「累加后的量」；
     * 不同量纲的线（产量 vs 合格率）**不要**堆叠，否则两条线的刻度会互相压扁。
     */
    stacked?: boolean;
    /** 是否平滑曲线；默认 false（旧客户端 `LineSeriesView` 画的是直线段） */
    smooth?: boolean;
    /** 是否显示数据点；默认 false，点少（≤12 个）时可以打开 */
    showDots?: boolean;
    /**
     * 是否在点上标数值。
     *
     * 默认关：折线图的数据点密集，标数字基本都会互相压。
     * 真要开就只给点数少的系列，并配合 `formatCompactOrBlank`（0 不标）。
     */
    showLabels?: boolean;
    loading?: boolean;
    emptyTip?: string;
};

/**
 * 折线图。
 *
 * ⚠️ 高度与 `StackedBarChart` 一样：根节点 `height:100%`，
 * 父级必须给确定高度（`ResponsiveContainer` 在 `auto` 高度里会塌成 0）。
 */
export const LineChart: React.FC<LineChartProps> = ({
    data,
    xField,
    series,
    stacked = false,
    smooth = false,
    showDots = false,
    showLabels = false,
    loading = false,
    emptyTip = '暂无数据',
}) => {
    const {token} = theme.useToken();
    const chartTheme = useMemo(() => createChartTheme(token), [token]);

    const rows = useMemo(
        () => data.map((row) => {
            const next: Record<string, unknown> = {...row};
            series.forEach((item) => {
                // 统一转数字：后端常给字符串（"12"），不转的话折线会断在这一点
                next[item.field] = toNumberOrZero(row[item.field]);
            });
            return next;
        }),
        [data, series],
    );

    const isEmpty = rows.length === 0;
    /** 堆叠时所有系列共用一个 stackId；不堆叠就各画各的 */
    const stackId = stacked ? 'stack' : undefined;

    return (
        <ChartShell loading={loading} isEmpty={isEmpty} emptyTip={emptyTip}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{top: 16, right: 16, bottom: 4, left: 0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false}/>
                    <XAxis
                        dataKey={xField}
                        tick={{fill: chartTheme.tickColor, fontSize: chartTheme.fontSize}}
                        axisLine={{stroke: chartTheme.axisLine}}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{fill: chartTheme.tickColor, fontSize: chartTheme.fontSize}}
                        axisLine={false}
                        tickLine={false}
                        // 56 是缩写后 `7947k` 放得下的宽度；窄了会被裁成相同前缀（柱状图踩过）
                        width={56}
                        tickFormatter={(value: number) => formatCompactNumber(value)}
                    />
                    <Tooltip
                        content={<ChartTooltip chartTheme={chartTheme}/>}
                        cursor={{stroke: chartTheme.axisLine, strokeDasharray: '3 3'}}
                    />
                    <Legend
                        verticalAlign="bottom"
                        align="center"
                        content={
                            <ChartLegend
                                chartTheme={chartTheme}
                                items={series.map((item, index) => ({
                                    key: item.field,
                                    name: item.name,
                                    color: item.color ?? seriesColor(chartTheme, index),
                                }))}
                            />
                        }
                    />
                    {series.map((item, index) => {
                        const color = item.color ?? seriesColor(chartTheme, index);
                        const shared = {
                            dataKey: item.field,
                            name: item.name,
                            stroke: color,
                            strokeWidth: 2,
                            type: smooth ? ('monotone' as const) : ('linear' as const),
                            stackId,
                            dot: showDots ? {r: 3, fill: color, strokeWidth: 0} : false,
                            activeDot: {r: 4},
                            isAnimationActive: false,
                            label: showLabels ? renderPointLabel(chartTheme) : undefined,
                        };
                        /*
                         * 堆叠走 `Area` 而不是 `Line`：Recharts 3 的 `Line` **没有 `stackId`**
                         * （只有 Bar / Area 支持堆叠），`Line` 上写这个属性会直接 TS 报错。
                         * 用 Area + 半透明填充，视觉上仍是「一条条堆叠的折线」，
                         * 而且能看出每一段自己贡献了多少。
                         */
                        return stacked ? (
                            <Area key={item.field} {...shared} fill={color} fillOpacity={0.18}/>
                        ) : (
                            <Line key={item.field} {...shared}/>
                        );
                    })}
                </ComposedChart>
            </ResponsiveContainer>
        </ChartShell>
    );
};

/**
 * 数据点标签：0 不写，其余走缩写。
 *
 * 用函数形态而不是 `<LabelList>`：折线的 label 回调能拿到该点的 x/y，
 * 直接贴着点上方画，不需要再算偏移。
 */
function renderPointLabel(chartTheme: ReturnType<typeof createChartTheme>) {
    return (props: {x?: number | string; y?: number | string; value?: unknown}) => {
        const text = formatCompactOrBlank(props.value);
        if (!text || props.x === undefined || props.y === undefined) return null;
        return (
            <text
                x={Number(props.x)}
                y={Number(props.y) - 8}
                textAnchor="middle"
                fill={chartTheme.textColor}
                fontSize={chartTheme.fontSize}
            >
                {text}
            </text>
        );
    };
}
