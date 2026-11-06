import {http, request} from '../../request';
import type {ApiResponse, PageQuery} from '../../types';
import {
    type ProcessRouteMatrix,
    type ProcessRouteMatrixRule,
    ProcessRouteMatrixRuleSchema,
    ProcessRouteMatrixSchema,
} from '../../schemas/nc/processRouteMatrix.ts';
import {sqlApi} from "@/api";
import {toStringOrEmpty} from "@/utils";

/**
 * 工艺路线矩阵接口。
 *
 * 类型与 schema 来自后端 OpenAPI 规范生成，别手改：
 *   node scripts/gen-api-schemas.mjs --path /nc/processRouteMatrix \
 *        --out src/api/schemas/nc/processRouteMatrix.ts
 *
 * 字段全部可空（`null | undefined`）是**如实反映后端**：Swagger 2.0 不标 nullable，
 * 但实测后端大量返回 `null`（如 `Detail: null`、`SizeMatch: null`）。
 * 当必填用之前先判空，别直接 `.map()` / `.split()`。
 *
 * ⚠️ 生成脚本只收了三个接口（list / detail / pushRule），保存与推送是**按包装 BOM
 * 那套接口的同名规律**写的（`/nc/bom/packBomMatrix/...` → `/nc/processRouteMatrix/...`）。
 * 接后端时先拿这三条核对一遍；若路径不同，只改这里，调用方不用动。
 */

/**
 * 工艺路线矩阵列表请求参数。
 *
 * 命名照主表的查询框（物料 / 项目）：后端接受哪些字段以实际接口为准，
 * 多传的会被忽略，不会报错，但别指望它生效。
 */
export type processRouteMatrixListReq = {
    MaterialCode?: string;
    MaterialName?: string;
    ProjectCode?: string;
}

/**
 * 工艺路线特性
 */
export type processRouteFeature = {
    Feature: string;
    PackMethod: string,
    PackNum: string,
    ProjectCode: string,
    ProjectID: string,
    SewMaterialVID: string,
}

export const processRouteMatrixApi = {

    /**
     * 工艺路线矩阵列表
     * @param params 查询条件
     * @param page   分页（从 1 起）
     */
    list: (params: processRouteMatrixListReq, page: PageQuery): Promise<ApiResponse<ProcessRouteMatrix[]>> =>
        http.postSchema('/nc/processRouteMatrix/list', ProcessRouteMatrixSchema.array(), params, {params: page}),

    /**
     * 工艺路线矩阵详情（含 `Detail` 工序明细与 `SizeMatch` 尺码工时）。
     *
     * GET /nc/processRouteMatrix?processRouteMatrixID=xxx
     */
    detail: (processRouteMatrixID: string): Promise<ApiResponse<ProcessRouteMatrix>> =>
        http.getSchema('/nc/processRouteMatrix', ProcessRouteMatrixSchema, {prMatrixID: processRouteMatrixID}),

    /**
     * 工艺矩阵推送规则（发布情况）。
     *
     * 一行一条规则（`ProcessRouteMatrixRule`），主键 `ProcessRouteMatrixRuleID`：
     * 一个矩阵按特征码拆成多条规则，每条规则各自推给下游 NC。
     */
    pushRules: (processRouteMatrixID: string): Promise<ApiResponse<ProcessRouteMatrixRule[]>> =>
        http.getSchema('/nc/processRouteMatrix/pushRule', ProcessRouteMatrixRuleSchema.array(), {
            prMatrixID: processRouteMatrixID,
        }),

    /**
     * 工艺路线矩阵保存。
     *
     * 入参是完整矩阵（头 + `Detail`），明细里的日期是 `YYYY-MM-DD` 字符串
     * （schema 里就是 string，不必像包装 BOM 那样在提交前转 `Cbeginperiod` / `Cendperiod`）。
     */
    save: (matrix: ProcessRouteMatrix): Promise<ApiResponse<ProcessRouteMatrix>> =>
        http.postSchema('/nc/processRouteMatrix/save', ProcessRouteMatrixSchema, matrix),

    /**
     * 推送（发布）。
     *
     * 入参是**规则主键**（`ProcessRouteMatrixRuleID`）数组，不是矩阵主键 ——
     * 与包装 BOM 的 push 同一语义。返回体只有 code / err，成功与否看有没有抛错。
     */
    push: async (ruleIDs: string[]): Promise<ApiResponse<void>> =>
        http.post('/nc/processRouteMatrix/pushRule/push', ruleIDs),

    /**
     * 取消推送。
     *
     * 与 push 同一套入参。**DELETE 带请求体**，而 `http.delete` 只收 query 参数，
     * 所以这里直接用 `request` 把 body 传下去。
     */
    cancelPush: async (ruleIDs: string[]): Promise<ApiResponse<void>> =>
        request<void>('DELETE', '/nc/processRouteMatrix/pushRule/cancelPush', {body: ruleIDs}),

    /**
     * 更新推送（把已发布的规则重新推一遍）。入参同 push。
     */
    updatePush: async (ruleIDs: string[]): Promise<ApiResponse<void>> =>
        http.post('/nc/processRouteMatrix/pushRule/updatePush', ruleIDs),

    /**
     * 删除一份工艺路线矩阵。
     */
    delete: async (processRouteMatrixID: string): Promise<ApiResponse<string>> =>
        http.delete<string>('/nc/processRouteMatrix/del', {prMatrixID: processRouteMatrixID}),

    /**
     * bom 特征码
     * @param packMaterialCode
     */
    features: async (packMaterialCode: string): Promise<ApiResponse<processRouteFeature[]>> => {
        const sql = "SELECT PackMethod,PackNum,ProjectID,ProjectCode,SewMaterialVID FROM [transitDB].dbo.NC_PackBomMatrix WHERE PackMaterialCode = ? AND IsDel = 0 GROUP BY PackMethod,PackNum,ProjectID,ProjectCode,SewMaterialVID"
        const result = await sqlApi.query({
            SQL: sql,
            Args: [packMaterialCode]
        })
        if (result.data && !result.data.IsError && result.data.DataVals && result.data.DataVals.length > 0) {
            return {
                code: 0, data: result.data.DataVals.map((row): processRouteFeature => {
                    return {
                        PackMethod: toStringOrEmpty(row['PackMethod']),
                        PackNum: toStringOrEmpty(row['PackNum']),
                        ProjectCode: toStringOrEmpty(row['ProjectCode']),
                        ProjectID: toStringOrEmpty(row['ProjectID']),
                        SewMaterialVID: toStringOrEmpty(row['SewMaterialVID']),
                        Feature: toStringOrEmpty(row['ProjectCode']) + "_" + toStringOrEmpty(row['PackMethod']) + "_" + toStringOrEmpty(row['PackNum']),
                    }
                })
            }
        }
        return {code: 0, data: []}
    }
};
