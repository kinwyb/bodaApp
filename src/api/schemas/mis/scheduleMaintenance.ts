// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.259 (Swagger 2.0)
// 生成时间: 2026-11-12T05:57:29.252Z
//
// 覆盖的接口:
//   GET /mis/schedule/load — 加载排班信息
//   POST /mis/schedule/update — 更新排班信息
//   GET /mis/employee — 获取员工列表,挡车工资料维护
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const EmployeeSchema = z.object({
    Department: z.string().nullish(), // 部门
    DepartmentNo: z.string().nullish(), // 部门编码
    GroupCode: z.string().nullish(), // 组别
    InDay: z.string().nullish(), // 入职日期
    Name: z.string().nullish(), // 姓名
    No: z.string().nullish(), // 编号
    Sex: z.string().nullish(), // 性别
    Status: z.string().nullish(), // 是否在职
}).loose();
export type Employee = z.output<typeof EmployeeSchema>;

export const ScheduleBJSchema = z.object({
    EndTime: z.string().nullish(), // 班次结束时间
    GroupCode: z.string().nullish(), // 小组
    ID: z.number().int().nullish(), // 自增ID
    MachineID: z.number().int().nullish(), // 机器ID
    OpeCode: z.string().nullish(), // 挡车工编号
    OpeCode2: z.string().nullish(), // 踩毛边员工编号
    OpeCode3: z.string().nullish(), // 毛胚检验员编号
    OpeCode4: z.string().nullish(), // 机修工员工编号
    OpeName: z.string().nullish(), // 挡车工名称
    OpeName2: z.string().nullish(), // 踩毛边员工名称
    OpeName3: z.string().nullish(), // 毛胚检验员名称
    OpeName4: z.string().nullish(), // 机修工员工名称
    PlantCode: z.string().nullish(), // 工厂
    RecordBy: z.string().nullish(), // 录入人
    RecordDate: z.string().nullish(), // 录入时间
    RoomCode: z.string().nullish(), // 车间
    Shift: z.string().nullish(), // 班次
    StartTime: z.string().nullish(), // 班次开始时间
}).loose();
export type ScheduleBJ = z.output<typeof ScheduleBJSchema>;

export const ScheduleUpdateReqSchema = z.object({
    GroupCode: z.string().nullish(),
    ID: z.number().int().nullish(), // ID标记
    OpeCode: z.string().nullish(), // 挡车工编号
    OpeCode2: z.string().nullish(), // 踩毛边员工编号
    OpeCode3: z.string().nullish(), // 毛胚检验员编号
    OpeCode4: z.string().nullish(), // 机修员工编号
}).loose();
export type ScheduleUpdateReq = z.output<typeof ScheduleUpdateReqSchema>;
