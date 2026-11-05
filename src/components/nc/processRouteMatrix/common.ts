/**
 * 工艺路线明细里的枚举与编辑器。
 *
 * 这里只有一处枚举（`ProcessMoveType`）：工艺明细的其它「是 / 否」都是布尔列，
 * 由 `dataType: 'boolean'` 直接画成勾选框，不需要码表。
 */

import {registerAntdSelectEditor} from '@/components/grid-table/editors/register.ts';
import {toNumberOrZero} from '@/utils';

/**
 * 工序转移方式（`ProcessMoveType`）。
 *
 * 1 = 不转移、2 = 自动转移、3 = 手动转移 —— 与后端字段注释一致。
 * 未知值原样显示（宁可显示 `7` 也不要显示空白）。
 */
const ProcessMoveType: Record<number, string> = {
    1: '不转移',
    2: '自动转移',
    3: '手动转移',
};

/** 值 → 文案（列上显示用） */
export const ProcessMoveTypeLabel = (id: unknown): string =>
    ProcessMoveType[toNumberOrZero(id)] ?? String(toNumberOrZero(id));

/** 文案 → 值（反查用；码表只有三档，直接遍历） */
export const ProcessMoveTypeValue = (title: unknown): number => {
    const entry = Object.entries(ProcessMoveType).find(([, value]) => value === title);
    return toNumberOrZero(entry?.[0]);
};

/**
 * 下拉选项。
 *
 * value 用**字符串**：`registerAntdSelectEditor` 的 options 走 antd Select，
 * 选中值原样写回单元格，与包装 BOM 那边（`ItemSourceOptions` 等）保持同一口径，
 * 免得同一类枚举在两张表里一个回写 `2`、一个回写 `'2'`。
 */
export const ProcessMoveTypeOptions = Object.entries(ProcessMoveType)
    .map(([value, label]) => ({value, label}));

/**
 * 工序转移方式的编辑器。
 *
 * ⚠️ 编辑器注册是**全局同名先到先得**（见 `editors/register.ts` 的 `registerOnce`）：
 * 名字固定成一个具名实例，不要复用 `ANTD_SELECT_EDITOR` 这个公共名，
 * 否则将来某个页面用公共名注册了带校验的实例，这里的选项会被静默忽略。
 */
export const PROCESS_MOVE_TYPE_EDITOR = 'processRoute-move-type-editor';

registerAntdSelectEditor(PROCESS_MOVE_TYPE_EDITOR, {
    options: ProcessMoveTypeOptions,
});
