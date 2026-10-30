/**
 * 配色 / 配码的匹配数据（`ColorMatch` / `SizeMatch`）—— 保存前**按表格行反推**。
 *
 * 这两份 match 是接口给的**原始数据**，不是界面状态的副本：界面上增行 / 删行 / 改物料
 * 一概不动它们（动了就是拿界面状态覆盖原始数据，用户不保存也撤不回来）。
 * 它们与界面上的配码 / 配色对齐的时刻只有一个 —— **保存**，也就是本文件这两个函数。
 *
 * 入参是**表格自己的行数据**（`BomMatrixViewApi.readRows('sizes' | 'colors')`）：
 * 尺码用量、色号只活在配码/配色表的行上（`Sunhao{尺码}` / `S{尺码}` / `S{尺码}_val` /
 * `N{尺码}`、`{颜色}` / `{颜色}_val`），明细行里根本没有这些字段 ——
 * 用明细去拼 match，等于把用户在表里改的配码值全丢掉、只把接口原始值抄回来。
 *
 * 保存时：
 *
 * ```ts
 * const SizeMatch = rebuildSizeMatch(api.readRows('sizes'), bomMatrix.SizeSort ?? []);
 * const ColorMatch = rebuildColorMatch(api.readRows('colors'), bomMatrix.ColorSort ?? []);
 * ```
 *
 * （`readRows` 自己处理了「那张表没挂载过」的兜底，拿到的就是用户屏幕上那批行。）
 */

import type {BomMatrix, BomMatrixColorMatch, BomMatrixSizeMatch} from '@/api/schemas/nc/bomMatrix.ts';
import {colorCells, matchRowKey, sizeCells} from './rows.ts';
import {toStringOrEmpty} from '@/utils';

/**
 * 行里没值的格子写成什么。
 *
 * 数值类给 `'0'` 而不是 `''`：这几个字段在业务上都是数字（损耗数量 / 尺码用量），
 * 空串会让后端 `parseInt` 得到 `NaN`；系数名 / 色号名这类文本留空即可。
 * 要改成「不写这一格」或「空串」，只动这两个常量。
 */
const EMPTY_SIZE_MATCH: BomMatrixSizeMatch = {
    Nbfixshrinknum: '0',
    VFree7: '',
    VFree7Name: '',
    Nitemnum: '0',
};

const EMPTY_COLOR_MATCH: BomMatrixColorMatch = {
    VFree6: '',
    VFree6Name: '',
};

/** 行上某个格子取文本：不存在 / null 一律空串 */
const cell = (row: Record<string, unknown>, field: string): string => toStringOrEmpty(row[field]);

/**
 * 按配码表的行重建 `SizeMatch`：`[尺码][行键] → {损耗数量, 尺码系数, 尺码用量}`。
 *
 * 每行、每个尺码都会有一条；行里没有这个格子的值时给 `EMPTY_SIZE_MATCH`。
 * 行键用 `matchRowKey` **现算**（`行号_物料VID`），不是行里存的某个字段 ——
 * 用户改过物料/行号之后，算出来的就是新的键，旧键自然不出现。
 *
 * @param rows  配码表的行（`readRows('sizes')`）
 * @param sizes 尺码列（`matrix.SizeSort`）—— 只输出这些列，列删了数据也不该留着
 */
export function rebuildSizeMatch(
    rows: Record<string, unknown>[],
    sizes: Array<string | null | undefined>,
): NonNullable<BomMatrix['SizeMatch']> {
    const next: NonNullable<BomMatrix['SizeMatch']> = {};
    for (const size of sizes) {
        if (!size) continue;
        const fields = sizeCells(size);
        const cells: Record<string, BomMatrixSizeMatch> = {};
        for (const row of rows) {
            const key = matchRowKey(row);
            if (!key || key === '_') continue;
            const hasValue =
                row[fields.sunhao] !== undefined ||
                row[fields.name] !== undefined ||
                row[fields.value] !== undefined ||
                row[fields.number] !== undefined;
            cells[key] = hasValue
                ? {
                    Nbfixshrinknum: cell(row, fields.sunhao),
                    // 显示名与编码分两列存（`S{尺码}` 是名、`S{尺码}_val` 是编码）
                    VFree7Name: cell(row, fields.name),
                    VFree7: cell(row, fields.value),
                    Nitemnum: cell(row, fields.number),
                }
                : {...EMPTY_SIZE_MATCH};
        }
        next[size] = cells;
    }
    return next;
}

/**
 * 按配色表的行重建 `ColorMatch`：`[颜色][行键] → {色号名, 色号编码}`。
 *
 * 规则与 `rebuildSizeMatch` 一致（那边写清了，这里不重复）。
 *
 * @param rows   配色表的行（`readRows('colors')`）
 * @param colors 颜色列（`matrix.ColorSort`）
 */
export function rebuildColorMatch(
    rows: Record<string, unknown>[],
    colors: Array<string | null | undefined>,
): NonNullable<BomMatrix['ColorMatch']> {
    const next: NonNullable<BomMatrix['ColorMatch']> = {};
    for (const color of colors) {
        if (!color) continue;
        const fields = colorCells(color);
        const cells: Record<string, BomMatrixColorMatch> = {};
        for (const row of rows) {
            const key = matchRowKey(row);
            if (!key || key === '_') continue;
            const hasValue = row[fields.name] !== undefined || row[fields.value] !== undefined;
            cells[key] = hasValue
                ? {
                    VFree6Name: cell(row, fields.name),
                    VFree6: cell(row, fields.value),
                }
                : {...EMPTY_COLOR_MATCH};
        }
        next[color] = cells;
    }
    return next;
}
