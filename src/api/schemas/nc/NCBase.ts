import {z} from 'zod';

/**
 * 自定义档案
 */
export const NCDefdocSchema = z.object({
    code: z.string().nullish(), // 档案编码
    name: z.string().nullish(), // 档案名称
    pk_defdoc: z.string().nullish(), // 自定义档案PK
}).loose();

export type NCDefdoc = z.output<typeof NCDefdocSchema>;

export type NCProductor = z.output<typeof NCDefdocSchema>;


export interface NCProjectClass {
    children?: Array<NCProjectClass> | null;
    pk_projectclass?: string | null;
    type_name?: string | null;
}

export const NCProjectClassSchema: z.ZodType<NCProjectClass> = z.object({
    children: z.array(z.lazy(() => NCProjectClassSchema)).nullish(), // 子分类
    pk_projectclass: z.string().nullish(), // 项目分类ID
    type_name: z.string().nullish(), // 项目分类名称
}).loose() as unknown as z.ZodType<NCProjectClass>;

export const NCProjectSchema = z.object({
    pk_project: z.string().nullish(), //项目PK
    project_name: z.string().nullish(), //项目名称
    project_code: z.string().nullish(), //项目编码
});
export type NCProject = z.output<typeof NCProjectSchema>;

export const NCProjectsSchema = z.object({
    countRows: z.int().nullish(), //总条数
    pageRows: z.int().nullish(), //每页条数
    result: z.array(z.lazy(() => NCProjectSchema)).nullish(), //项目数组
});
export type NCProjects = z.output<typeof NCProjectsSchema>;