// ⚠️ 本文件由 scripts/gen-api-schemas.mjs 自动生成，请勿手改
// 源: 接口文件 v1.5.259 (Swagger 2.0)
// 生成时间: 2026-11-05T08:27:55.960Z
//
// 覆盖的接口:
//   GET /nc/processRouteMatrix — 工艺路线矩阵详情
//   POST /nc/processRouteMatrix/list — 工艺路线矩阵列表
//   GET /nc/processRouteMatrix/pushRule — 工艺矩阵推送规则
//
// 全部字段 nullish + 对象 loose：Swagger 2.0 不标 nullable，但后端实际会返回
// null / 缺字段 / 多余字段，严格 schema 会大面积误报。
import {z} from 'zod';

export const ProcessRouteMatrixSchema = z.object({
    CMeasure: z.string().nullish(), // 主单位
    CMeasureid: z.string().nullish(), // 主单位ID
    Cassmeasure: z.string().nullish(), // 单位
    Cassmeasureid: z.string().nullish(), // 单位ID
    Colors: z.array(z.string().nullish()).nullish(), // 颜色
    CreateTime: z.string().nullish(), // 创建时间
    CreateUser: z.string().nullish(), // 创建人
    CreateUserNo: z.string().nullish(), // 创建人工号
    Detail: z.array(z.lazy(() => ProcessRouteMatrixDetailSchema)).nullish(), // 工序明细
    MaterialCode: z.string().nullish(), // 物料编码
    MaterialName: z.string().nullish(), // 物料名称
    MaterialVID: z.string().nullish(), // 物料版本ID
    MatrixVersion: z.number().int().nullish(), // 矩阵版本
    PackMethod: z.string().nullish(), // 包装方式
    PackNum: z.string().nullish(), // 包装数量
    ProcessRouteMatrixID: z.string().nullish(), // 工艺路线矩阵ID
    ProjectCode: z.string().nullish(), // 项目编码
    ProjectID: z.string().nullish(), // 项目ID
    SewMaterialVID: z.string().nullish(), // 缝制物料VID
    SizeMatch: z.record(z.string(), z.lazy(() => z.record(z.string(), z.lazy(() => ProcessRouteMatrixSizeMatchSchema)))).nullish(), // 尺码匹配[尺码][子项物料VID]物料匹配
    Sizes: z.array(z.string().nullish()).nullish(), // 尺码
    UpdateTime: z.string().nullish(), // 更新时间
    UpdateUser: z.string().nullish(), // 更新人
    UpdateUserNo: z.string().nullish(), // 更新人工号
    VChangerate: z.string().nullish(), // 换算率
}).loose();
export type ProcessRouteMatrix = z.output<typeof ProcessRouteMatrixSchema>;

export const ProcessRouteMatrixSizeMatchSchema = z.object({
    WorkTime: z.number().nullish(),
});
export type ProcessRouteMatrixSizeMatch = z.output<typeof ProcessRouteMatrixSizeMatchSchema>;

export const ProcessRouteMatrixDetailSchema = z.object({
    AllowAdd: z.boolean().nullish(), // 允许添加工序
    CheckPoint: z.boolean().nullish(), // 检测点
    CountPoint: z.boolean().nullish(), // 报告点
    CraftNote: z.string().nullish(), // 操作要求
    CrcCode: z.string().nullish(), // 工序编码
    CrcDesc: z.string().nullish(), // 工序描述
    CrcID: z.string().nullish(), // 工序ID
    CrcName: z.string().nullish(), // 工序名称
    EffectDate: z.string().nullish(), // 生效日期
    HandOverPoint: z.boolean().nullish(), // 交接点
    InvalidDate: z.string().nullish(), // 失效日期
    MainProcess: z.boolean().nullish(), // 主工序
    MatrixVersion: z.number().int().nullish(), // 矩阵版本
    MixDeliverNum: z.number().nullish(), // 浮余系数
    OutProcess: z.boolean().nullish(), // 委外工序
    ProcessMoveType: z.number().int().nullish(), // 工序转移方式(1=不转移,2=自动转移,3=手动转移)
    ProcessRouteMatrixDetailID: z.string().nullish(), // 工艺路线矩阵明细ID
    ProcessRouteMatrixID: z.string().nullish(), // 工艺路线矩阵ID
    VDef11: z.number().nullish(), // 工序工价
    VDef12: z.number().nullish(), // 小时工资
    VDef13: z.number().nullish(), // 小时产量
    VDef5: z.number().int().nullish(), // 是否审核
    VDef6: z.string().nullish(), // 审核人
    VDef7: z.string().nullish(), // 审核时间
    VDef9: z.number().nullish(), // 标准时间
    VRowNo: z.string().nullish(), // 行号
    WorkStation: z.string().nullish(), // 工作中心
    WorkStationID: z.string().nullish(), // 工作中心ID
    WorkTime: z.number().nullish(), // 工作时间
}).loose();
export type ProcessRouteMatrixDetail = z.output<typeof ProcessRouteMatrixDetailSchema>;

export const ProcessRouteMatrixRuleSchema = z.object({
    Feature: z.string().nullish(), // 特征码
    FeatureCode: z.string().nullish(), // 特征码ID
    IsPush: z.boolean().nullish(), // 是否发布
    MaterialCode: z.string().nullish(), // 物料编码
    MaterialName: z.string().nullish(), // 物料名称
    MatrixVersion: z.number().int().nullish(), // 矩阵版本
    PRID: z.string().nullish(), // 工艺ID
    PRVersion: z.string().nullish(), // 工艺版本
    ProcessRouteMatrixID: z.string().nullish(), // 工艺矩阵ID
    ProcessRouteMatrixRuleID: z.string().nullish(), // 工艺矩阵规则ID
    PushTime: z.string().nullish(), // 发布时间
    PushUser: z.string().nullish(), // 发布人
    PushUserNo: z.string().nullish(), // 发布人工号
    TS: z.string().nullish(), // NC时间
}).loose();
export type ProcessRouteMatrixRule = z.output<typeof ProcessRouteMatrixRuleSchema>;
