import {http} from '../request';
import type {ApiResponse, PageQuery} from '../types';
// 必须从兄弟模块 ./sql 直接引（别引 "@/api" 这个 barrel）：barrel 里 yupai 排在 sql 前面，
// 会形成 yupai → barrel → yupai 的循环 —— 下面的 YupaiOrderMapping 是顶层常量、
// 评估时就要读 S / N，此时它们还没初始化：浏览器报
// `Uncaught ReferenceError: Cannot access 'S' before initialization`，
// SSR 下则是静默拿到 undefined（mapping 变成 {type: undefined}，转换全错）。
import type {Dayjs} from 'dayjs';
import {type FieldConfig, type FieldMapping, N, OpS, S, sqlApi} from './sql';
import {toStringOrEmpty} from "@/utils";

/** 尺码列标题，按界面原样展示 */
export const YupaiMachineSizeHeader = [
    '12/960',
    '12/1056',
    '13/1152',
    '14/1248',
    '15/1344',
    '16/1440',
    '17/1536',
    '18/1632',
    '19/1728',
    '20/1824',
    '13/1296',
    '14/1392',
    '15/1488',
    '16/1584',
    '17/1680',
    '18/1766',
    '21/1290',
    '21/1904'
];

export interface YupaiOrderQuery extends PageQuery {
    isDel?: number;
    keyword?: string;
    salesman?: string;
    workPlace?: string;
    /** 自定义筛选条件，JSON 字符串：{ 字段: { values?, min?, max?, text? } } */
    filters?: string;
}

/**
 * 预订单记录：**后端接口真实返回的形状**（字段与后端返回一致），不含派生字段。
 *
 * 与 YupaiOrder 分开的理由：`http.get<YupaiOrder[]>` 那种写法是纯类型断言（见 request.ts 的
 * `payload = await response.json() as ApiResponse<T>`），运行时不做任何加工 ——
 * 类型上声明了 OrderZQ 也拿不到，只会让 `order.OrderZQ` 编译通过、运行时是 undefined。
 * 拆成两个类型后，「想读派生字段就必须过加工层」才是编译期的事
 * （加工层见 services/yupai.ts 的 toYupaiOrder）。
 */
export interface YupaiOrderDto {
    ID: string;
    /**
     * 预订日期。
     *
     * **如实写 `string`**：后端 HTTP 直返走的只是 `response.json()`（纯解析 JSON 文本），
     * 日期不会被变成别的类型；SQL 路径的 mapping 也用 `S` / `OpS` 原样保留。
     * 转成 `Dayjs` 是**业务模型**（YupaiOrder）的事，由 `toYupaiOrder` 做。
     */
    YPDate: string;
    /** 业务员 */
    Ywy: string;
    /** 业务员工号 */
    YwyNo: string;
    /** 订单号 */
    OrderCode: string;
    /** 总数量 */
    Qty: number;
    /** 款号 */
    StyleCode: string;
    /** 款式描述 */
    ProduceName: string;
    /** 款式数量 */
    Number: number;
    /** 计划下单期 */
    JHDate?: string;
    /** 确认下单期 */
    QRDate?: string;
    /** 尾货期 */
    WCDate?: string;
    /** 走货期 */
    ZHDate?: string;
    /** 下单把握度 */
    XDRate: string;
    /** 备注 */
    Memo: string;
    /** 原料可下单期 */
    YLDate?: string;
    /** 缝制辅料下单期 */
    FLDate?: string;
    /** 包装辅料提供期 */
    BZFLDate?: string;
    /** 原料资料日期 */
    YLZLDate?: string;
    /** 原料到货日期 */
    YLDHDate?: string;
    /** 中期验货日期 */
    ZQCheckDate?: string;
    /** 中期验货要求 */
    ZQCheckMemo: string;
    /** 后道主工序 */
    HDWorkName: string;
    /** 特殊工序 */
    TSWorkName: string;
    /** 预估颜色 */
    Color: string;
    /** 中码下机时间 */
    MCycle: string;
    /** 中码克重 */
    MWeight: string;
    /** 缝制重量 */
    MSewWt: number;
    /** 产地工厂 */
    WorkPlace: string;
    /** 织造产地（组织机构 id） */
    KnitOrgID: string;
    /** 下单产地（组织机构 id） */
    OrgID: string;
    /** 产能阶段 */
    SSStep: number;
    /** 全码样阶段 */
    QMStep: number;
    /** 待客户反馈阶段 */
    WaitCustStep: number;
    /** 待订单阶段 */
    WaitOrderStep: number;
    /** 其它阶段 */
    OtherStep: string;
    /** 状态 */
    Status: number;
    /**
     * 部门ID
     */
    DepartmentID: string;
    CreateTime: string;
    CreateUser: string;
    UpdateTime: string;
    UpdateUser: string;
    DataVersion: number;

