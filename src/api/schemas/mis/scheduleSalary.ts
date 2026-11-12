// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.259 (Swagger 2.0)
// 生成时间: 2026-11-12T00:45:18.556Z
//
// 覆盖的接口:
//   POST /mis/schedule/salary — 工资明细
//   POST /mis/schedule/salary/piecesCountGroup — 员工计件工资汇总
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const SalaryDetailSchema = z.object({
  ATimeOn: z.number().nullish(), // 实际开机时间
  BZSunHao: z.number().nullish(), // 标准损耗%
  Color: z.string().nullish(), // 颜色
  CpQty: z.number().nullish(), // 次品数
  Cycle: z.number().nullish(), // 单件下机时间
  CycleTime: z.number().nullish(), // 标准单肩下机时间
  DateStartShift: z.string().nullish(), // 日期
  Discards: z.number().nullish(), // 折算废品
  Discards1: z.number().int().nullish(), // 废次品数
  DiscardsRate: z.number().nullish(), // 废次率%
  DispatchNo: z.string().nullish(), // 派工单号
  Gj: z.number().nullish(), // 标准工价
  GroupCode: z.string().nullish(), // 车间
  GroupCode2: z.string().nullish(), // 班组
  Gs: z.number().nullish(), // 标准工时
  ID: z.number().int().nullish(),
  LTimeOn: z.number().nullish(), // 理论开始时间
  MachCode: z.number().int().nullish(), // 机器
  McSize: z.string().nullish(), // 机器尺寸
  MpPrice: z.number().nullish(), // 毛胚工价
  MpSalary: z.number().nullish(), // 毛胚金额
  NANDU: z.string().nullish(), // 难度系数
  OpeCode: z.string().nullish(), // 员工编号
  OpeCode2: z.string().nullish(), // 踩毛边员工编号
  OpeCode3: z.string().nullish(), // 毛胚检员编号
  OpeCode4: z.string().nullish(), // 机修编码
  OpeName: z.string().nullish(), // 员工姓名
  OpeName2: z.string().nullish(), // 踩毛边员工名称
  OpeName3: z.string().nullish(), // 毛胚检员姓名
  OpeName4: z.string().nullish(), // 机修名称
  OrderCode: z.string().nullish(), // 订单
  Pieces: z.number().int().nullish(), // 正品产量
  PiecesRate: z.number().nullish(), // 正品达成率%
  PiecesTime: z.number().nullish(), // 正品工时
  PlanPieces: z.number().int().nullish(), // 计划产量
  Price: z.number().nullish(), // 单价
  ProductName: z.string().nullish(), // 产品名称
  ReallyPrice: z.number().nullish(), // 踩毛边工价
  ReallySalary: z.number().nullish(), // 踩毛边金额
  RoomCode: z.string().nullish(), // 厂别
  Salary: z.number().nullish(), // 金额
  Shift2: z.string().nullish(), // 班次名称
  ShowTime: z.number().nullish(), // 踩毛边标准工时
  Size: z.string().nullish(), // 尺码
  StandardPieces: z.number().int().nullish(), // 标准产量
  StopWaitMaterial: z.number().nullish(), // 停工待料%
  StyleCode: z.string().nullish(), // 款号
  SunHaoRate: z.number().nullish(), // 超损率%
  TargetPieces: z.number().int().nullish(), // 计划数
  TimeOn: z.number().nullish(), // 开机时间
  WorkTime: z.number().nullish(), // 班次工时
}).loose();
export type SalaryDetail = z.output<typeof SalaryDetailSchema>;

export const SalaryPiecesCountGroupSchema = z.object({
  CpQty: z.number().nullish(), // 次品数
  DateStartShift: z.string().nullish(), // 班次
  Discards: z.number().nullish(), // 废品折算数
  OpeCode: z.string().nullish(), // 员工编号
  OpeName: z.string().nullish(), // 员工姓名
  Pieces: z.number().int().nullish(), // 正品产量
  Price: z.number().nullish(), // 单价
  RoomCode: z.string().nullish(), // 厂别
  Salary: z.number().nullish(), // 计件工资
}).loose();
export type SalaryPiecesCountGroup = z.output<typeof SalaryPiecesCountGroupSchema>;
