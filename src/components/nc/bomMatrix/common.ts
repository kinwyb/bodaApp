import {toNumberOrZero} from "@/utils";
import {registerAntdInputEditor, registerAntdSelectEditor} from "@/components/grid-table/editors/register.ts";

/**
 * 备料来源
 */
const ItemSource: Record<number, string> = {
    1: '备料',
    2: '领料',
    3: '传输'
};

/**
 * 获取备料来源名称
 * @param id
 * @constructor
 */
export const ItemSourceLabel = (id: unknown): string => ItemSource[toNumberOrZero(id)] ?? toNumberOrZero(id);

/**
 * 获取备料来源值
 * @param name
 * @constructor
 */
export const ItemSourceValue = (title: unknown): number => {
    const entry = Object.entries(ItemSource).find(([, value]) => value === title);
    return toNumberOrZero(entry?.[0]);
};

/**
 * 备料来源select选择项
 */
export const ItemSourceOptions = Object.entries(ItemSource).map((k) => ({value: k[0], label: k[1]}));


/**
 * 倒冲方式
 */
const BackFlushType: Record<number, string> = {
    1: '不倒冲',
    2: '自动倒冲',
    3: '交互式倒冲'
};

/**
 * 获取倒冲方式名称
 * @param id
 * @constructor
 */
export const BackFlushTypeLabel = (id: unknown): string => BackFlushType[toNumberOrZero(id)] ?? toNumberOrZero(id);

/**
 * 获取倒冲方式值
 * @param name
 * @constructor
 */
export const BackFlushTypeValue = (title: unknown): number => {
    const entry = Object.entries(BackFlushType).find(([, value]) => value === title);
    return toNumberOrZero(entry?.[0]);
};

/**
 * 倒冲方式select选择项
 */
export const BackFlushTypeOptions = Object.entries(BackFlushType).map((k) => ({value: k[0], label: k[1]}));

/**
 * 供应商编辑器
 */
export const BOMMATRIX_PRODUCTOR_EDITOR = 'bomMatrix-productor-editor';
registerAntdInputEditor(
    BOMMATRIX_PRODUCTOR_EDITOR,
    {
        onSearch: (value: string) => {
            console.log('productor search', value);
        }
    }
);

/**
 * 倒从方式编辑器
 */
export const BOMMATRIX_BACKFLUSHTYPE_EDITOR = 'bomMatrix-backflush-type-editor';
registerAntdSelectEditor(
    BOMMATRIX_BACKFLUSHTYPE_EDITOR,
    {
        options: BackFlushTypeOptions,
    }
)

/**
 * 物料来源编辑器
 */
export const BOMMATRIX_ITEMSOURCE_EDITOR = 'bomMatrix-itemsource-editor';
registerAntdSelectEditor(
    BOMMATRIX_ITEMSOURCE_EDITOR,
    {
        options: ItemSourceOptions,
    }
)

/**
 * 缝制颜色 / 缝制尺码对应的物料辅助属性项：**固定 `vfree6` / `vfree7`**。
 *
 * 三个地方必须同一口径：配色表的色号字典、配码表的尺码系数字典、
 * 以及「选了产成品后按它铺出颜色列 / 尺码列」（见 `models/bomMatrixEdit` 的 `sewSort`）。
 * 各写一份的话，某天改字段只会改到其中一处 —— 表现就是「按 vfree6 生成了列、
 * 双击却去查 vfree7 的字典」，格子里永远选不出东西。
 *
 * 配色 / 配码的**列名**就是字典项的 `name`（`红`、`260`），不是编码：
 * 两份 `Match` 里存的也是 `VFree6Name` / `VFree7Name`，编码只留在 `{列名}_val`。
 */
export const BOMMATRIX_COLOR_VFREE_FIELD = 'vfree6';
export const BOMMATRIX_SIZE_VFREE_FIELD = 'vfree7';

/**
 * 配色表的「色号」编辑器 —— **必须和 `MATERIAL_VFREE_EDITOR` 分开**。
 *
 * 原因不是「推不出字段名」那点小事，而是编辑器注册是「同名先到先得」
 * （`registerAntdInputEditor` 内部的 `registerOnce`）：两张表挂的是两个
 * `NCMaterialVFreeModal` 实例，共用一个名字时只有**先挂载**的那个能注册成功，
 * 点搜索按钮打开的就是它的弹窗、走它的 `viewProps` —— 于是配色表写死的
 * `vfreeField: 'vfree6'` 根本不会生效，留给后端的是颜色名（`红`），查不到数据。
 *
 * 一个 key 对应一个弹窗实例、一套 `viewProps`/回填逻辑，想让两张表各写各的，
 * 只能各用各的名字。注册本身由 `NCMaterialVFreeModal` 挂载时完成（`isEditor` 模式）。
 */
export const BOMMATRIX_COLOR_VFREE_EDITOR = 'bomMatrix-color-vfree-editor';

/**
 * 配码表的「尺码系数」编辑器 —— 同样与 `MATERIAL_VFREE_EDITOR` 分开。
 *
 * 理由与配色表那条完全一样（一个 key 只对应一个弹窗实例，见上）：
 * 这张表按 `vfree7` 取尺码，子项物料表按列名取，混用会把字段带错。
 * 注册由 `NCMaterialVFreeModal` 挂载时完成（`isEditor` 模式）。
 */
export const BOMMATRIX_SIZE_VFREE_EDITOR = 'bomMatrix-size-vfree-editor';

