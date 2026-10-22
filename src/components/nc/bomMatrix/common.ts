import {toNumberOrZero} from "@/utils";

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