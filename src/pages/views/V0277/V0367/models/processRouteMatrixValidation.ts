/**
 * 工艺路线矩阵保存前的校验。
 *
 * 与装配（`./processRouteMatrixPayload`）分开：改规则不必翻装配代码，反之亦然。
 * 只返回**人话问题列表**（空 = 通过），不返回「能不能存」—— 调用方拿 `length === 0` 判断，
 * 不必再包一层 `ok` 字段。
 *
 * 规则不多，但每一条都是「存进去就会错」的：
 * 1. 物料必填 —— 矩阵是「某个物料的工艺路线」，没有物料等于挂到空气上；
 * 2. 至少一行工序 —— 空矩阵推到下游 NC 只会把已有工艺冲掉；
 * 3. 每行要有工序（编码或名称）—— 只有行号的行不是工序；
 * 4. 行号不能重复 —— 行号是工艺顺序的排序键，重复之后「谁在谁前面」说不清。
 *
 * 行内问题**最多列 8 条**：一屏列表被几十条淹没时用户只会关掉弹窗。
 */

import {rowHasProcess} from '@/components/nc/processRouteMatrix/rows.ts';
import {toStringOrEmpty} from '@/utils';

/** 弹窗最多显示几条问题 */
const MAX_MESSAGES = 8;

export type ProcessRouteValidationInput = {
    /** 表单里的物料编码（`MaterialCode`） */
    materialCode: unknown;
    /** 工序明细的当前行（含末尾那行空行，内部按 `rowHasProcess` 过滤） */
    detail: Array<Record<string, unknown>>;
};

/** 返回问题列表：空数组 = 可以保存 */
export function validateProcessRouteMatrix(input: ProcessRouteValidationInput): string[] {
    const messages: string[] = [];

    if (toStringOrEmpty(input.materialCode).trim() === '') {
        messages.push('请先选择物料');
    }

    const rows = input.detail.filter(rowHasProcess);
    if (rows.length === 0) {
        messages.push('至少填一行工序明细');
        return messages;
    }

    // 行号重复：用 Set 记第一次出现的位置，第二次撞上就报
    const seenRowNo = new Map<string, number>();
    rows.forEach((row, index) => {
        const rowNo = toStringOrEmpty(row.VRowNo).trim();
        if (!rowNo) return;
        const first = seenRowNo.get(rowNo);
        if (first === undefined) {
            seenRowNo.set(rowNo, index);
            return;
        }
        messages.push(`第 ${first + 1} 行与第 ${index + 1} 行的行号都是 ${rowNo}，请调整后再保存`);
    });

    /*
     * 行内缺工序名：能进到这里的行已经「有工序」（`rowHasProcess` 的判据是编码/名称/ID
     * 任一非空），所以这里只提示「只有编码、没名称」那种半截数据 —— 名称是给人看的，
     * 下游工艺文件里也按名称显示。
     */
    rows.forEach((row, index) => {
        if (toStringOrEmpty(row.CrcName).trim() !== '') return;
        messages.push(`第 ${index + 1} 行还没填工序名称`);
    });

    if (messages.length > MAX_MESSAGES) {
        return [...messages.slice(0, MAX_MESSAGES), `另有 ${messages.length - MAX_MESSAGES} 处问题未显示`];
    }
    return messages;
}
