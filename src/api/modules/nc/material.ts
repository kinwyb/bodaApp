import {type ApiResponse, http} from "@/api";
import {
    type NCMaterial,
    type NCMaterialClassTree,
    NCMaterialClassTreeSchema,
    NCMaterialSchema
} from "@/api/schemas/nc/NCMaterial.ts";

export type NCMaterialQuery = {
    Code?: string;
    Name?: string;
    PkClass?: string;
    ID?: string;
}

/**
 * nc物料相关接口
 */
export const ncMaterialApi = {

    /**
     * 物料分类树
     */
    classTree: async (): Promise<ApiResponse<NCMaterialClassTree[]>> => {
        const res = await http.get('/nc/material/materialClassTree');
        if (res.data === undefined || res.data === null) {
            return {...res, data: undefined};
        }
        return {...res, data: NCMaterialClassTreeSchema.array().parse(res.data)};
    },

    /**
     * 物料查询
     * @param params
     */
    query: async (params: NCMaterialQuery): Promise<ApiResponse<NCMaterial[]>> => {
        const res = await http.post('/nc/material/query', params);
        if (res.data === undefined || res.data === null) {
            return {...res, data: undefined};
        }
        return {...res, data: NCMaterialSchema.array().parse(res.data)};
    }
};