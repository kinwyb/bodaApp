/**
 * 包装 BOM 矩阵的三个标签页。
 *
 * 这份声明有两处消费者：控件（渲染 Tabs）与界面桥（说明「有哪几张表、用户在看哪张」）。
 * 所以**只此一份** —— 键名一旦分叉（比如 tab key 改成 `color`，桥里注册的表还叫 `colors`），
 * 症状是「表明明在、模型却说打不开」，而且不会报错。
 *
 * 键名同时是桥里那张表的 `name`，也就是取数命令的前缀：`items.page` / `colors.page` / `sizes.page`。
 */

/** 标签页 = 桥里那张表的名字（也是命令前缀） */
export type BomMatrixSection = 'items' | 'colors' | 'sizes';

export type BomMatrixSectionMeta = {
  key: BomMatrixSection;
  /** 标签页标题 */
  label: string;
};

export const BOM_MATRIX_SECTIONS: BomMatrixSectionMeta[] = [
    {key: 'items', label: '子项物料'},
    {key: 'colors', label: '配色'},
    {key: 'sizes', label: '配码'},
];

/** 默认停在第一页：子项物料是这份矩阵的主数据，配色/配码是它的两种投影 */
export const DEFAULT_BOM_MATRIX_SECTION: BomMatrixSection = 'items';

/** 键 → 标题；认不出就原样返回（宁可显示 `foo` 也不要显示空白） */
export function bomMatrixSectionLabel(key: string): string {
    return BOM_MATRIX_SECTIONS.find((item) => item.key === key)?.label ?? key;
}

/** 是不是一个合法的标签页键（桥的命令要校验参数） */
export function isBomMatrixSection(value: unknown): value is BomMatrixSection {
    return BOM_MATRIX_SECTIONS.some((item) => item.key === value);
}
