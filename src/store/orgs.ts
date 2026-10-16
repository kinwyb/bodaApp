import {toStringOrEmpty} from "@/utils";

/** 组织机构 id -> 工厂名 */
export const ORGS: Record<string, string> = {
    '0001E610000000KO20VW': '义乌工厂',
    '0001E610000000KWHO9D': '越南工厂',
    '0001E610000000KKY2HO': '供应链',
    '0001E610000000KZ5SLF': '顺杰',
    '0001E610000000KWBIIM': '硕杰',
};

/**
 * 获取组织名称
 * @param id
 * @constructor
 */
export const ORG_NAME = (id: unknown): string => ORGS[toStringOrEmpty(id)] ?? toStringOrEmpty(id);

/**
 * 获取组织ID
 * @param name
 * @constructor
 */
export const ORG_ID = (name: unknown): string => {
    const entry = Object.entries(ORGS).find(([, value]) => value === name);
    return toStringOrEmpty(entry?.[0]);
};