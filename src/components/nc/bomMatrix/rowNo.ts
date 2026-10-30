/**
 * 子项物料新增行的行号（`VRowNo`）推算。
 *
 * 行号不只是给人看的序号：配色 / 配码两张表就是靠它跟子项物料对齐行的，
 * 所以新增行不能随手排一个号，得**挤进现有行号之间**：
 *
 * - 追加到最下面：取下一个 10 的倍数（现有 10/20/30 → 40；最后一行是 37 → 40），
 *   留出的空档下次插行还能用；
 * - 插在两行中间：取上下两行行号的**平均值**（10 与 20 → 15），不动已有的行号。
 *
 * 放在 `.ts` 里而不是 `itemView.tsx`：`.tsx` 只导出组件，混出函数会让 Fast Refresh 退化
 * （见 `@/components/grid-table` 的说明）；纯函数也方便单独验证。
 */

import {roundTo, toNumberOrNull} from '@/utils';

/** 末尾追加时的步长：行号按 10 的倍数跳 */
export const ROW_NO_STEP = 10;

/**
 * 取中时保留的小数位。
 *
 * 10 与 20 取中正好是 15；碰到 10 与 15 这种奇差，取中是 12.5 ——
 * 与其截断成 12（再插一次又撞），不如如实留小数，行号本身是字符串。
 */
const ROW_NO_DIGITS = 2;

function formatRowNo(value: number): string {
    return String(roundTo(value, ROW_NO_DIGITS));
}

/**
 * 算新行的行号。
 *
 * @param above 上方一行的行号（接口给的是字符串，这里什么类型都收）
 * @param below 下方一行的行号；**没有下方行**（追加到末尾）时传 `undefined`
 * @returns 新行号；`null` 表示推不出来（见表尾注释），调用方应提示用户而不是硬塞一个号
 *
 * 两条容易踩的边界：
 * - 「上方没有」（插到最上面）与「上方行号是空的」都按 **0** 计 —— 与「取平均」是同一条规则，
 *   结果必然小于下方行，不会插出一个比下方还大的号；
 * - 上下行号相同（或倒挂）时**不猜**：平均出来就是上方那个号，与现有行重复，
 *   让用户先调行号比静默写一个重复行号强。
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
