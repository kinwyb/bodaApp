import {type ApiResponse, http} from "@/api";
import {NCDefdocSchema, type NCProductor} from "@/api/schemas/nc/NCBase.ts";


/**
 * nc基础资料接口
 */
export const ncBaseApi = {


    /**
     * 生产厂商查询
     * @param params
     */
    productor: async (): Promise<ApiResponse<NCProductor[]>> => {
        const res = await http.get('/nc/base/productor');
        if (res.data === undefined || res.data === null) {
            return {...res, data: undefined};
        }
        return {...res, data: NCDefdocSchema.array().parse(res.data)};
    }
};