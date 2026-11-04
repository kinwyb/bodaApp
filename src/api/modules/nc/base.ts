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
    productor: (): Promise<ApiResponse<NCProductor[]>> =>
        http.getSchema('/nc/base/productor', NCDefdocSchema.array()),

    /**
     * 项目分类查询
     */
    projectClass: (): Promise<ApiResponse<NCProjectClass[]>> =>
        http.getSchema('/nc/base/project/class', NCProjectClassSchema.array()),

    /**
     * 项目按名称 / 编码查询（一次请求，不要求先选分类 —— 给 agent 查项目主键用）
     *
     * ⚠️ 后端这个接口带 `notExistCreate`（不存在就创建），默认值不能指望：
     * 这里**显式传 false** —— 查询就是查询，不能因为查了个不存在的项目号就在档案里造一条。
     *
     * @param keyword 项目号 / 项目名称（后端参数名是 `projectName`）
     */
    projectByName: (keyword: string): Promise<ApiResponse<NCProject[]>> =>
        // 参数走 query（第三个位置是 body，这里没有 body）
        http.postSchema('/nc/base/project/queryByName', NCProjectSchema.array(), undefined, {
            params: {projectName: keyword, notExistCreate: false},
        }),

    /**
     * 项目列表查询
     * @param params
     */
    projects: (params: PageQuery & { projectClassID?: string }): Promise<ApiResponse<NCProjects>> =>
        http.getSchema('/nc/base/project/queryWithPage', NCProjectsSchema, params)
};