/**
 * 包装 BOM 矩阵三张表的列定义。
 *
 * 放在 `.ts` 里而不是各自的 `.tsx` 里，有两个理由：
 * - `.tsx` 只导出组件（导出普通值会打断 Fast Refresh 边界，见 `@/components/grid-table` 的说明）；
 * - 界面桥需要**同一份列定义**：agent 认识一张表全靠它。视图与桥各写一份必然漂移
 *   （视图加了一列、桥不知道，模型就永远看不到那一列）。
 *
 * 配色与配码的列**跟着数据变**（`ColorSort` / `SizeSort` 有几个颜色/尺码就有几列），
 * 所以它们是函数；子项物料的是常量。
 */

import type {AppColumnDef, AppColumnGroupDef} from '@/components/grid-table';
import type {BomMatrix} from '@/api/schemas/nc/bomMatrix.ts';
import {toNumberOrZero, toStringOrEmpty} from '@/utils';
import {BackFlushTypeLabel, ItemSourceLabel} from './common.ts';

/**
 * 子项物料：一行一个子项物料，是这份矩阵的主数据（也是唯一可编辑的一张表）。
 *
 * 三张表里只有它用明细主键 `PackBomMatrixDetailID`；配色/配码是按
 * 「行号 + 物料VID」拼出来的行标识，见 `@/components/nc/bomMatrix/bridge`。
 */
export const ITEM_COLUMNS: AppColumnDef[] = [
    {field: 'VRowNo', title: '行号'},
    {field: 'ProjectMaterial', title: '项目专用', dataType: 'boolean'},
    {field: 'MaterialCode', title: '物料编码', minWidth: 150},
    {field: 'MaterialName', title: '物料名称'},
    {field: 'MaterialVersion', title: '物料版本'},
    {field: 'MaterialSpec', title: '物料规格'},
    {field: 'MaterialType', title: '物料型号'},
    {field: 'VFree5Name', title: '季度号/通用'},
    {field: 'VFree1Name', title: '款号'},
    {field: 'VFree9Name', title: '色纱色'},
    {field: 'Productor', title: '供应商'},
    {field: 'VFree8Name', title: '特性'},
    {field: 'Ndissipationum', title: '损耗系数'},
    {field: 'VFree4Name', title: '批号'},
    {field: 'CMeasure', title: '主单位'},
    {field: 'Nitemnum', title: '子项数量', dataType: 'int'},
    {field: 'Ibasenum', title: '底数', dataType: 'int'},
    {field: 'VChangerate', title: '换算率'},
    {field: 'Cassmeasure', title: '单位'},
    {field: 'Fitemsource', title: '备料来源', fieldFormat: (record) => ItemSourceLabel(record.Fitemsource)},
    {field: 'Bdeliver', title: '发料', dataType: 'boolean'},
    {field: 'Fbackflushtype', title: '倒冲方式', fieldFormat: (record) => BackFlushTypeLabel(record.Fbackflushtype)},
    {field: 'BeginDate', title: '生效日期', dataType: 'date'},
    {field: 'EndDate', title: '失效日期', dataType: 'date'},
    {field: 'Bupint', title: '向上取整', dataType: 'boolean'},
];

/** 配色/配码共有的「物料」分组：三张表按同一批子项物料分行，这几列一模一样 */
function materialGroup(fields: Array<{field: string; title: string}>): AppColumnGroupDef {
    return {
        title: '物料',
        children: fields.map((item) => ({...item})),
    };
}

/** 配色里显示的物料列（比子项物料少一些：颜色/尺码相关的属性在这里没意义） */
const MATCH_MATERIAL_FIELDS = [
    {field: 'VRowNo', title: '行号'},
    {field: 'MaterialCode', title: '物料编码'},
    {field: 'MaterialName', title: '物料名称'},
    {field: 'MaterialVersion', title: '物料版本'},
    {field: 'MaterialSpec', title: '物料规格'},
    {field: 'MaterialType', title: '物料型号'},
    {field: 'VFree5Name', title: '季度号/通用'},
];

/**
 * 配色：每列一个缝制颜色，格子里是该颜色下这个物料的色号。
 *
 * 颜色集合来自 `bomMatrix.ColorSort`，所以**列目录随数据变** —— 换一份 BOM 就是另一组列，
 * 那时结构指纹会变、桥会发整页快照，这是对的（模型确实没见过这些列）。
 */
export function buildColorColumns(bomMatrix: BomMatrix): AppColumnDef[] {
    const colors = (bomMatrix.ColorSort ?? []).filter((color): color is string => !!color);
    return [
        materialGroup([...MATCH_MATERIAL_FIELDS, {field: 'VFree4Name', title: '批号'}]),
        {
            title: '颜色',
            children: colors.map((color) => ({field: color, title: color, minWidth: 50})),
        },
    ];
}

/**
 * 配码：每个尺码三列（损耗数量 / 尺码系数 / 尺码用量），尺码集合来自 `bomMatrix.SizeSort`。
 *
 * 三组按尺码对齐并列（不是一组三层嵌套）：用户是横向比一个尺码的三个值，
 * 拆成三组后列头能把它们分开，扫一行时才不会串。
 */
export function buildSizeColumns(bomMatrix: BomMatrix): AppColumnDef[] {
    const sizes = (bomMatrix.SizeSort ?? []).filter((size): size is string => !!size);
    return [
        materialGroup([...MATCH_MATERIAL_FIELDS, {field: 'VFree4Name', title: '批号'}]),
        {
            title: '损耗数量',
            children: sizes.map((size) => ({
                field: `Sunhao${size}`,
                title: size,
                dataType: 'int' as const,
                minWidth: 50,
                // 0 不显示：这张表大部分格子是 0，全画出来等于一片噪声
                fieldFormat: (record: Record<string, unknown>) => {
                    const value = toNumberOrZero(record[`Sunhao${size}`]);
                    return value === 0 ? '' : toStringOrEmpty(value);
                },
            })),
        },
        {
            title: '尺码系数',
            children: sizes.map((size) => ({field: `S${size}`, title: size, minWidth: 50})),
        },
        {
            title: '尺码用量',
            children: sizes.map((size) => ({
                field: `N${size}`,
                title: size,
                dataType: 'int' as const,
                minWidth: 50,
            })),
        },
    ];
}
