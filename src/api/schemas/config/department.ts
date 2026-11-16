import {z} from 'zod';

/**
 * 部门（旧客户端 `Models/Config.cs` 里的 `Department`，字段名一模一样）。
 *
 * 这份 schema 是**手写**的：`/department` 属于配置域，后端 OpenAPI 规范里查不到这条路径，
 * `scripts/gen-api-schemas.mjs` 生成不出来，所以按旧客户端真正在用的 Model 类还原。
 *
 * 自引用（`Children`）用 `interface` 承载类型 + `as unknown as z.ZodType<T>` 打断循环推断，
 * 与 `src/api/schemas/nc/NCBase.ts` 的 `NCProjectClass` 是同一套写法。
 * 字段全部 nullish：后端大量返回 null / 缺字段，当必填用之前先判空。
 */
export interface Department {
    ID?: string | null;
    /** 部门编码：父编码 + 两位序号，如 01 / 0101 */
    No?: string | null;
    Name?: string | null;
    ParentID?: string | null;
    ParentName?: string | null;
    /** 部门属性：工厂 / 车间 / 班组 */
    Attribute?: string | null;
    /** 联系人 */
    ContactUser?: string | null;
    /** 部门简码，打印工序条码时用 */
    Code?: string | null;
    /** 是否显示（false 的部门在 isAll=0 的查询里不出现） */
    Visible?: boolean | null;
    Children?: Array<Department> | null;
}

export const DepartmentSchema: z.ZodType<Department> = z.object({
    ID: z.string().nullish(),
    No: z.string().nullish(),
    Name: z.string().nullish(),
    ParentID: z.string().nullish(),
    ParentName: z.string().nullish(),
    Attribute: z.string().nullish(),
    ContactUser: z.string().nullish(),
    Code: z.string().nullish(),
    Visible: z.boolean().nullish(),
    Children: z.array(z.lazy(() => DepartmentSchema)).nullish(),
}).loose() as unknown as z.ZodType<Department>;
