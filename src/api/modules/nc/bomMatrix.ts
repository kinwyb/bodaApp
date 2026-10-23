import {http} from '../../request';
import type {ApiResponse} from '../../types';
import {type BomMatrix, BomMatrixSchema,} from '../../schemas/nc/bomMatrix.ts';

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
     * 包装 BOM 矩阵详情。
     *
     * GET /nc/bom/packBomMatrix?packBomMatrixID=xxx
     */
    detail: async (packBomMatrixID: string): Promise<ApiResponse<BomMatrix>> => {
        const res = await http.get<unknown>('/nc/bom/packBomMatrix', {packBomMatrixID});
        if (res.data === undefined || res.data === null) {
            return {...res, data: undefined};
        }
        return {...res, data: BomMatrixSchema.parse(res.data)};
    },
};
