// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.259 (Swagger 2.0)
// 生成时间: 2026-11-12T06:52:24.894Z
//
// 覆盖的接口:
//   POST /mis/productionMonitor/query — 查询产量(MIS-27530)
//   GET /mis/productionMonitor/detail — 订单资料补充明细(MIS-27420)
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const ProductMonitorBJLogSchema = z.object({
  Cycle: z.number().int().nullish(), // 下机时间
  DateRec: z.string().nullish(), // 写入时间
  DateStartShift: z.string().nullish(), // 班次开始时间
  Discards: z.number().int().nullish(), // 废品数量
  FMID: z.number().int().nullish(), // F_MID
  GroupCode: z.string().nullish(), // 小组
  ID: z.number().int().nullish(), // ID
  MachCode: z.number().int().nullish(), // 机器编号
  OrderCode: z.string().nullish(), // 订单号
  Pieces: z.number().int().nullish(), // 产量
  PlantCode: z.string().nullish(), // 工厂
  Reason: z.number().int().nullish(), // 原因
  RecordBy: z.string().nullish(), // 提交人
  RecordTime: z.string().nullish(), // 提交时间
  RespoCode: z.string().nullish(), // 班次编码
  RoomCode: z.string().nullish(), // 车间
  Shift: z.number().int().nullish(), // 班次
  StColor: z.string().nullish(), // 颜色
  StLot: z.string().nullish(), // 批号
  StSize: z.string().nullish(), // 尺码
  StyleCode: z.string().nullish(), // 款式
  TargetPieces: z.number().int().nullish(), // 目标产量
  TimeOff: z.number().int().nullish(), // 停机时间
  TimeOn: z.number().int().nullish(), // 开机时间
}).loose();
export type ProductMonitorBJLog = z.output<typeof ProductMonitorBJLogSchema>;

export const ProductionMonitorDetailSchema = z.object({
  AuditTime: z.string().nullish(), // 审核时间
  AuditUser: z.string().nullish(), // 审核人
  CpQty: z.number().int().nullish(), // 次品数量
  Cycle: z.number().int().nullish(), // 下机时间
  DateRec: z.string().nullish(), // 写入时间
  DateStartShift: z.string().nullish(), // 班次开始时间
  Detail: z.array(z.lazy(() => ProductMonitorBJLogSchema)).nullish(),
  Discards: z.number().int().nullish(), // 废品数量
  FMID: z.number().int().nullish(), // F_MID
  GroupCode: z.string().nullish(), // 小组
  GxProduction: z.number().int().nullish(), // 正品产量
  ID: z.number().int().nullish(), // ID
  IsAudit: z.number().int().nullish(), // 是否审核
  MacProduction: z.number().int().nullish(), // 机器产量
  MachCode: z.number().int().nullish(), // 机器编号
  OrderCode: z.string().nullish(), // 订单号
  Pieces: z.number().int().nullish(), // 调整的产量
  PlantCode: z.string().nullish(), // 工厂
  RespoCode: z.string().nullish(), // 班次编码
  RoomCode: z.string().nullish(), // 车间
  Shift: z.number().int().nullish(), // 班次
  StColor: z.string().nullish(), // 颜色
  StLot: z.string().nullish(), // 批号
  StSize: z.string().nullish(), // 尺码
  StyleCode: z.string().nullish(), // 款式
  TargetPieces: z.number().int().nullish(), // 目标产量
  TimeOff: z.number().int().nullish(), // 停机时间
  TimeOn: z.number().int().nullish(), // 开机时间
}).loose();
export type ProductionMonitorDetail = z.output<typeof ProductionMonitorDetailSchema>;

export const ProductionMonitorQueryResSchema = z.object({
  BZSunHao: z.number().nullish(), // 标准损耗
  CSunHao: z.number().nullish(), // 超损耗
  ChangePieces: z.number().int().nullish(), // 调整产量
  Close2: z.number().int().nullish(), // 是否结单
  Color: z.string().nullish(), // 颜色
  CpQty: z.number().nullish(), // 次品数
  Cycle: z.number().nullish(), // 单件下机时间
  CycleTime: z.number().nullish(), // 标准单价下机时间
  DateStartShift: z.string().nullish(), // 日期
  Discards: z.number().nullish(), // 废品数
  DiscardsRate: z.number().nullish(), // 次品率
  DispatchNo: z.string().nullish(), // 派工单号
  DispatchTypeNo: z.string().nullish(), // 派工类型
  FChkDate: z.string().nullish(), // 审核日期
  Flag: z.number().int().nullish(), // 是否审核
  Flag2: z.number().int().nullish(), // 是否调整
  Gj: z.number().nullish(), // 标准工价
  GroupCode: z.string().nullish(), // 车间
  GroupCode2: z.string().nullish(), // 班组
  ID: z.number().int().nullish(), // ID
  IsTwins: z.boolean().nullish(), // 是否是双胞胎订单
  LiLunQty: z.number().int().nullish(), // 理论产量
  MacPieces: z.number().int().nullish(), // 机器统计产量
  MachCode: z.number().int().nullish(), // 机器
  MachinesSetupGs: z.number().nullish(), // 标准工时
  NANDU: z.string().nullish(), // 难度系数
  OpeCode: z.string().nullish(), // 员工编号
  OpeCode2: z.string().nullish(), // 踩毛边员工编号
  OpeCode3: z.string().nullish(), // 毛胚全检员编号
  OpeName: z.string().nullish(), // 员工姓名
  OpeName2: z.string().nullish(), // 踩毛边员工名称
  OpeName3: z.string().nullish(), // 毛胚全检员姓名
  OrderCode: z.string().nullish(), // 订单
  Pieces: z.number().int().nullish(), // 实际产量
  PiecesRate: z.number().nullish(), // 生产效率
  Price: z.number().nullish(), // 单价
  ProductCode: z.string().nullish(), // 物料编码
  ProductName: z.string().nullish(), // 产品名称
  QcPrice: z.number().nullish(), // 毛胚检验工价
  QcSalary: z.number().nullish(), // 毛胚检验金额
  ReallyPrice: z.number().nullish(), // 踩毛边工价
  ReallySalary: z.number().nullish(), // 踩毛边金额
  RoomCode: z.string().nullish(), // 厂别
  Salary: z.number().nullish(), // 金额
  Shift2: z.string().nullish(), // 班次名称
  StSize: z.string().nullish(), // 派工尺码
  TargetPieces: z.number().int().nullish(), // 计划数
  TimeOn: z.number().nullish(), // 开机时间
}).loose();
export type ProductionMonitorQueryRes = z.output<typeof ProductionMonitorQueryResSchema>;