    /** 其余字段按原样保留 */
    [key: string]: unknown;
}

/** 转成 `Dayjs` 的日期字段（与 YupaiOrderDto 里声明成日期的字段一一对应） */
type YupaiDateField =
    | 'YPDate' | 'JHDate' | 'QRDate' | 'WCDate' | 'ZHDate'
    | 'YLDate' | 'FLDate' | 'BZFLDate' | 'YLZLDate' | 'YLDHDate' | 'ZQCheckDate'
    | 'CreateTime' | 'UpdateTime';

/**
 * 预订单**业务模型** = 后端字段 + 派生字段，日期字段已转成 `Dayjs | null`。
 *
 * 为什么是 mapped type 而不是 `interface extends`：DTO 的日期是 `string`，
 * 而 `Dayjs` 不是 `string` 的子类型，子接口「重定义」会直接报 TS2430（实测）；
 * `Omit` 也不行 —— DTO 带宽索引签名，`Omit` 会把具名字段一起丢掉（实测 `om.ID` 退化成
 * `unknown`）。mapped type 是唯一能「只换日期字段、不重复其余字段」的写法。
 *
 * 日期一律由 `toYupaiOrder`（services/yupai.ts）转好，两条数据入口共用它：
 * HTTP 直返（yupaiService.list）与 SQL 路径（yupaiService.queryOrder）。
 * 取不到有效日期就是 `null`（不是 undefined），用的时候 `v ? v.diff(...) : null` 即可。
 */
export type YupaiOrder = {
    [K in keyof YupaiOrderDto]-?: K extends YupaiDateField ? Dayjs | null : YupaiOrderDto[K];
} & {
    /**
     * 订单周转期（天）：确认下单期(QRDate) → 尾货期(WCDate)，没有尾货期就退到走货期(ZHDate)。
     * 基准 QRDate 无效时是 null —— 「几天」无从谈起，别拿 0 跟「同一天」混淆。
     */
    OrderZQ: number | null;
};

/**
 * 预订单字段匹配
 */
export const YupaiOrderMapping: FieldMapping<YupaiOrderDto> = {
    ID: {type: "string", field: "YupaiOrderID"},
    YPDate: S,
    Ywy: S,
    YwyNo: S,
    OrderCode: S,
    Qty: N,
    StyleCode: S,
    ProduceName: S,
    Number: N,
    JHDate: OpS,
    QRDate: OpS,
    WCDate: OpS,
    ZHDate: OpS,
    XDRate: S,
    Memo: S,
    YLDate: OpS,
    FLDate: OpS,
    BZFLDate: OpS,
    YLZLDate: OpS,
    YLDHDate: OpS,
    ZQCheckDate: OpS,
    ZQCheckMemo: S,
    HDWorkName: S,
    TSWorkName: S,
    Color: S,
    MCycle: S,
    MWeight: S,
    MSewWt: N,
    WorkPlace: S,
    KnitOrgID: S,
    OrgID: S,
    SSStep: N,
    QMStep: N,
    WaitCustStep: N,
    WaitOrderStep: N,
    OtherStep: S,
    Status: N,
    CreateTime: S,
    CreateUser: S,
    UpdateTime: S,
    UpdateUser: S,
    DepartmentID: S,
    DataVersion: N,
    ...YupaiMachineSizeHeader.reduce<Record<string, FieldConfig>>((acc, _, index) => {
        acc[`MCSize${index + 1}`] = {type: "number", field: `MC_SIZE${index + 1}`};
        return acc;
    }, {}),
}

/** 变更清单记录（list/change 接口返回） */
export interface YupaiOrderChange {
    /** 0：整行变化；1：字段级变化 */
    Action: number;
    /** 订单 ID，对应列表的 ID */
    YupaiOrderID: string;
    /** 发生变化的字段名，为空表示整行变化 */
    FieldName: string;
}

export interface YupaiOrderDel {
    ID: string[];
    Memo: string;
}

/**
 * 预订单默认业务员
 */
export interface YupaiOrderDefaultYwy {
    /**
     * 工号
     */
    EmployeeNo: string;
    /**
     * 名称
     */
    EmployeeName: string;
    /**
     * 部门
     */
    Department: string;
    /**
     * 部门ID
     */
    DepartmentID: string;
}

