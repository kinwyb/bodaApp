import type {YupaiOrder} from "@/api";
import type {YupaiOrderCommandFactory} from "@/pages/views/V0189/V0279/V0280/command/types.ts";
import {CalendarOutlined} from "@ant-design/icons";
import {toNumberOrZero} from "@/utils";

/**
 * 变更日志只对 Status === 0 的预订单开放 —— 状态一旦推进（非 0）就不再开放。
 * 没有激活行时（多选后 Ctrl+A 全选、选中被清空、只点了表头）也返回 false：按钮该是灰的。
 */
function canOpenChangeLog(row: YupaiOrder | null): boolean {
    // 必须先挡空值：toNumberOrZero(null/undefined) 得到的就是 0，
    // 直接比较会把「没有激活行」错判成「Status 为 0、可以打开」。
    if (!row) return false;
    // 用 toNumberOrZero 而不是 === 0：Status 可能以字符串 "0" 的形式过来
    return toNumberOrZero(row.Status) > 0;
}

/**
 * 变更日志菜单按钮
 *
 * 是否可用看**当前激活的那一行**（activeRow），而不是「有没有选中行」：
 * 多选时该看哪一单，取决于用户此刻聚焦的那一行。
 *
 * 注意 disabled 是渲染时算出来的，所以 activeRow 必须是会触发重渲染的 state ——
 * 页面接表格的 onSelectedChange 维护它（见 V0280/index.tsx 的 handleSelectedChange）。
 */
export const changeLogCommand: YupaiOrderCommandFactory = ({message, activeRow}) => ({
    key: "changeDate",
    label: "变更日志",
    icon: <CalendarOutlined/>,
    dividerBefore: true,
    disabled: !canOpenChangeLog(activeRow),
    onClick: () => {
        // 兜底：按钮本该已经禁用，这里防的是键盘 / 程序化触发
        if (!canOpenChangeLog(activeRow)) return;
        message.success("变更日志")
    }
})
