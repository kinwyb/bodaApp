// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.259 (Swagger 2.0)
// 生成时间: 2026-11-12T03:14:25.547Z
//
// 覆盖的接口:
//   POST /mis/productionMonitor/order/list — 订单资料补充列表(MIS-27420)
//   GET /mis/productionMonitor/order — 订单资料获取(MIS-27420)
//   POST /mis/productionMonitor/order — 订单资料修改(MIS-27420)
//   DELETE /mis/productionMonitor/order/del — 订单资料补充删除(MIS-27420)
//   PUT /mis/productionMonitor/copy — 订单资料复制(MIS-27420)
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const SwaggerApiResponseStructSchema = z.object({
  code: z.number().int().nullish(), // 错误编码
  err: z.string().nullish(), // 错误内容
  errmsg: z.string().nullish(), // 错误描述
}).loose();
export type SwaggerApiResponseStruct = z.output<typeof SwaggerApiResponseStructSchema>;

export const SwaggerIntegerResponseStructSchema = z.object({
  code: z.number().int().nullish(), // 错误编码
  data: z.number().int().nullish(), // 是否成功
  errmsg: z.string().nullish(), // 错误描述
}).loose();
export type SwaggerIntegerResponseStruct = z.output<typeof SwaggerIntegerResponseStructSchema>;

export const ProductionMonitorOrderSchema = z.object({
  Mo: z.string().nullish(), // 单号
  OrderCode: z.string().nullish(), // 订单号
  OrderDescription: z.string().nullish(), // 订单信息
  OrderRecusl: z.string().nullish(), // nc单号
  StColor: z.string().nullish(), // 色号
  StSize: z.string().nullish(), // 尺码
  StyleCode: z.string().nullish(), // 款号
}).loose();
export type ProductionMonitorOrder = z.output<typeof ProductionMonitorOrderSchema>;

export const ProductionMonitorOrderListSchema = z.object({
  ChkBy: z.string().nullish(), // 审核人
  ChkDate: z.string().nullish(), // 审核时间
  Cycle: z.number().nullish(), // 下机时间
  CycleTime: z.number().nullish(), // 标准下机时间
  DateRec: z.string().nullish(), // 等级日期
  DateStartShift: z.string().nullish(), // 班次开始时间
  Discards: z.number().int().nullish(), // 废品数量
  Flag: z.number().int().nullish(), // 是否审核
  GroupCode: z.string().nullish(), // 车间
  GroupCode2: z.string().nullish(), // 组别
  ID: z.number().int().nullish(),
  IsEdit: z.number().int().nullish(), // 是否编辑
  MachCode: z.number().int().nullish(), // 机台号
  OpeCode: z.string().nullish(), // 员工编号
  OpeName: z.string().nullish(), // 员工姓名
  OrderCode: z.string().nullish(), // 订单号
  OrderDescription: z.string().nullish(), // 订单信息
  OrderRecusl: z.string().nullish(), // NC派工单
  OrderTarget: z.number().int().nullish(), // 订单计划数
  Pieces: z.number().int().nullish(), // 正品数量
  PlantCode: z.string().nullish(), // 工厂
  Reason: z.number().int().nullish(), // 原因
  RoomCode: z.string().nullish(), // 厂别
  Shift: z.number().int().nullish(), // 班次
  ShiftName: z.string().nullish(), // 班次名称
  StColor: z.string().nullish(), // 颜色
  StLot: z.string().nullish(), // 原料批次
  StSize: z.string().nullish(), // 尺码
  StyleCode: z.string().nullish(), // 款号
}).loose();
export type ProductionMonitorOrderList = z.output<typeof ProductionMonitorOrderListSchema>;
