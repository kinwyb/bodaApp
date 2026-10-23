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