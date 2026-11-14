// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.267 (Swagger 2.0)
// 生成时间: 2026-11-14T02:23:21.257Z
//
// 覆盖的接口:
//   GET /login/userOrgs — 用户组织信息
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const UserOrgSchema = z.object({
  ApiDomain: z.string().nullish(), // 接口域名
  ApiHost: z.string().nullish(), // 接口地址
  OrgID: z.string().nullish(), // 组织ID
  OrgName: z.string().nullish(), // 组织名称
}).loose();
export type UserOrg = z.output<typeof UserOrgSchema>;
