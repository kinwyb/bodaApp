import React, {useMemo} from 'react';
import {theme} from 'antd';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    LabelList,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {toNumberOrZero} from '@/utils';
import {ChartLegend, ChartShell, ChartTooltip} from './chartParts';
import {formatCompactNumber, formatCompactOrBlank, SEGMENT_LABEL_MIN_RATIO} from './format';
import {createChartTheme, seriesColor} from './theme';

/**
 * 柱线混排图（对应 DevExpress 的 `XYDiagram` 里同时挂 `BarSeriesView` 与 `LineSeriesView`）。
 *
 * 典型场景：**绝对量 + 比率**同屏 —— 柱子是产量，折线是合格率（量纲差几十倍）。
 * 这类图几乎一定需要**双 Y 轴**，否则小量级的那条线会被压成贴着 X 轴的一条直线。
 *
 * 与另外三个组件的分工：
 * - 只有柱 → `StackedBarChart`（堆叠 / 并排）
 * - 只有线 → `LineChart`
 * - 柱 + 线 → 本组件
 * - 占比 → `PieChart`
 *
 * ⚠️ 高度与其它图一致：根节点 `height:100%`，父级必须给确定高度。
 */
export type ComboSeries = {
    /** 数据字段名 */
    field: string;
    /** 图例与 tooltip 里显示的名字 */
    name: string;
    /**
     * 图元类型。
     * `bar` 柱、`line` 折线 —— 对应 C# 里同一个 `XYDiagram` 下的不同 `SeriesView`。
     */
    type: 'bar' | 'line';
    /**
     * 挂哪根 Y 轴，默认 `left`。
     *
     * 量纲不同（产量 vs 合格率）时必须把比率放到 `right`，
     * 否则它就是贴着 X 轴的一条线。
     */
    axis?: 'left' | 'right';
    color?: string;
    /**
     * 柱的堆叠组：同组名的柱堆在一起，**不传就是并排**。
     *
     * ⚠️ 不能给每个柱传不同的 stackGroup 来做「并排」—— Recharts 的 `Bar` 默认
     * `stackId = 0`，不同组的柱会共享同一个 x 位置、直接叠在一起（柱状图踩过）。
     * 并排就是不传。
     */
    stackGroup?: string;
    /** 折线是否平滑，默认 false */
    smooth?: boolean;
};

export type ComboChartProps = {
    data: ReadonlyArray<Record<string, unknown>>;
    xField: string;
    series: readonly ComboSeries[];
    /**
     * 右侧 Y 轴的刻度格式，默认走数值缩写。
     *
     * 比率类指标传 `(v) => \`${(v * 100).toFixed(0)}%\`` 之类的函数
     * （注意本项目百分比是**百分数语义**：后端给 `95` 就别再乘 100）。
     */
    rightAxisFormat?: (value: number) => string;
    /** 是否显示数值标签（柱在顶、线在点上方），默认 false */
    showLabels?: boolean;
    /** 柱宽，默认 24 */
    barSize?: number;
    loading?: boolean;
    emptyTip?: string;
};

/** 堆叠柱的标签字段名（与业务字段分开，避免覆盖原值） */
function labelField(field: string): string {
    return `__label_${field}`;
}

