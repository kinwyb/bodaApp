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

/**
 * 项目分类
 */
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

/**
 * 项目
 */
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

/**
 * NC标准工序
 */
export const NCWorkProcessSchema = z.object({
    crcid: z.string().nullish(), //工序ID
    vrccode: z.string().nullish(), //工序编码
    vrcname: z.string().nullish(), //工序名称
    vdef6: z.string().nullish(), //工序描述
    vcraftnote: z.string().nullish(), //操作要求
    bcheckpoint: z.string().nullish(), //检测点
    bcountpoint: z.string().nullish(), //报告点
    bhandoverpoint: z.string().nullish(), //交接点
}).loose().transform(({crcid, vrccode, vrcname, vdef6, vcraftnote, bcheckpoint, bcountpoint, bhandoverpoint}) => ({
    CrcID: crcid,
    CrcCode: vrccode,
    CrcName: vrcname,
    CrcDesc: vdef6,
    CraftNote: vcraftnote,
    CheckPoint: bcheckpoint === 'Y',
    CountPoint: bcountpoint === 'Y',
    HandOverPoint: bhandoverpoint === 'Y',
}))

export type NCWorkProcess = z.output<typeof NCWorkProcessSchema>;

export const NCWorkProcessListSchema = z.object({
    countRows: z.int().nullish(), //总条数
    pageRows: z.int().nullish(), //每页条数
    result: z.array(z.lazy(() => NCWorkProcessSchema)).nullish(), //标准工序组
});

export type NCWorkProcessList = z.output<typeof NCWorkProcessListSchema>;
