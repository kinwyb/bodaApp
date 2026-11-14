// 手写：按 C# Boda.Models.ProductionWeekData（Models/BI.cs）反推。
// Swagger 里 Datas 的值类型是空定义（additionalProperties: {}），生成物只能给
// z.unknown() —— 等于把校验关掉。C# 的实际形状是 Dictionary<组织ID, Dictionary<字段, double>>，
// 故按 C# 手写 —— 别用 gen-api-schemas 覆盖本文件。
// 覆盖接口: GET /bi/productionWeekDate/query?year=&monthData=（周/月生产数据按年份查）
import {z} from 'zod';

export const ProductionWeekDataSchema = z.object({
    /** 周年（年份） */
    WeekYear: z.number().int().nullish(),
    /** 周序号；monthData=true 时是「月份 + 60」（旧客户端用 WeekNum-60 还原月份） */
    WeekNum: z.number().int().nullish(),
    /** 周/月开始日期 */
    WeekStartDate: z.string().nullish(),
    /** 周/月结束日期 */
    WeekEndDate: z.string().nullish(),
    /** 数据：map[组织ID]map[指标字段]值。比率/效率类字段是百分数原值（如 85.5 表示 85.5%） */
    Datas: z.record(z.string(), z.record(z.string(), z.number())).nullish(),
}).loose();
export type ProductionWeekData = z.output<typeof ProductionWeekDataSchema>;
