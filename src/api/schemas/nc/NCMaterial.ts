// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.251 (Swagger 2.0)
// 生成时间: 2026-10-22T08:01:47.709Z
//
// 覆盖的接口:
//   GET /nc/material/materialClassTree — 物料分类树形结构
//   POST /nc/material/query — 物料查询
//   POST /nc/material/queryVFree — 物料辅助树形查询
//   GET /nc/material/queryUseVFree — 物料启用的vfree辅助属性查询
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const NCMaterialSchema = z.object({
    code: z.string().nullish(), // 物料编码
    def10: z.string().nullish(), // 辅助属性ID
    def11: z.string().nullish(), // 辅助属性值
    isfeature: z.string().nullish(), // 特征件
    materialconvert: z.array(z.lazy(() => NCMaterialConvertSchema)).nullish(), // 计量单位集合
    materialspec: z.string().nullish(), // 规格
    materialtype: z.string().nullish(), // 型号
    measdoc: z.string().nullish(), // 单位名称
    name: z.string().nullish(), // 物料名称
    pk_marbasclass: z.string().nullish(), // 物料基本分类PK
    pk_material: z.string().nullish(), // 物料PK
    pk_measdoc: z.string().nullish(), // 单位PK
    pk_source: z.string().nullish(), // 物料版本PK
    version: z.number().int().nullish(), // 版本号
}).loose().transform(({isfeature, ...rest}) => ({
    ...rest,
    IsFeature: isfeature === 'Y',
}));
export type NCMaterial = z.output<typeof NCMaterialSchema>;

export interface NCMaterialClassTree {
    children?: Array<NCMaterialClassTree> | null;
    code?: string | null;
    name?: string | null;
    pkMarbasclass?: string | null;
}

export const NCMaterialClassTreeSchema: z.ZodType<NCMaterialClassTree> = z.object({
    children: z.array(z.lazy(() => NCMaterialClassTreeSchema)).nullish(), // 子分类
    code: z.string().nullish(), // 分类编码
    name: z.string().nullish(), // 分类名称
    pkMarbasclass: z.string().nullish(), // 物料基本分类PK
}).loose() as unknown as z.ZodType<NCMaterialClassTree>;

export const NCMaterialConvertSchema = z.object({
    measdoc: z.string().nullish(), // 单位名称
    measdocCode: z.string().nullish(), // 单位编码
    measrate: z.string().nullish(), // 转换率
    pk_materialconvert: z.string().nullish(),
    pk_measdoc: z.string().nullish(), // 单位PK
}).loose();
export type NCMaterialConvert = z.output<typeof NCMaterialConvertSchema>;

export const NCMaterialVFreeSchema = z.object({
    code: z.string().nullish(), // 辅助属性编码
    name: z.string().nullish(), // 辅助属性名称
    pk_defdoc: z.string().nullish(),
}).loose();
export type NCMaterialVFree = z.output<typeof NCMaterialVFreeSchema>;
