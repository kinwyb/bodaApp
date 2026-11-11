// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.259 (Swagger 2.0)
// 生成时间: 2026-11-11T00:35:01.945Z
//
// 覆盖的接口:
//   POST /plan/yupaiOrder/completeDeliverPlan — 预订单已下单分批汇总
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const YupaiOrderCompleteDeliverPlanSchema = z.object({
  BatchCount: z.number().int().nullish(), // 总批次
  BatchNum: z.number().int().nullish(), // 批次号
  CompleteDate: z.string().nullish(), // 实际下单期
  JHDate: z.string().nullish(), // 计划下单期
  OrderCode: z.string().nullish(), // 订单号
  Qty: z.number().int().nullish(), // 数量
  WorkPlace: z.string().nullish(), // 产地
  YPDate: z.string().nullish(), // 预排日期
  Ywy: z.string().nullish(), // 业务员
  ZHDate: z.string().nullish(), // 预计交期
}).loose();
export type YupaiOrderCompleteDeliverPlan = z.output<typeof YupaiOrderCompleteDeliverPlanSchema>;
