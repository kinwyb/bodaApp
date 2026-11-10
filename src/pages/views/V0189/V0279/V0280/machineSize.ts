import {YupaiMachineSizeHeader} from '@/api/modules/yupai';

/**
 * 尺码列标题是「寸/针」简写：12/960 = 12 寸 960 针机型。
 *
 * 用户口语常说「12寸960针」「960针的12寸机器」，agent 要能把这类说法
 * 映射到对应的 MCSize 字段，而不是按字段序号猜。
 */
export function describeMachineSize(title: string): string {
    const [inch, needles] = title.split('/').map((part) => part.trim());
    if (!inch || !needles) return title;
    return `${inch}寸${needles}针机型（列标题 ${title}）；` +
        `用户说「${inch}寸${needles}针」或「${needles}针${inch}寸机器」时就是这一列`;
}

/** MCSize 字段 → 机型说明，列表桥和编辑弹窗桥共用 */
export const MACHINE_SIZE_FIELD_HINTS: Record<string, string> = Object.fromEntries(
    YupaiMachineSizeHeader.map((title, index) => [
        `MCSize${index + 1}`,
        describeMachineSize(title),
    ]),
);

/** 页面术语：完整列出「标题 = 字段」，避免模型只看到标题时按顺序猜错 */
export const MACHINE_SIZE_GUIDE_TERM =
    '尺码分布列标题是「寸/针」机型简写：12/960 表示 12 寸 960 针机型，' +
    '13/1152 表示 13 寸 1152 针机型。用户说「12寸960针」「960针12寸机器」时要取 12/960 那一列。' +
    `完整对应：${YupaiMachineSizeHeader
        .map((title, index) => `${title}=MCSize${index + 1}`)
        .join('、')}`;
