// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.251 (Swagger 2.0)
// 生成时间: 2026-10-21T09:10:54.500Z
//
// 覆盖的接口:
//   GET /nc/bom/packBomMatrix — 包装BOM矩阵详情
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const PackBomMatrixSchema = z.object({
  CMeasure: z.string().nullish(), // 主单位
  CMeasureid: z.string().nullish(), // 主单位ID
  Cassmeasure: z.string().nullish(), // 单位
  Cassmeasureid: z.string().nullish(), // 单位ID
  ColorMatch: z.record(z.string(), z.lazy(() => PackBomMatrixColorMatchSchema)).nullish(), // 颜色匹配[颜色][子项物料VID]颜色匹配
  ColorSort: z.array(z.string().nullish()).nullish(), // 缝制颜色排序
  CreateTime: z.string().nullish(), // 创建时间
  CreateUser: z.string().nullish(), // 创建人
  CreateUserNo: z.string().nullish(), // 创建人工号
  Detail: z.array(z.lazy(() => PackBomMatrixDetailSchema)).nullish(), // 包装物料明细
  MatrixVersion: z.number().int().nullish(), // 矩阵版本
  PackBomMatrixID: z.string().nullish(), // 包装bom矩阵ID
  PackMaterialCode: z.string().nullish(), // 包装物料编码
  PackMaterialName: z.string().nullish(), // 包装物料名称
  PackMaterialVID: z.string().nullish(), // 包装物料版本ID
  PackMethod: z.string().nullish(), // 包装方式
  PackNum: z.string().nullish(), // 包装数量
  ProjectCode: z.string().nullish(), // 项目编码
  ProjectID: z.string().nullish(), // 项目ID
  SewMaterialVID: z.string().nullish(), // 缝制物料ID
  SizeMatch: z.record(z.string(), z.lazy(() => PackBomMatrixSizeMatchSchema)).nullish(), // 尺码匹配[尺码][子项物料VID]物料匹配
  SizeSort: z.array(z.string().nullish()).nullish(), // 缝制尺码排序
  UpdateTime: z.string().nullish(), // 更新时间
  UpdateUser: z.string().nullish(), // 更新人
  UpdateUserNo: z.string().nullish(), // 更新人工号
  VChangerate: z.string().nullish(), // 换算率
}).loose();
export type PackBomMatrix = z.output<typeof PackBomMatrixSchema>;

export const PackBomMatrixColorMatchSchema = z.unknown();
export type PackBomMatrixColorMatch = z.output<typeof PackBomMatrixColorMatchSchema>;

export const PackBomMatrixSizeMatchSchema = z.unknown();
export type PackBomMatrixSizeMatch = z.output<typeof PackBomMatrixSizeMatchSchema>;

export const PackBomMatrixDetailSchema = z.object({
  Bdeliver: z.boolean().nullish(), // 发料
  Bupint: z.boolean().nullish(), // 向上取整
  CMeasure: z.string().nullish(), // 主单位
  CMeasureid: z.string().nullish(), // 主单位PK
  Cassmeasure: z.string().nullish(), // 单位
  Cassmeasureid: z.string().nullish(), // 单位PK
  Cbeginperiod: z.string().nullish(), // 生效日期
  Cendperiod: z.string().nullish(), // 失效日期
  Fbackflushtype: z.number().int().nullish(), // 倒冲方式(1=不倒冲,2=自动倒冲,3=交互式倒冲)
  Fitemsource: z.number().int().nullish(), // 备料来源(1=备料,2=领料,3=传输)
  Fitemtype: z.number().int().nullish(), // 子项类型(1=普通,2=工具,3=技术资料,4=客户手册)
  Ibasenum: z.number().int().nullish(), // 底数
  MaterialCode: z.string().nullish(), // 子项物料编码
  MaterialName: z.string().nullish(), // 子项物料名称
  MaterialSpec: z.string().nullish(), // 子项物料规格
  MaterialType: z.string().nullish(), // 子项物料类型
  MaterialVID: z.string().nullish(), // 子项物料VID
  MaterialVersion: z.string().nullish(), // 子项物料版本
  MatrixVersion: z.number().int().nullish(), // 矩阵版本
  Ndissipationum: z.string().nullish(), // 损耗系数
  Nitemnum: z.string().nullish(), // 子主项数量
  PackBomMatrixDetailID: z.string().nullish(), // 包装bom矩阵明细ID
  PackBomMatrixID: z.string().nullish(), // 包装bom矩阵ID
  Productor: z.string().nullish(), // 生产厂商
  ProductorID: z.string().nullish(), // 生产厂商
  ProjectMaterial: z.boolean().nullish(), // 项目专用料
  VChangerate: z.string().nullish(), // 换算率
  VFree1: z.string().nullish(), // 款号
  VFree1Name: z.string().nullish(), // 款号
  VFree4: z.string().nullish(), // 批号
  VFree4Name: z.string().nullish(), // 批号
  VFree5: z.string().nullish(), // 季度号/通用
  VFree5Name: z.string().nullish(), // 季度号/通用
  VFree8: z.string().nullish(), // 特性
  VFree8Name: z.string().nullish(), // 特性
  VFree9: z.string().nullish(), // 色纱色
  VFree9Name: z.string().nullish(), // 色纱色
  VRowNo: z.string().nullish(), // 行号
}).loose();
export type PackBomMatrixDetail = z.output<typeof PackBomMatrixDetailSchema>;
