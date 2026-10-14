import type {YupaiOrder} from "@/api";
import type {YupaiOrderLogCommandFactory} from "@/pages/views/V0189/V0279/V0280/command/types.ts";
import {CalendarOutlined} from "@ant-design/icons";
import {toNumberOrZero} from "@/utils";

/**
 * 只有当 Status 大于 0（状态已推进过）的预订单才允许看变更日志。
 * 没有激活行时（多选后 Ctrl+A 全选、选中被清空、只点了表头）也返回 false：按钮该是灰的。
 *
 * 返回类型写成类型谓词 `row is YupaiOrder`：调用处 `if (!canOpenChangeLog(activeRow)) return;`
 * 之后 TS 就能确定 activeRow 不是 null，不必再写一次 `if (!activeRow)`。
 *
 * 必须先挡空值：toNumberOrZero(null / undefined) 得到的就是 0，直接比较会把「没有激活行」
 * 误判成「可以打开」。用 toNumberOrZero 而不是 `=== 0`，是因为 Status 可能以字符串过来。
 */
function canOpenChangeLog(row: YupaiOrder | null): row is YupaiOrder {
    if (!row) return false;
    return toNumberOrZero(row.Status) > 0;
}

/**
 * 变更日志菜单按钮
 *
 * 用的是 YupaiOrderLogCommandFactory（这一组专属的工厂类型）而不是本页通用工厂：
 * 只有这组命令能解构出 openLog ——「打开日志弹窗」不进公共依赖，别的命令既拿不到也不关心它。
 *
 * 是否可用看**当前激活的那一行**（activeRow），而不是「有没有选中行」：
 * 多选时该看哪一单，取决于用户此刻聚焦的那一行。
 *
 * 注意 disabled 是渲染时算出来的，所以 activeRow 必须是会触发重渲染的 state ——
 * 页面接表格的 onSelectedChange 维护它（见 V0280/index.tsx 的 handleSelectedChange）。
 */
export const changeLogCommand: YupaiOrderLogCommandFactory = ({activeRow, openLog}) => ({
    key: "changeDate",
    label: "变更日志",
    icon: <CalendarOutlined/>,
    dividerBefore: true,
    disabled: !canOpenChangeLog(activeRow),
    onClick: () => {
        // 兜底：按钮本该已经禁用，这里防的是键盘 / 程序化触发
        if (!canOpenChangeLog(activeRow)) return;
        openLog(activeRow);
    }
})
