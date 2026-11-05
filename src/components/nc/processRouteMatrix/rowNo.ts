/**
 * 工序明细新增行的行号（`VRowNo`）推算。
 *
 * 规则与 `components/nc/bomMatrix/rowNo.ts` 完全一致（那边是包装 BOM 的子项行号）：
 * - 追加到最下面：取下一个 10 的倍数（10/20/30 → 40；最后一行是 37 → 40），留出空档；
 * - 插在两行中间：取上下两行行号的**平均值**（10 与 20 → 15），不动已有行号；
 * - 上下行号相同 / 倒挂：返回 `null` 让调用方提示用户，不猜 —— 猜出来必然重复。
 *
 * 算法很小，但两处必须同口径：工艺路线的行号同样是「排序键」，界面上插行、导出的
 * 工艺文件、下游 NC 的工序顺序都按它来。所以这里复制一份而不是各写一个「最大值 + 1」。
 */

import {roundTo, toNumberOrNull} from '@/utils';

/** 末尾追加时的步长：行号按 10 的倍数跳 */
export const ROW_NO_STEP = 10;

/** 取中时保留的小数位：10 与 15 取中是 12.5，截断成 12 再插一次就撞 */
const ROW_NO_DIGITS = 2;

function formatRowNo(value: number): string {
    return String(roundTo(value, ROW_NO_DIGITS));
}

/**
 * 算新行的行号。
 *
 * @param above 上方一行的行号（接口给的是字符串，这里什么类型都收）
 * @param below 下方一行的行号；**追加到末尾**时传 `undefined`
 * @returns 新行号；`null` 表示推不出来（上下行号相同或倒挂），调用方应提示用户
 */
export function nextRowNo(above: unknown, below: unknown): string | null {
    const aboveNo = Math.max(toNumberOrNull(above) ?? 0, 0);
    const belowNo = toNumberOrNull(below);

    // 末尾追加：下一个 10 的倍数（37 → 40，40 → 50；空表 → 10）
    if (belowNo === null) {
        return formatRowNo(Math.floor(aboveNo / ROW_NO_STEP) * ROW_NO_STEP + ROW_NO_STEP);
    }

    // 取不出「中间值」：上下行号相等 / 倒挂
    if (!(belowNo > aboveNo)) {
        return null;
    }

    return formatRowNo((aboveNo + belowNo) / 2);
}