/**
 * 预订单分批信息
 */
export interface YupaiOrderBatch {
    /**
     * 分批日期
     */
    BatchDate: string;
    /**
     * 分批数量
     */
    BatchRate: number;
}

export interface YupaiOrderBatchSave {
    /**
     * 订单号
     */
    OrderCode: string;
    /**
     * 分批数据
     */
    Batchs: YupaiOrderBatch[];
}

export const yupaiApi = {
    /** 列表：返回后端原始形状（不含派生字段）。要业务模型请走 yupaiService.list */
    list: (query: YupaiOrderQuery = {}) => http.get<YupaiOrderDto[]>('/plan/yupaiOrder/list', {...query, isDel: 0}),
    /** 最近发生变化的明细 */
    changes: () => http.get<YupaiOrderChange[]>('/plan/yupaiOrder/list/change'),
    /** 保存预订单。载荷是**后端形态**（日期给字符串），所以用 DTO 而不是业务模型 */
    save: (payload: Partial<YupaiOrderDto>[]) => http.post<YupaiOrderDto>('/plan/yupaiOrder/save', payload),
    /** 日志记录 */
    log: (yupaiOrderID: string) => http.get<YupaiOrderDto[]>('//plan/yupaiOrder/log', {id: yupaiOrderID}),
    /** 删除预订单 */
    delete: (payload: YupaiOrderDel) => http.delete<string>('/plan/yupaiOrder/del', {Memo: payload.Memo}, {"body": payload.ID}),
    /** 发布预订单 */
    submit: (ids: string[]) => http.post<string>("/plan/yupaiOrder/submit", ids),
    /** 用户预订单权限部门 */
    userDepartment: () => http.get<string[]>('/plan/yupaiOrder/department'),
    /**
     * 按订单前缀获取默认业务员
     * @param orderPrefix 订单前缀
     */
    defaultYwy: async (orderPrefix: string): Promise<ApiResponse<YupaiOrderDefaultYwy>> => {
        const sqlString = "SELECT a.EmployeeName,a.EmployeeNo,b.DepartmentID,b.Department FROM [transitDB].[dbo].[YupaiOrderYwy] a INNER JOIN [BDDMS].dbo.Employee b ON a.EmployeeNo = b.EmployeeNo where a.OrderPrefix = ?"
        const result = await sqlApi.query({SQL: sqlString, Args: [orderPrefix]})
        if (result.data && (result.data.DataVals?.length ?? 0) > 0) {
            return {
                code: 0,
                data: {
                    EmployeeNo: result.data.DataVals?.[0]["EmployeeNo"] ?? '',
                    EmployeeName: result.data.DataVals?.[0]["EmployeeName"] ?? '',
                    Department: result.data.DataVals?.[0]["Department"] ?? '',
                    DepartmentID: result.data.DataVals?.[0]["DepartmentID"] ?? '',
                }
            }
        }
        return {
            code: 0,
        }
    },

    /**
     * 获取款式描述
     * @param styleCode 款号
     */
    styleName: async (styleCode: string): Promise<ApiResponse<string>> => {
        const sqlString = "SELECT name FROM [BDDMS].[dbo].[baj_material] WHERE name like ? AND code LIKE ? ORDER BY code DESC"
        const result = await sqlApi.query({SQL: sqlString, Args: [styleCode + "[吖-座]%", "388%"]})
        if (result.data) {
            return {
                code: 0,
                data: toStringOrEmpty(result.data.DataVals?.[0]["name"])
            }
        }
        return {
            code: 0,
        }
    },

    /**
     * 获取款式默认值
     * @param styleCode 款号
     */
    styleDefaultValue: async (styleCode: string): Promise<ApiResponse<YupaiOrderDto>> => {
        const sqlString = "SELECT * FROM [transitDB].[dbo].[YupaiOrder] WHERE StyleCode = ? ORDER BY UpdateTime DESC"
        const result = await sqlApi.query({SQL: sqlString, Args: [styleCode]})
        if (result.data && result.data.DataVals && result.data.DataVals.length > 0) {
            const oldOrder = result.data.parse<YupaiOrderDto>(YupaiOrderMapping)
            if (oldOrder) {
                return {
                    code: 0,
                    data: oldOrder
                }
            }
        }
        return {
            code: 0,
        }
    },

    /**
     * 分批数据保存
     * @param payload
     */
    batchSave: (payload: YupaiOrderBatchSave) => http.post<string>("/plan/yupaiOrder/batchSave", payload),

};
