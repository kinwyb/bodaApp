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
 * 物料辅助属性编辑器
 */
export const BOMMATRIX_MATERIAL_VFREE_EDITOR = 'bomMatrix-material-vfree-editor';
registerAntdInputEditor(
    BOMMATRIX_MATERIAL_VFREE_EDITOR,
    {
        onSearch: (value: string) => {
            console.log('material vfree search', value);
        }
    }
);

/**
 * 单位编辑器
 */
export const BOMMATRIX_MEASURE_EDITOR = 'bomMatrix-measure-editor';
registerAntdInputEditor(
    BOMMATRIX_MEASURE_EDITOR,
    {
        onSearch: (value: string) => {
            console.log('measure search', value);
        }
    }
);

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
 * 颜色编辑器
 */
export const BOMMATRIX_COLOR_EDITOR = 'bomMatrix-color-editor';
registerAntdInputEditor(
    BOMMATRIX_COLOR_EDITOR,
    {
        onSearch: (value: string) => {
            console.log('color search', value);
        }
    }
);

/**
 * 尺码编辑器
 */
export const BOMMATRIX_SIZE_EDITOR = 'bomMatrix-size-editor';
registerAntdInputEditor(
    BOMMATRIX_SIZE_EDITOR,
    {
        onSearch: (value: string) => {
            console.log('size search', value);
        }
    }
);

