// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.259 (Swagger 2.0)
// 生成时间: 2026-11-12T03:14:26.691Z
//
// 覆盖的接口:
//   GET /mis/machine/shift — 机器班次查询
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const ShiftInfoSchema = z.object({
  EndTime: z.string().nullish(), // 结束时间
  IsNow: z.boolean().nullish(), // 是否是当前班次
  Name: z.string().nullish(), // 班次名称
  Shift: z.number().int().nullish(), // 班次
  StartTime: z.string().nullish(), // 开始时间
}).loose();
export type ShiftInfo = z.output<typeof ShiftInfoSchema>;
