/**
 * BOM 矩阵三张表（子项物料 / 配色 / 配码）的**行模型与转换**。
 *
 * ⚠️ 三张表**各自持有自己的行数据**，谁也别共享行对象：一张表在编辑、另一张表在别处，
 * 共享对象会让「改了这边那边跟着变、但又不知道该不该重绘」变得不可控。
 * 表与表之间只通过 `./gridApi.ts` 的**行级命令**（新增 / 删除 / 按 key 更新字段）同步 ——
 * 一张表的行就是它自己的，跨表只对齐「同一个 key 指的是同一行」。
 *
 * 行标识（跨表同步用）：`PackBomMatrixDetailID` —— 明细主键，未保存的新行是 `draft-N`。
 * 它与 match 的外层键不是一回事：`ColorMatch` / `SizeMatch` 用「行号_物料VID」（`matchRowKey`），
 * 那个键会随改物料变，只适合保存时现算，不适合当表格 rowKey（变了表格会把同一行当新行）。
 */

import type {BomMatrix, BomMatrixDetail} from '@/api/schemas/nc/bomMatrix.ts';
import {toStringOrEmpty} from '@/utils';

/**
 * 一行数据：明细字段打底，再挂上尺码 / 颜色格子（动态列）。
 *
 * 三张表的行长得一样（都是明细字段 + 一堆动态列），区别只在**各自显示/编辑哪些列**，
 * 以及**各自持有自己的实例**。所以共用一个类型即可，别把它理解成「共享一份数据」。
 */
export type BomMatrixRow = Partial<BomMatrixDetail> & {
    /** 行标识：明细主键 / 新行 `draft-N`。三张表的 rowKey 与跨表同步都用它 */
    PackBomMatrixDetailID: string;
    /** 动态列：`Sunhao260` / `S260` / `S260_val` / `N260` / `红` / `红_val` … */
    [key: string]: unknown;
};

/** 行标识（跨表同步的 key）；拿不到时是空串 */
export const rowKeyOf = (row: Record<string, unknown> | undefined): string =>
    String(row?.PackBomMatrixDetailID ?? '');

/**
 * 配码 / 配色在 `SizeMatch` / `ColorMatch` 里的**外层键**：`行号_物料VID`。
 *
 * 只此一份实现（保存时现算）。行号业务唯一所以不会撞；键里带物料，
 * 所以换物料等于换一行 —— 不同物料的尺码用量本来就不能沿用。
 */
export function matchRowKey(row: {VRowNo?: unknown; MaterialVID?: unknown}): string {
    return toStringOrEmpty(row.VRowNo) + '_' + toStringOrEmpty(row.MaterialVID);
}

/** 尺码格子的四个列名：损耗数量 / 系数名 / 系数编码 / 尺码用量 */
export function sizeCells(size: string): {sunhao: string; name: string; value: string; number: string} {
    return {sunhao: `Sunhao${size}`, name: `S${size}`, value: `S${size}_val`, number: `N${size}`};
}

/** 颜色格子的两个列名：色号名 / 色号编码 */
export function colorCells(color: string): {name: string; value: string} {
    return {name: color, value: `${color}_val`};
}

/** 明细行 → 矩阵行的底子：明细字段原样保留，参与行定位/取键的几个字段统一成字符串 */
function detailToRow(detail: BomMatrixDetail): BomMatrixRow {
    return {
        ...detail,
        PackBomMatrixDetailID: toStringOrEmpty(detail.PackBomMatrixDetailID),
        VRowNo: toStringOrEmpty(detail.VRowNo),
        MaterialVID: toStringOrEmpty(detail.MaterialVID),
    };
}

/** 明细 → 子项物料行：只是把关键字段统一成字符串，内容不动（这张表编辑的就是明细本身） */
export function toItemRows(items: BomMatrixDetail[]): BomMatrixRow[] {
    return items.map(detailToRow);
}

/**
 * 明细 → 配码行：明细字段 + 各尺码的四个格子（`SizeMatch[尺码][行键]`）。
 *
 * 两个用途：① 配码表**首次挂载 / 换矩阵**时初始化自己的行数据；
 * ② 配码表**没挂载过**时，保存流程用它现算一份（没挂载 = 用户没编辑过，与接口数据等价）。
 * 之后配码表的增删改都走它自己的命令 API，不会再调这里 —— 重算一次就把编辑冲掉了。
 */
export function toSizeRows(matrix: BomMatrix, items: BomMatrixDetail[]): BomMatrixRow[] {
    const sizes = (matrix.SizeSort ?? []).filter((size): size is string => !!size);
    return items.map((detail) => {
        const row = detailToRow(detail);
        const key = matchRowKey(row);
        sizes.forEach((size) => {
            const cell = matrix.SizeMatch?.[size]?.[key];
            if (!cell) return;
            const fields = sizeCells(size);
            row[fields.sunhao] = cell.Nbfixshrinknum;
            row[fields.name] = cell.VFree7Name;
            row[fields.value] = cell.VFree7;
            row[fields.number] = cell.Nitemnum;
        });
        return row;
    });
}

/**
 * 明细 → 配色行：明细字段 + 各颜色的两个格子（`ColorMatch[颜色][行键]`）。
 *
 * 用途与 `toSizeRows` 相同（初始化 / 未挂载时的兜底），理由不再重复。
 */
export function toColorRows(matrix: BomMatrix, items: BomMatrixDetail[]): BomMatrixRow[] {
    const colors = (matrix.ColorSort ?? []).filter((color): color is string => !!color);
    return items.map((detail) => {
        const row = detailToRow(detail);
        const key = matchRowKey(row);
        colors.forEach((color) => {
            const cell = matrix.ColorMatch?.[color]?.[key];
            if (!cell) return;
            const fields = colorCells(color);
            row[fields.name] = cell.VFree6Name;
            row[fields.value] = cell.VFree6;
        });
        return row;
    });
}
