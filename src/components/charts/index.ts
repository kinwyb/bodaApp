/**
 * 图表组件入口。
 *
 * 与 `@/components/grid-table` 的分工一致：**barrel 只导出组件与类型**，工具函数走子路径
 * （`@/components/charts/theme`、`./format`），避免 Fast Refresh 边界被普通函数破坏。
 *
 * 三种图的分工（选错图比样式更影响可读性）：
 *
 * | 看什么 | 用哪个 |
 * | --- | --- |
 * | 同一时点上的**绝对量对比 / 构成** | `StackedBarChart`（堆叠柱）、`PieChart`（占比） |
 * | 随时间的**趋势** | `LineChart` |
 * | 多指标混排（柱 + 线） | 两个组件叠在同一块高度里（见 `references/patterns.md`） |
 */
export {StackedBarChart} from './StackedBarChart';
export type {StackedBarChartProps, StackedBarSeries} from './StackedBarChart';

export {LineChart} from './LineChart';
export type {LineChartProps, LineChartSeries} from './LineChart';

export {PieChart} from './PieChart';
export type {PieChartProps} from './PieChart';

export type {ChartTheme} from './theme';