export const ComboChart: React.FC<ComboChartProps> = ({
    data,
    xField,
    series,
    rightAxisFormat,
    showLabels = false,
    barSize = 24,
    loading = false,
    emptyTip = '暂无数据',
}) => {
    const {token} = theme.useToken();
    const chartTheme = useMemo(() => createChartTheme(token), [token]);

    /** 有元素挂到右轴时才渲染右侧 Y 轴（否则右侧留一条空白刻度） */
    const hasRightAxis = series.some((item) => item.axis === 'right');

    /**
     * 柱的堆叠合计：只有真正堆叠的柱才需要（用于把合计标在栈顶）。
     *
     * 与 `StackedBarChart` 同一套做法：合计写成数据字段，挂在**该组最后一根柱**的
     * LabelList 上，位置正好是栈顶，不用自己算堆叠偏移。
     */
    const rows = useMemo(() => {
        const barSeries = series.filter((item) => item.type === 'bar');
        return data.map((row) => {
            const next: Record<string, unknown> = {...row};
            series.forEach((item) => {
                // 统一转数字：后端常给字符串，不转的话线会断、柱会没有高度
                next[item.field] = toNumberOrZero(row[item.field]);
                next[labelField(item.field)] = formatCompactOrBlank(row[item.field]);
            });
            // 每个 stackGroup 一个合计字段；组内**只有最后一根柱**不标自己的值（它标合计）
            const groups = new Set(barSeries.map((item) => item.stackGroup).filter(Boolean) as string[]);
            groups.forEach((group) => {
                const members = barSeries.filter((item) => item.stackGroup === group);
                const total = members.reduce((sum, item) => sum + toNumberOrZero(row[item.field]), 0);
                next[`__stackTotal_${group}`] = total;
                const lastMember = members[members.length - 1];
                members.forEach((item) => {
                    if (item === lastMember) {
                        next[labelField(item.field)] = '';
                        return;
                    }
                    /*
                     * 段内标签按「占该组合计的比例」过滤：矮段（比如 42 万柱子里夹 84 的一层）
                     * 只有几像素高，白字会挤出柱外、和相邻段糊在一起。
                     * 与 `StackedBarChart` 同一条判据（`SEGMENT_LABEL_MIN_RATIO`）。
                     */
                    const value = toNumberOrZero(row[item.field]);
                    const ratio = total > 0 ? value / total : 0;
                    next[labelField(item.field)] =
                        ratio >= SEGMENT_LABEL_MIN_RATIO ? formatCompactOrBlank(value) : '';
                });
            });
            return next;
        });
    }, [data, series]);

    /** 某个堆叠组里负责标合计的最后一根柱 */
    const lastOfGroup = (group: string): string | null => {
        const members = series.filter((item) => item.type === 'bar' && item.stackGroup === group);
        return members.length > 0 ? members[members.length - 1].field : null;
    };

    const isEmpty = rows.length === 0;

    return (
        <ChartShell loading={loading} isEmpty={isEmpty} emptyTip={emptyTip}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                    data={rows}
                    /*
                     * 有右轴时右边距给 24：右轴刻度（`100%`）与最后一根柱的顶标签本来就贴得很近，
                     * 绘图区不收一点，两个文字会挤在一起（实测）。
                     */
                    margin={{top: 20, right: hasRightAxis ? 24 : 16, bottom: 4, left: 0}}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false}/>
                    <XAxis
                        dataKey={xField}
                        tick={{fill: chartTheme.tickColor, fontSize: chartTheme.fontSize}}
                        axisLine={{stroke: chartTheme.axisLine}}
                        tickLine={false}
                    />
                    <YAxis
                        yAxisId="left"
                        tick={{fill: chartTheme.tickColor, fontSize: chartTheme.fontSize}}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                        tickFormatter={(value: number) => formatCompactNumber(value)}
                    />
                    {hasRightAxis && (
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{fill: chartTheme.tickColor, fontSize: chartTheme.fontSize}}
                            axisLine={false}
                            tickLine={false}
                            width={52}
                            // 右轴不画网格：两套网格线交错会让图变脏
                            tickFormatter={(value: number) =>
                                rightAxisFormat ? rightAxisFormat(value) : formatCompactNumber(value)}
                        />
                    )}
                    <Tooltip
                        content={<ChartTooltip chartTheme={chartTheme}/>}
                        cursor={{fill: token.colorFillTertiary}}
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
                        const yAxisId = item.axis === 'right' ? 'right' : 'left';

                        if (item.type === 'line') {
                            return (
                                <Line
                                    key={item.field}
                                    yAxisId={yAxisId}
                                    type={item.smooth ? 'monotone' : 'linear'}
                                    dataKey={item.field}
                                    name={item.name}
                                    stroke={color}
                                    strokeWidth={2}
                                    dot={{r: 3, fill: color, strokeWidth: 0}}
                                    activeDot={{r: 4}}
                                    isAnimationActive={false}
                                    label={showLabels ? renderLineLabel(chartTheme) : undefined}
                                />
                            );
                        }

                        /*
                         * 柱：`stackGroup` 有值才堆叠；不传必须显式给 undefined ——
                         * Recharts 的 `Bar` 默认 `stackId = 0`，只要它有值就会被并到 0 组里堆叠。
                         */
                        const group = item.stackGroup;
                        const isStackedBar = !!group;
                        const isLastOfGroup = group ? lastOfGroup(group) === item.field : false;

                        return (
                            <Bar
                                key={item.field}
                                yAxisId={yAxisId}
                                dataKey={item.field}
                                name={item.name}
                                stackId={isStackedBar ? group : undefined}
                                fill={color}
                                barSize={barSize}
                                isAnimationActive={false}
                                radius={[4, 4, 0, 0]}
                            >
                                {showLabels && !isLastOfGroup && (
                                    <LabelList
                                        dataKey={labelField(item.field)}
                                        /*
                                         * 堆叠柱的标签在段内（浅色底）→ 白字 + 深色描边；
                                         * 独立柱的标签在柱顶（白底）→ 深色字。
                                         */
                                        position={isStackedBar ? 'center' : 'top'}
                                        fill={isStackedBar ? '#fff' : chartTheme.textColor}
                                        fontSize={chartTheme.fontSize}
                                        {...(isStackedBar
                                            ? {stroke: 'rgba(0, 0, 0, 0.6)', strokeWidth: 3, paintOrder: 'stroke'}
                                            : {})}
                                    />
                                )}
                                {/* 堆叠组的最后一根柱：标签取合计，位置在栈顶 */}
                                {showLabels && isLastOfGroup && (
                                    <LabelList
                                        dataKey={`__stackTotal_${group}`}
                                        position="top"
                                        offset={8}
                                        fill={chartTheme.textColor}
                                        fontSize={chartTheme.fontSize}
                                        fontWeight={500}
                                        formatter={(value: unknown) => {
                                            const total = toNumberOrZero(value);
                                            return total === 0 ? '' : formatCompactNumber(total);
                                        }}
                                    />
                                )}
                            </Bar>
                        );
                    })}
                </ComposedChart>
            </ResponsiveContainer>
        </ChartShell>
    );
};

/** 折线上的数据点标签：0 不写，其余缩写 */
function renderLineLabel(chartTheme: ReturnType<typeof createChartTheme>) {
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
                fontFamily={chartTheme.fontFamily}
            >
                {text}
            </text>
        );
    };
}
