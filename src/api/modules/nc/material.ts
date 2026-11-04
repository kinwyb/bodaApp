import {type ApiResponse, http} from "@/api";
import {
    type NCMaterial,
    type NCMaterialClassTree,
    NCMaterialClassTreeSchema,
    NCMaterialSchema,
    type NCMaterialVFree,
    NCMaterialVFreeSchema
} from "@/api/schemas/nc/NCMaterial.ts";

export type NCMaterialQuery = {
    code?: string;
    name?: string;
    pkClass?: string;
    materialPK?: string;
}

export type NCMaterialVFreeQuery = {
    fieldName: string;
    pkMaterial: string;
}

/**
 * nc物料相关接口
 */
export const ncMaterialApi = {

    /**
     * 物料分类树
     */
    classTree: (): Promise<ApiResponse<NCMaterialClassTree[]>> =>
        http.getSchema('/nc/material/materialClassTree', NCMaterialClassTreeSchema.array()),

    /**
     * 物料查询
     * @param params
     */
    query: (params: NCMaterialQuery): Promise<ApiResponse<NCMaterial[]>> =>
        http.postSchema('/nc/material/query', NCMaterialSchema.array(), params),

    /**
     * 物料辅助属性查询
     * @param params
     */
    vfree: (params: NCMaterialVFreeQuery): Promise<ApiResponse<NCMaterialVFree[]>> =>
        http.postSchema('/nc/material/queryVFree', NCMaterialVFreeSchema.array(), params),

    /**
     * 物料可用的辅助属性
     * @param materialVID
     */
    useVFree: async (materialVID: string) => http.get<string[]>('/nc/material/queryUseVFree', {materialPK: materialVID})
};