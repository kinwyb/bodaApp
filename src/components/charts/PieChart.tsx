import React, {useMemo} from 'react';
import {theme} from 'antd';
import {Cell, Legend, Pie, PieChart as RechartsPieChart, ResponsiveContainer, Tooltip} from 'recharts';
import {toNumberOrZero} from '@/utils';
import {ChartLegend, ChartShell, ChartTooltip} from './chartParts';
import {createChartTheme, seriesColor} from './theme';

/**
 * 饼图 / 环形图（对应 DevExpress 的 `ChartControl` + `PieSeriesView` / `DoughnutSeriesView`）。
 *
 * 用途：看**构成比例**（各产地占比、各工序耗时占比）。
 * 看「随时间的趋势」用 `LineChart`，看「同一时点的绝对量对比」用 `StackedBarChart` ——
 * 饼图只适合「加起来等于一个整体」的场景，不要把不同量纲的指标塞进来。
 */
export type PieChartProps = {
    data: ReadonlyArray<Record<string, unknown>>;
    /** 分类字段（扇区名，进图例与 tooltip） */
    nameField: string;
    /** 数值字段（决定扇区角度） */
    valueField: string;
    /**
     * 内径：`0`（默认）= 实心饼图，`'55%'` 这类百分比 = 环形图。
     *
     * 环形图的优势是中间能放总计数，但本组件暂时没接那段文案 —— 需要时由页面自己在
     * 中心叠一个绝对定位的 `<div>`。
     */
    innerRadius?: number | string;
    /** 是否在扇区外显示「名称 + 百分比」，默认 true */
    showLabel?: boolean;
    /** 小于这个百分比（3 = 3%）的扇区不写字，避免标签叠在一起 */
    minLabelPercent?: number;
    /** 是否显示底部图例，默认 true */
    showLegend?: boolean;
    loading?: boolean;
    emptyTip?: string;
};

/** 把 records 转成 Recharts 需要的 `{name, value}`，并丢掉 0 值与负值 */
function toPieRows(
    data: ReadonlyArray<Record<string, unknown>>,
    nameField: string,
    valueField: string,
): Array<{key: string; name: string; value: number}> {
    return data
        .map((row, index) => ({
            key: `${String(row[nameField] ?? index)}-${index}`,
            name: String(row[nameField] ?? ''),
            value: toNumberOrZero(row[valueField]),
        }))
        // 0 值扇区不可见，留在图例里只会让人以为漏了一个分类
        .filter((row) => row.value > 0);
}

/**
 * 饼图。
 *
 * ⚠️ 与其它图一致：根节点 `height:100%`，父级必须给确定高度。
 *
 * ⚠️ 颜色按分类**顺序**取 antd 语义色板（8 个），超过 8 类会循环取色 —— 那时两张扇区
 * 可能同色。真超过 8 类，先考虑换成横向条形图（类别多时本来就比饼图好读）。
 */
export const PieChart: React.FC<PieChartProps> = ({
    data,
    nameField,
    valueField,
    innerRadius = 0,
    showLabel = true,
    minLabelPercent = 3,
    showLegend = true,
    loading = false,
    emptyTip = '暂无数据',
}) => {
    const {token} = theme.useToken();
    const chartTheme = useMemo(() => createChartTheme(token), [token]);

    const rows = useMemo(
        () => toPieRows(data, nameField, valueField),
        [data, nameField, valueField],
    );

    const isEmpty = rows.length === 0;

    return (
        <ChartShell loading={loading} isEmpty={isEmpty} emptyTip={emptyTip}>
            <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart margin={{top: 8, right: 8, bottom: 8, left: 8}}>
                    <Pie
                        data={rows}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={innerRadius}
                        // 留出边距给引线与标签，否则贴边被裁
                        outerRadius="70%"
                        isAnimationActive={false}
                        labelLine={showLabel ? {stroke: chartTheme.axisLine, strokeWidth: 1} : false}
                        label={showLabel ? renderSliceLabel(minLabelPercent, chartTheme) : false}
                    >
                        {rows.map((row, index) => (
                            <Cell key={row.key} fill={seriesColor(chartTheme, index)}/>
                        ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip chartTheme={chartTheme}/>}/>
                    {showLegend && (
                        <Legend
                            verticalAlign="bottom"
                            align="center"
                            content={
                                <ChartLegend
                                    chartTheme={chartTheme}
                                    items={rows.map((row, index) => ({
                                        key: row.key,
                                        name: row.name,
                                        color: seriesColor(chartTheme, index),
                                    }))}
                                />
                            }
                        />
                    )}
                </RechartsPieChart>
            </ResponsiveContainer>
        </ChartShell>
    );
};

/**
 * 扇区标签：「名称 12.3%」。
 *
 * 两个刻意的选择：
 * 1. **不用字符串形态**（`label={(p) => \`${p.name} ${p.percent}\`}`）：那样文字会继承扇区色，
 *    四种颜色四种字色，跟 antd 正文完全不是一套。这里自己画 `<text>`，统一用 `colorText`。
 * 2. 太小的扇区（默认 < 3%）不写字 —— 它们的引线会挤成一团，百分比本身也看不准，
 *    具体数值看 tooltip。
 */
function renderSliceLabel(minLabelPercent: number, chartTheme: ReturnType<typeof createChartTheme>) {
    return (props: {
        x?: number;
        y?: number;
        name?: string | number;
        percent?: number;
        textAnchor?: 'start' | 'middle' | 'end' | 'inherit';
    }) => {
        const percent = (props.percent ?? 0) * 100;
        if (percent < minLabelPercent) return null;
        if (props.x === undefined || props.y === undefined) return null;
        return (
            <text
                x={props.x}
                y={props.y}
                textAnchor={props.textAnchor ?? 'middle'}
                dominantBaseline="central"
                fill={chartTheme.textColor}
                fontSize={chartTheme.fontSize}
                fontFamily={chartTheme.fontFamily}
            >
                {`${String(props.name ?? '')} ${percent.toFixed(1)}%`}
            </text>
        );
    };
}
