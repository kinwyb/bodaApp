import {http, request} from '../../request';
import type {ApiResponse, PageQuery} from '../../types';
import {
    type PackBomMatrix,
    type PackBomMatrixRule,
    PackBomMatrixRuleSchema,
    PackBomMatrixSchema,
} from '../../schemas/nc/bomMatrix.ts';
import {sqlApi} from "@/api";
import {isBlank, toStringOrEmpty} from "@/utils";

/**
 * 包装bom列表请求参数
 */
export type packBomMatrixListReq = {
    PackMaterialName?: string;
    PackMaterialCode?: string;
    ProjectCode?: string;
}

/**
 * 包装 BOM 矩阵。
 *
 * 类型与 schema 都来自后端 OpenAPI 规范生成，别手改：
 *   node scripts/gen-api-schemas.mjs --path /nc/bom/packBomMatrix \
 *        --out src/api/schemas/nc/packBomMatrix.ts
 *
 * 字段全部可空（`null | undefined`）是**如实反映后端**，不是偷懒：
 * Swagger 2.0 不标 nullable，但实测后端大量返回 `null`（如 `Detail: null`、
 * `ColorMatch: null`）。当必填用之前先判空，别直接 `.map()` / `.split()`。
 *
 * 明细行类型是 `PackBomMatrixDetail`，从 schema 文件导出，直接：
 *   import type {PackBomMatrixDetail} from '@/api/schemas/nc/packBomMatrix';
 */

export const packBomMatrixApi = {

    /**
     * 包装 BOM 矩阵列表
     * @param params
     */
    list: (params: packBomMatrixListReq, page: PageQuery): Promise<ApiResponse<PackBomMatrix[]>> =>
        http.postSchema('/nc/bom/packBomMatrix/list', PackBomMatrixSchema.array(), params, {params: page}),

    /**
     * 包装 BOM 矩阵详情。
     *
     * GET /nc/bom/packBomMatrix?packBomMatrixID=xxx
     */
    detail: (packBomMatrixID: string): Promise<ApiResponse<PackBomMatrix>> =>
        http.getSchema('/nc/bom/packBomMatrix', PackBomMatrixSchema, {packBomMatrixID}),

    /**
     * 包装 BOM 矩阵发布情况
     * @param packBomMatrixID
     */
    pushRules: (packBomMatrixID: string): Promise<ApiResponse<PackBomMatrixRule[]>> =>
        http.getSchema('/nc/bom/packBomMatrix/pushRule', PackBomMatrixRuleSchema.array(), {packBomMatrixID}),

    /**
     * 包装 BOM 矩阵推送（发布）。
     *
     * 入参是**规则主键**（`PackBomMatrixRuleID`）数组，不是矩阵主键：
     * 一个矩阵按特征码拆成多条规则，每条规则各自推给下游 NC。
     * 接口返回体只有 code / err，没有 data —— 成功与否看有没有抛错。
     */
    push: async (ruleIDs: string[]): Promise<ApiResponse<void>> => {
        return http.post('/nc/bom/packBomMatrix/pushRule/push', ruleIDs);
    },

    /**
     * 包装 BOM 矩阵取消推送。
     *
     * 与 push 同一套入参（规则主键数组）。**DELETE 带请求体**，而 `http.delete`
     * 只收 query 参数，所以这里直接用 `request` 把 body 传下去。
     */
    cancelPush: async (ruleIDs: string[]): Promise<ApiResponse<void>> => {
        return request<void>('DELETE', '/nc/bom/packBomMatrix/pushRule/cancelPush', {body: ruleIDs});
    },

    /**
     * 包装 BOM 矩阵更新（把已发布的规则重新推一遍）。
     *
     * 入参同 push。
     */
    updatePush: async (ruleIDs: string[]): Promise<ApiResponse<void>> => {
        return http.post('/nc/bom/packBomMatrix/pushRule/updatePush', ruleIDs);
    },

    /**
     * 包装 BOM 矩阵保存
     * @param bomMatrix
     */
    save: (bomMatrix: PackBomMatrix): Promise<ApiResponse<PackBomMatrix>> =>
        http.postSchema('/nc/bom/packBomMatrix/save', PackBomMatrixSchema, bomMatrix),

    /**
     * 检测包装 BOM 矩阵是否重复，false代表不重复，true代表重复，检测范围：包装物料+项目号+包装方法+包装数量
     */
    duplicate: async (bomMatrixID: string, packMaterialCode: string, projectCode: string, packMethod: string, packNum: string): Promise<boolean> => {
        const query = "SELECT PackBomMatrixID FROM [transitDB].dbo.NC_PackBomMatrix WHERE IsDel = 0 AND PackMaterialCode = ? AND ProjectCode = ? AND PackMethod = ? AND PackNum = ? ";
        const result = await sqlApi.query({
            SQL: query,
            Args: [packMaterialCode, projectCode, packMethod, packNum]
        })
        if (result.data && !result.data.IsError && result.data.DataVals && result.data.DataVals.length > 0) {
            const mid = toStringOrEmpty(result.data.DataVals[0].PackBomMatrixID)
            return !isBlank(mid) && mid !== bomMatrixID
        }
        return false;
    },
    /**
     * 包装 BOM 矩阵删除
     * @param id
     */
    delete: async (id: string): Promise<ApiResponse<string>> => http.delete<string>('/nc/bom/packBomMatrix/del', {packBomMatrixID: id})
};
