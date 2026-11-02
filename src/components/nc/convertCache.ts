/**
 * 物料 → 「这个物料有哪些计量单位」（`NCMaterial.materialconvert`）的**同步缓存**。
 *
 * 为什么需要它：单位弹窗要按**这一行的物料**列出可选单位，而这份数据只有两条来路 ——
 * 随物料一起到手（用户选物料时 `NCMaterial.materialconvert` 就在手上），或者回查接口
 * （默认加载的明细行只有一个 `MaterialVID`）。缓存把两条路收敛成一个读口：
 *
 * - `putConverts`：选物料时**直接登记**，弹窗一打开就是满的，不再查一次接口；
 * - `readConverts` / `ensureConverts`：默认加载的行按需现查，同一物料只查一次
 *   （去重 + 失败冷却），查回来之后所有行共用。
 *
 * 为什么不把数组存到行上（`row.MaterialConvert = material.materialconvert`）：
 * - 行对象会被 `BomMatrixViewApi.readRows('items')` **原样**交给保存，多出来的数组会跟着 POST 回后端；
 * - `updateRow` 的 `fields` 会原样同步给配色 / 配码两张表，那边的行会凭空多一个数组字段；
 * - 行对象在 `useEditableRows` 里会被重新派生、整体替换，挂在上面的东西说没就没。
 * 缓存的键是**物料**而不是行：换单、插行、删行都不影响它，同一个物料出现在多行也只查一次。
 *
 * 缓存本体在 `@/utils/keyedCache`（**有容量上限，按 LRU 淘汰**）：模块级 Map 不会被组件卸载
 * 释放，没上限的话「用户选过的物料」会一直攒着。
 */
import {ncMaterialApi} from '@/api/modules/nc/material.ts';
import type {NCMaterialConvert} from '@/api/schemas/nc/NCMaterial.ts';
import {toStringOrEmpty} from '@/utils';
import {createKeyedAsyncCache} from '@/utils/keyedCache';

/** 缓存条目上限：一条最多十几个小对象，500 条足够覆盖来回改的物料 */
const MAX_ENTRIES = 500;

const convertCache = createKeyedAsyncCache<NCMaterialConvert[]>({
    maxEntries: MAX_ENTRIES,
    load: async (materialVID, materialCode) => {
        // 有编码就按编码查（「输入编码回车」走的就是这条，最稳），只拿到 VID 时才按主键查
        const result = await ncMaterialApi.query(materialCode ? {code: materialCode} : {materialPK: materialVID});
        const materials = result.data ?? [];
        // 优先认主键对得上的那条：按编码查可能带回同编码的其他版本
        const material = materials.find((item) => toStringOrEmpty(item.pk_material) === materialVID) ?? materials[0];
        // 查不到就返回 null = 这次没取到，不等同于「这个物料没有单位」，冷却后再试
        if (!material) return null;
        return material.materialconvert ?? [];
    },
});

/** 取到过就返回数组；**没取到过返回 `undefined`**（调用方据此决定是现查还是一直等） */
export function readConverts(materialVID: string): NCMaterialConvert[] | undefined {
    return convertCache.read(materialVID.trim());
}

/**
 * 直接登记一份现成的单位列表 —— **选物料那条路用它，不必回查接口**。
 *
 * 弹窗里选物料、格子里输编码回车，拿到的 `NCMaterial` 上就带着 `materialconvert`：
 * 写进来之后，这个物料的单位弹窗**立刻**有内容。
 */
export function putConverts(materialVID: string, converts: NCMaterialConvert[] | null | undefined): void {
    const id = materialVID.trim();
    if (!id) return;
    convertCache.put(id, converts ?? []);
}

/**
 * 确保缓存里有这个物料的单位列表：命中缓存立即返回，已在飞的请求复用，
 * 刚失败过的（冷却期内）直接给空数组（弹窗提示「没有可选单位」）。
 *
 * @param materialVID 物料主键（缓存键）
 * @param materialCode 物料编码：给了就按编码查，只拿到 VID 时才按主键查
 */
export function ensureConverts(materialVID: string, materialCode?: string): Promise<NCMaterialConvert[] | null> {
    const id = materialVID.trim();
    if (!id) return Promise.resolve([]);
    return convertCache.ensure(id, toStringOrEmpty(materialCode).trim() || undefined);
}
