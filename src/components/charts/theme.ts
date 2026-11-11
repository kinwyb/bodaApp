/**
 * antd 设计 token → Recharts 的视觉变量。
 *
 * 为什么不改 Recharts 的默认主题：它没有「antd 概念」（token / 语义色 / 圆角），
 * 改它的 theme 文件只能写死色值 —— 换主题、切暗色、改主色就全都不跟。
 * 所以这里做**单向翻译**：组件里 `theme.useToken()` 拿到当前 token，翻译成图表用得上的那一小撮值。
 *
 * 三条约定（对齐 antd 观感的实际抓手）：
 * 1. **字体必须显式给**：Recharts 的 SVG 文本继承自外层，中文会和 antd 正文差半个字号；
 * 2. **颜色只用语义色**：`colorPrimary` / `colorSuccess` / … 而不是 Recharts 的 `#8884d8`；
 * 3. **网格线用 `colorSplit` + 虚线、只留横向**：与 antd Table 的分隔线同一观感。
 *
 * 这是纯函数模块（没有组件），所以能放在 `.ts` 里 —— `.tsx` 只允许导出组件（Fast Refresh 约束）。
 */
import type {GlobalToken} from 'antd/es/theme/interface';

/**
 * 图表主题：只收图表真正会用到的值。
 *
 * 刻意不做成「Recharts 配置对象」—— Recharts 没有集中式主题入参，
 * 各图元（轴 / 网格 / 图例 / tooltip）的参数是分散的，翻译成配置对象反而多一层无用的间接。
 */
export type ChartTheme = {
    /** 全局字体，必须显式给，否则中文与 antd 正文不一致 */
    fontFamily: string;
    /** 刻度文字字号（= antd 的 fontSizeSM，轴文字比正文小一档） */
    fontSize: number;
    /** 轴线颜色 */
    axisLine: string;
    /** 刻度文字颜色 */
    tickColor: string;
    /** 网格线颜色 */
    gridColor: string;
    /** 图表主文字色（标签、图例） */
    textColor: string;
    /** 次要文字色（图例、提示） */
    textColorSecondary: string;
    /** tooltip 背景 */
    tooltipBg: string;
    /** tooltip 边框 */
    tooltipBorder: string;
    /** tooltip 圆角 */
    tooltipRadius: number;
    /** 系列色板：按顺序取，超过长度就循环 */
    series: string[];
    /** 系列色板上限（避免取到 undefined） */
    seriesCount: number;
};

/**
 * 系列色板。
 *
 * 顺序是有讲究的：前两个是「预排量 / 下单量」这类最常见的两系列组合，
 * 用 primary + success —— 与「计划 vs 实际」的语义习惯一致（旧客户端用的是 DevExpress 的 Pastel Kit，
 * 那套色值与 antd 没有对应关系，所以这里按语义重排，而不是照抄色号）。
 */
const SERIES_TOKEN_KEYS = [
    'colorPrimary',
    'colorSuccess',
    'colorWarning',
    'colorError',
    'colorInfo',
    'colorPrimaryHover',
    'colorSuccessHover',
    'colorWarningHover',
] as const satisfies ReadonlyArray<keyof GlobalToken>;

/** 把当前 antd token 翻译成图表主题 */
export function createChartTheme(token: GlobalToken): ChartTheme {
    const series = SERIES_TOKEN_KEYS
        .map((key) => String(token[key] ?? ''))
        .filter((color) => color.length > 0);

    return {
        fontFamily: token.fontFamily,
        fontSize: token.fontSizeSM,
        // 轴线比网格线重一点：antd 的 border 层级正是这么分的
        axisLine: token.colorBorderSecondary,
        tickColor: token.colorTextSecondary,
        gridColor: token.colorSplit,
        textColor: token.colorText,
        textColorSecondary: token.colorTextSecondary,
        tooltipBg: token.colorBgElevated,
        tooltipBorder: token.colorBorderSecondary,
        tooltipRadius: token.borderRadiusLG,
        series: series.length > 0 ? series : [token.colorPrimary],
        seriesCount: series.length > 0 ? series.length : 1,
    };
}

/** 取第 index 个系列色（循环取，系列数超过色板长度时不会拿到 undefined） */
export function seriesColor(chartTheme: ChartTheme, index: number): string {
    return chartTheme.series[index % chartTheme.seriesCount];
}
