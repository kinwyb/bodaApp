import {type ApiResponse, http, type PageQuery} from "@/api";
import {
    NCDefdocSchema,
    type NCProductor,
    type NCProject,
    type NCProjectClass,
    NCProjectClassSchema,
    type NCProjects,
    NCProjectSchema,
    NCProjectsSchema
} from "@/api/schemas/nc/NCBase.ts";

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
    },

    /**
     * 项目分类查询
     */
    projectClass: async (): Promise<ApiResponse<NCProjectClass[]>> => {
        const res = await http.get('/nc/base/project/class');
        if (res.data === undefined || res.data === null) {
            return {...res, data: undefined};
        }
        return {...res, data: NCProjectClassSchema.array().parse(res.data)};
    },

    /**
     * 项目按名称 / 编码查询（一次请求，不要求先选分类 —— 给 agent 查项目主键用）
     *
     * ⚠️ 后端这个接口带 `notExistCreate`（不存在就创建），默认值不能指望：
     * 这里**显式传 false** —— 查询就是查询，不能因为查了个不存在的项目号就在档案里造一条。
     *
     * @param keyword 项目号 / 项目名称（后端参数名是 `projectName`）
     */
    projectByName: async (keyword: string): Promise<ApiResponse<NCProject[]>> => {
        const res = await http.post('/nc/base/project/queryByName', undefined, {
            params: {projectName: keyword, notExistCreate: false},
        });
        if (res.data === undefined || res.data === null) {
            return {...res, data: undefined};
        }
        return {...res, data: NCProjectSchema.array().parse(res.data)};
    },

    /**
     * 项目列表查询
     * @param params
     */
    projects: async (params: PageQuery & { projectClassID?: string }): Promise<ApiResponse<NCProjects>> => {
        const res = await http.get('/nc/base/project/queryWithPage', params);
        if (res.data === undefined || res.data === null) {
            return {...res, data: undefined};
        }
        return {...res, data: NCProjectsSchema.parse(res.data)};
    }
};