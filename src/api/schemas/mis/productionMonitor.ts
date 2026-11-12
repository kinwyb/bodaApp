// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.259 (Swagger 2.0)
// 生成时间: 2026-11-12T00:45:51.971Z
//
// 覆盖的接口:
//   POST /mis/productionMonitor/appletsData — 通过白坯库存数据查询班次产量
//   DELETE /mis/productionMonitor/appletsData/del — 织造扫描记录删除
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const DateShiftDataQueryFromKnitStoreSchema = z.object({
    Barcode: z.string().nullish(), // 条码号
    CheckDown: z.boolean().nullish(), // 检验完成
    CheckDownTime: z.string().nullish(), // 检验完成时间
    CheckEmployee: z.string().nullish(), // 检验员
    CheckEmployeeNo: z.string().nullish(), // 检验员工号
    CheckQty: z.number().int().nullish(), // 检验后数量
    Color: z.string().nullish(), // 颜色
    DateShiftEnd: z.string().nullish(), // 班次结束时间
    DateShiftStart: z.string().nullish(), // 班次开始时间
    DispatchNo: z.string().nullish(), // 派工单号
    Employee: z.string().nullish(), // 挡车工号
    EmployeeName: z.string().nullish(), // 挡车工名称
    Flag: z.number().int().nullish(), // 是否已经同步到nautilus
    ID: z.string().nullish(), // ID
    InputTime: z.string().nullish(), // 挡车提交时间
    MachCode: z.number().int().nullish(), // 机台号
    OrderCode: z.string().nullish(), // 订单号
    ProductName: z.string().nullish(), // 物料名称
    ProductNo: z.string().nullish(), // 物料号
    Qty: z.number().int().nullish(), // 挡车工数量
    RoomCode: z.string().nullish(), // 厂别
    ShiftName: z.string().nullish(), // 班次名称
    Size: z.string().nullish(), // 尺码
    StyleCode: z.string().nullish(), // 款号
    YarnColor: z.string().nullish(), // 色纱色
}).loose();
export type DateShiftDataQueryFromKnitStore = z.output<typeof DateShiftDataQueryFromKnitStoreSchema>;
