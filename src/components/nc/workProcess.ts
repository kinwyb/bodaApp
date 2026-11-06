/**
 * 基本工序（`NCWorkProcess`）的纯函数：本地匹配、回填字段、展示文本。
 *
 * 为什么不放在 `workProcessSelect.tsx` 里：`.tsx` 只导出组件（导出普通函数会打断
 * Fast Refresh 边界，见 `@/components/grid-table` 的说明）。这些函数表格与表单都要用：
 * - 表格（`processRouteMatrix/itemView`）：格子里输入回车时在本地筛，选中后回填整组字段；
 * - 表单（`workProcessSelect`）：同一套匹配规则，避免「格子里能筛出来、表单里筛不出来」。
 */

import type {NCWorkProcess} from '@/api/schemas/nc/NCBase.ts';

/**
 * 在本地全量列表里找一道工序。
 *
 * **工序没有「按编码 / 名称查一条」的接口**（只有全量列表），所以匹配只能在这里做。
 * 两轮、顺序不能换：
 * 1. 编码或名称**全等** —— 用户敲的是完整编码，命中就是它；
 * 2. 包含匹配 —— 只有一条时才算确定（用户敲「车缝」而档案里只有一条车缝）；
 *    多条时返回候选数，由调用方提示「去弹窗里选」——
 *    替用户挑第一条等于赌运气（与物料 / 项目选择器的口径一致）。
 */
export type WorkProcessMatch =
    | {kind: 'single'; process: NCWorkProcess}
    | {kind: 'many'; candidates: number}
    | {kind: 'none'};

export function matchWorkProcess(list: NCWorkProcess[], input: string): WorkProcessMatch {
    const text = input.trim();
    if (!text) return {kind: 'none'};
    const lower = text.toLowerCase();
    const codeOf = (item: NCWorkProcess) => (item.CrcCode ?? '').trim();
    const nameOf = (item: NCWorkProcess) => (item.CrcName ?? '').trim();

    const exact = list.filter((item) =>
        codeOf(item) === text || nameOf(item) === text
        // 编码不区分大小写：档案里多是 `CZ001` 这种，用户常敲成小写
        || codeOf(item).toLowerCase() === lower,
    );
    if (exact.length === 1) return {kind: 'single', process: exact[0]};
    if (exact.length > 1) return {kind: 'many', candidates: exact.length};

    const contains = list.filter((item) =>
        codeOf(item).toLowerCase().includes(lower) || nameOf(item).includes(text),
    );
    if (contains.length === 1) return {kind: 'single', process: contains[0]};
    if (contains.length > 1) return {kind: 'many', candidates: contains.length};
    return {kind: 'none'};
}

/**
 * 选中一道工序后要回填的字段（表格行与表单共用）。
 *
 * 为什么不止编码 + 名称：工序档案还带操作要求、检测点 / 报告点 / 交接点 ——
 * 原系统里选完工序这几列就跟着变，用户不该再手填一遍。少回填一个，
 * 后面保存的工艺路线就会缺那一条标记。
 *
 * `CheckPoint` / `CountPoint` / `HandOverPoint` 在 schema 里已经由 `'Y'` 转成 boolean
 * （见 `NCWorkProcessSchema` 的 transform），写进表格的 boolean 列即可。
 */
export function workProcessFields(process: NCWorkProcess): Record<string, unknown> {
    return {
        CrcID: process.CrcID,
        CrcCode: process.CrcCode,
        CrcName: process.CrcName,
        CrcDesc: process.CrcDesc,
        CraftNote: process.CraftNote,
        CheckPoint: process.CheckPoint,
        CountPoint: process.CountPoint,
        HandOverPoint: process.HandOverPoint,
    };
}

/**
 * 工序被清空时要一起清掉的字段 —— 与 `workProcessFields` **成对使用**。
 *
 * 只清编码、留着名称 / 操作要求 / 检测点会得到一行「没有工序、却带着上一道工序属性」的
 * 假数据：保存时后端按行存下去，下次打开就分不清这一行到底是什么工序。
 *
 * 与包装 BOM 里「清空物料 → 名称 / 版本 / 规格一起清」同一个口径
 * （见 `V0354/models/bomMatrixEdit` 的 `clearPackMaterial`）。
 */
export function emptyWorkProcessFields(): Record<string, unknown> {
    return {
        CrcID: '',
        CrcName: '',
        CrcDesc: '',
        CraftNote: '',
        CheckPoint: false,
        CountPoint: false,
        HandOverPoint: false,
    };
}

/** 展示文本：`CZ001 车缝`（空值不显示多余空格） */
export function workProcessLabel(process: NCWorkProcess | undefined): string {
    if (!process) return '';
    const code = (process.CrcCode ?? '').trim();
    const name = (process.CrcName ?? '').trim();
    if (code && name) return `${code} ${name}`;
    return code || name;
}
