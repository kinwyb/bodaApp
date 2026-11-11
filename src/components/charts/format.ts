/**
 * 图表上的数值格式化。
 *
 * 为什么需要它：这张看板的量级从「几百」到「上千万」，原样画出来有两个硬伤（实测截图）：
 * 1. Y 轴刻度 `1000000 / 2000000 / 3000000` 宽到被**裁成同一个前缀**「100000」，
 *    四个刻度看起来一模一样；
 * 2. 柱子里的数值（如 8100）比柱宽还长，白字直接糊在一起。
 *
 * 单位按 1000 进位往上走：`k`（千）→ `M`（百万）→ `B`（十亿）。
 * 不做「万 / 亿」混排：`1k` 与 `0.1万` 两种口径同时出现，读的人要换算两次。
 */

/** 单位表：从大到小，命中第一个「够大」的就用它 */
const UNITS: ReadonlyArray<{limit: number; suffix: string}> = [
    {limit: 1e9, suffix: 'B'},
    {limit: 1e6, suffix: 'M'},
    {limit: 1e3, suffix: 'k'},
];

/** 去掉小数末尾多余的 0：`8.0` → `8`，`8.10` → `8.1` */
function trimTrailingZero(text: string): string {
    return text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/**
 * 数值 → 紧凑文本。
 *
 * 位数规则：换算后的绝对值**小于 100 保留一位小数**（`8.1k`、`7.9M`），
 * 再大就取整（`795k`、`12M`）—— 三位有效数字在这个看板上足够读数，
 * 再多一位只会让标签变长、互相顶到一起。
 *
 * ```
 * 999      → 999
 * 1000     → 1k
 * 8100     → 8.1k
 * 794652   → 795k
 * 7946523  → 7.9M
 * 1.23e9   → 1.2B
 * -1200    → -1.2k
 * ```
 */
export function formatCompactNumber(value: unknown): string {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '';
    const abs = Math.abs(num);
    if (abs < 1000) return String(num);

    for (const {limit, suffix} of UNITS) {
        if (abs < limit) continue;
        const scaled = num / limit;
        const text = Math.abs(scaled) < 100
            ? trimTrailingZero(scaled.toFixed(1))
            : String(Math.round(scaled));
        return `${text}${suffix}`;
    }
    return String(num);
}

/**
 * 0 值返回空串。
 *
 * 表格与图表口径一致：**0 与「没有量」在这个业务里是一回事**，
 * 标一个「0」只是噪点（旧客户端 `CustomDrawCell` 也是这么处理的）。
 */
export function formatCompactOrBlank(value: unknown): string {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num === 0) return '';
    return formatCompactNumber(num);
}

/**
 * 完整数字 + 千分位（tooltip 用）。
 *
 * tooltip 里空间够、用户要的是准确值，所以**不缩写** —— 缩写只用在
 * 「轴刻度、柱内标签」这些没地方放长数字的位置。
 */
export function formatFullNumber(value: unknown): string {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '';
    return num.toLocaleString('zh-CN');
}
