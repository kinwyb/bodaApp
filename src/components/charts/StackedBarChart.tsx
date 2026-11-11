import React, {useMemo} from 'react';
import {theme} from 'antd';
import {
    Bar,
    BarChart,
    CartesianGrid,
    LabelList,
    Legend,
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
 * 柱状图（对应 DevExpress 的 `ChartControl` + `StackedBarSeriesView` / `SideBySideBarSeriesView`）。
 *
 * 组件名沿用 `StackedBarChart`（存量页面在引用），但 **`stacked={false}` 就是并排柱** ——
 * 两者只差一个 `stackId`：给了就堆叠，不给 Recharts 自动并排。
 *
 * 为什么自己包一层，而不是页面里直接写 `<BarChart>`：
 * 1. **主题只能在这里接**：`useToken()` 是 hook，页面里每张图都要写一遍 token → 样式必然漂移；
 * 2. **堆叠总计标签**（DevExpress 的 `DefaultPane.StackedBarTotalLabel.Visible`）Recharts 没有配置项，
 *    要靠「最后一个 Bar 上的 LabelList 读派生字段」这个技巧，写在页面里没人看得懂；
 * 3. **段标签的 0 值处理**：旧客户端把 0 画成空白，Recharts 默认会画一个「0」。
 *
 * 用法见 `src/pages/views/V0189/V0279/V0297`（堆叠）与 `V0018/V0256`（并排）。
 */
export type StackedBarSeries = {
    /** 数据字段名（与 records 里的字段一致，不要改写大小写） */
    field: string;
    /** 图例与 tooltip 里显示的名字（中文） */
    name: string;
    /** 指定颜色；不传按 antd 语义色板顺序取 */
    color?: string;
};

export type StackedBarChartProps = {
    /** 每个柱一条记录 */
    data: ReadonlyArray<Record<string, unknown>>;
    /** X 轴字段（类别） */
    xField: string;
    /** 系列，**堆叠时数组顺序就是自下而上的顺序** */
    series: readonly StackedBarSeries[];
    /**
     * 是否堆叠，默认 `true`。
     *
     * `false` = 并排柱（C# 的 `SideBySideBarSeriesView`）：每个系列一组柱子，各自从 0 起。
     * 三者会跟着变：
     * - 段标签从「柱内白字」变成「柱顶深色字」（并排柱的值在柱顶，柱内放不下）；
     * - 不再做「占合计 6%」的过滤（并排柱各自独立，没有堆叠段的概念）；
     * - 合计标签默认关闭（并排柱没有「堆叠顶」，合计没有正确位置）。
     */
    stacked?: boolean;
    /**
     * 是否在堆叠顶部显示合计（对应 `StackedBarTotalLabel`）。
     *
     * **默认跟 `stacked` 走**：堆叠时显示，并排时关闭。
     * 并排柱硬开也能画，但位置只在「最后一层柱的顶」，不是整组柱的最高点 —— 看着会错位。
     */
    showTotal?: boolean;
    /** 合计的格式化（默认缩写） */
    totalFormat?: (value: number) => string;
    /** 加载态：盖一层 antd Spin */
    loading?: boolean;
    /** 空数据提示 */
    emptyTip?: string;
    /** 柱子最大宽度，默认 28（仅堆叠时生效；并排时交给 Recharts 按带宽分配） */
    barSize?: number;
};

/**
 * 段内标签的显示门槛：该段占本柱合计的比例（判据与 `ComboChart` 共用，见 `format.ts`）。
 *
 * 低于它的段**不写字**，具体数值看 tooltip。
 */

/** 段标签字段名：与业务字段分开命名，避免覆盖原值（原值 tooltip 还要用） */
function segmentLabelField(field: string): string {
    return `__label_${field}`;
}

/**
 * 堆叠柱状图。
 *
 * ⚠️ 高度：`ResponsiveContainer` 需要一个**确定高度**的父级。本组件根节点是 `height:100%`，
 * 所以外面必须给死高度（例如 Splitter 面板内套一个 `height: 100%` 的 div，
 * 或直接给固定 px）。放在 flex 列里不加约束，它会塌成 0 —— 和 GridTable 的「高度 0」是同一类坑。
 */
export const StackedBarChart: React.FC<StackedBarChartProps> = ({
    data,
    xField,
    series,
    stacked = true,
    showTotal,
    totalFormat,
    loading = false,
    emptyTip = '暂无数据',
    barSize = 28,
}) => {
    const {token} = theme.useToken();
    const chartTheme = useMemo(() => createChartTheme(token), [token]);
    /** 并排柱没有「堆叠顶」，合计标签默认关掉（见 props 注释） */
    const showTotalLabel = showTotal ?? stacked;

    /**
     * 派生合计字段 + 每段的**标签文本**字段。
     *
     * 为什么要有合计：总计标签要「放在堆叠顶、显示总和」，而 Recharts 的 LabelList
     * 既能按 `dataKey` 取文本、又按**所属 Bar 的矩形**定位 —— 把合计写成数据字段、
     * 挂在**最后一层** Bar 的 LabelList 上，位置正好是堆叠顶。
     * 若改挂一个隐藏的 Bar 或自己算坐标，都要重新算一遍堆叠偏移，没必要。
     *
     * 为什么标签文本也要预先算进数据：这张看板的量级悬殊（下单量百万级、预排量几千），
     * 小段在图上只有**几个像素高**，字压上去必然和相邻段、和 X 轴糊在一起 ——
     * 描边再深也救不了，因为根本没有地方。
     * `LabelList` 的 `formatter` 只拿得到值、拿不到段高，所以在这里按「占合计的比例」提前判断：
     * 太小的段不写字，需要具体数字时看 tooltip（tooltip 给完整前数值）。
     *
     * **并排柱不做这个比例过滤**：每根柱子各自从 0 起，`value / 合计` 跟它的高度没有关系，
     * 按比例筛会误伤（比如并排的两根各占 50%，都很高，却都低于别的行）。
     * 并排时只保留「0 不写字」这一条。
     */
    const rows = useMemo(
        () => data.map((row) => {
            const values = series.map((item) => toNumberOrZero(row[item.field]));
            const total = values.reduce((sum, value) => sum + value, 0);
            const next: Record<string, unknown> = {...row, __stackTotal: total};
            series.forEach((item, index) => {
                const ratio = total > 0 ? values[index] / total : 0;
                next[segmentLabelField(item.field)] = stacked
                    ? (ratio >= SEGMENT_LABEL_MIN_RATIO ? formatCompactOrBlank(values[index]) : '')
                    : formatCompactOrBlank(values[index]);
            });
            return next;
        }),
        [data, series, stacked],
    );

    const lastIndex = series.length - 1;
    const isEmpty = rows.length === 0;

    return (
        <ChartShell loading={loading} isEmpty={isEmpty} emptyTip={emptyTip}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{top: 24, right: 16, bottom: 4, left: 0}}>
                    {/* 只留横向网格：纵向网格在柱状图里只会和柱子抢视线，antd 的表格也是横向分隔 */}
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
                        /*
                         * 56 而不是 48：刻度是缩写后的 `7947k`（5 字符），48 会被裁掉尾字符 ——
                         * 裁剩的前缀还都一样（1000000/2000000 都变成 "100000"），四个刻度看着完全相同。
                         */
                        width={56}
                        allowDecimals={false}
                        // 刻度也走缩写，否则宽数字既占地方又容易被裁
                        tickFormatter={(value: number) => formatCompactNumber(value)}
                    />
                    <Tooltip
                        content={<ChartTooltip chartTheme={chartTheme} showTotal/>}
                        cursor={{fill: token.colorFillTertiary}}
                    />
                    <Legend
                        verticalAlign="bottom"
                        align="center"
                        /*
                         * **自己渲染图例**，不用 Recharts 默认的 payload 推导：
                         * 1. 堆叠柱自动推导出来的条目顺序是反的（实测「预排量 / 下单量」被画成
                         *    「下单量 / 预排量」），而旧客户端 `LegendDirection.LeftToRight` 按 series 顺序排；
                         * 2. 默认图例的色块与文字样式跟 antd 差得远（色块偏大、文字用 SVG 默认字体）。
                         * Recharts 3 的 `Legend` 不接受 `payload` 入参（类型里被 Omit 了），
                         * 所以走 `content` —— 一个普通 HTML 行，顺序与颜色都由这里的 series 决定。
                         */
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
                    {series.map((item, index) => (
                        <Bar
                            key={item.field}
                            dataKey={item.field}
                            name={item.name}
                            /*
                             * 堆叠才给 stackId；并排**必须传 undefined**（等于不传）——
                             * Recharts 的 `Bar` 默认 `stackId = 0`，只要它存在就归到「0 组」里堆叠。
                             * 也不能给每个系列一个不同的 stackId：那样各组共享同一 x 位置，柱子会叠在一起。
                             */
                            stackId={stacked ? 'stack' : undefined}
                            fill={item.color ?? seriesColor(chartTheme, index)}
                            // 并排时不钉死柱宽：让 Recharts 按带宽分配，否则两根柱会挤在一起
                            barSize={stacked ? barSize : undefined}
                            // 动画在数据频繁刷新时会闪，且和「合计标签」的位置计算抢帧
                            isAnimationActive={false}
                            radius={stacked
                                // 堆叠：只给最上面一段圆角，中间段圆角会在缝里露出底色
                                ? (index === lastIndex ? [4, 4, 0, 0] : undefined)
                                // 并排：每根柱子都是一根完整的柱，都给圆顶
                                : [4, 4, 0, 0]}
                        >
                            <LabelList
                                /*
                                 * 取的是**预先算好的标签字段**（见 rows 的派生），不是原值：
                                 * 太小的段在这里已经是空串，`formatter` 拿不到段高、判断不了。
                                 */
                                dataKey={segmentLabelField(item.field)}
                                /*
                                 * 堆叠 → 字在段中间、白色（柱子有底色）；
                                 * 并排 → 字在柱顶**外面**，必须用深色 —— 白字落在白底上什么都看不见。
                                 */
                                position={stacked ? 'center' : 'top'}
                                fill={stacked ? '#fff' : chartTheme.textColor}
                                fontSize={chartTheme.fontSize}
                                /*
                                 * 柱内数值是白字，压在**浅色段**（如 antd 的 success 绿）上几乎看不见 ——
                                 * 实测截图里那一段糊成一团。加一层深色描边 + `paintOrder:'stroke'`
                                 * （让描边画在字下面，不把笔画压细），白字在任何底色上都立得起来。
                                 *
                                 * 0.28 的描边在浅绿上仍然糊（用户实测反馈），加到 0.6 并把笔画加宽：
                                 * 描边是「字形外扩」，加深它等于给白字套了一圈深色底，
                                 * 比缩小字号或换字色更有效 —— 底色是数据驱动的，字色没法两全。
                                 *
                                 * 并排柱在柱顶外，没有底色要压 → 不加描边（深色字加描边会显脏）。
                                 */
                                {...(stacked
                                    ? {stroke: 'rgba(0, 0, 0, 0.6)', strokeWidth: 3, paintOrder: 'stroke'}
                                    : {})}
                            />
                            {/*
                              合计标签：挂在**最后一层**上，位置取该层矩形顶部 = 整个堆叠的顶。
                              文本取派生字段 `__stackTotal`，所以显示的是合计而不是该层的值。
                            */}
                            {showTotalLabel && index === lastIndex && (
                                <LabelList
                                    dataKey="__stackTotal"
                                    position="top"
                                    offset={8}
                                    fill={chartTheme.textColor}
                                    fontSize={chartTheme.fontSize}
                                    fontWeight={500}
                                    formatter={(value: unknown) => {
                                        const total = toNumberOrZero(value);
                                        if (total === 0) return '';
                                        // 合计是图里最长的数字，必须缩写，否则几条柱的合计会互相顶到一起
                                        return totalFormat ? totalFormat(total) : formatCompactNumber(total);
                                    }}
                                />
                            )}
                        </Bar>
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </ChartShell>
    );
};
