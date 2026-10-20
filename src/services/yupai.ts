import type {ApiResponse, YupaiOrder, YupaiOrderDto, YupaiOrderQuery} from "@/api";
import {sqlApi, yupaiApi, YupaiMachineSizeHeader} from "@/api";
import {formatDate, isBlank, isBlankExcept, now, toDayjs, toNumberOrZero, toStringOrEmpty} from "@/utils";
import {
    type YupaiOrderChangeDetail,
    type YupaiOrderChangeDetailDto,
    YupaiOrderChangeMapping,
    YupaiOrderMapping
} from "@/api/modules/yupai.ts";
import type {Dayjs} from "dayjs";

/**
 * 订单周转期（天）：确认下单期(QRDate) → 尾货期(WCDate)，没有尾货期就退到走货期(ZHDate)。
 *
 * 入参故意用 `unknown`：DTO 的日期是字符串、业务模型的是 `Dayjs | null`，两种都靠 `toDayjs` 归一。
 *
 * 基准无效就返回 null —— 没有基准，「几天」无从谈起。
 *
 * ⚠️ 不能写成 `WCDate.diff(toDayjs(QRDate), 'day')`：toDayjs 对空值/占位值/非法日期
 * 一律给 undefined，而 dayjs 的 diff 拿 undefined 会**退化成 now** —— 实测
 * `dayjs('2026-03-11').diff(undefined, 'day')` = -216（今天 2026-10-13），
 * 于是 OrderZQ 静默变成「距今天数」这种看着完全正常的数字，极难发现。
 */
export function calcOrderZQ(order: {
    QRDate?: unknown;
    WCDate?: unknown;
    ZHDate?: unknown;
}): number | null {
    const qr = toDayjs(order.QRDate);
    if (!qr) return null;
    const wc = toDayjs(order.WCDate);
    if (wc) return wc.diff(qr, 'day');
    const zh = toDayjs(order.ZHDate);
    return zh ? zh.diff(qr, 'day') : null;
}

/**
 * 后端 DTO → 业务模型：**把日期转成 `Dayjs` + 补齐派生字段**。
 *
 * **两条数据入口共用这一个加工器**：
 * - HTTP 直返：`yupaiService.list` —— `http.get` 的泛型只是类型断言，后端返回里
 *   既没有 OrderZQ，日期也还是字符串（`'2025-09-01'` / `'2025-09-01 16:37:50'`）；
 * - SQL 路径：`yupaiService.queryOrder` —— mapping 用 `S` / `OpS` 原样保留字符串，
 *   形态与 HTTP 完全一致，只是同样没有 OrderZQ。
 *
 * 所以它做两件事：
 * 1. 把日期转成 `Dayjs | null`（取不到有效日期就是 null）—— `YupaiOrder` 上那句
 *    `Dayjs | null` 才是真的；
 * 2. 补 `OrderZQ` 这类派生字段。
 *
 * 为什么日期不在 mapping 里转：HTTP 那条路根本没有 mapping，只有 SQL 路径生效，
 * 两条路必然漂移（`YupaiOrderMapping` 和 services 里那份 mapping 已经漂过一次）。
 * 现在两条路的 DTO 都是纯字符串，日期加工只有这一处。
 */
export function toYupaiOrder(dto: YupaiOrderDto): YupaiOrder {
    return {
        ...dto,
        // 别依赖 `...dto` 把日期原样带过来 —— 那样 YupaiOrder 上的 Dayjs 类型就是假的
        YPDate: toDayjs(dto.YPDate) ?? null,
        JHDate: toDayjs(dto.JHDate) ?? null,
        QRDate: toDayjs(dto.QRDate) ?? null,
        WCDate: toDayjs(dto.WCDate) ?? null,
        ZHDate: toDayjs(dto.ZHDate) ?? null,
        YLDate: toDayjs(dto.YLDate) ?? null,
        FLDate: toDayjs(dto.FLDate) ?? null,
        BZFLDate: toDayjs(dto.BZFLDate) ?? null,
        YLZLDate: toDayjs(dto.YLZLDate) ?? null,
        YLDHDate: toDayjs(dto.YLDHDate) ?? null,
        ZQCheckDate: toDayjs(dto.ZQCheckDate) ?? null,
        CreateTime: toDayjs(dto.CreateTime) ?? null,
        UpdateTime: toDayjs(dto.UpdateTime) ?? null,
        OrderZQ: calcOrderZQ(dto),
    };
}

export function toYupaiOrderChangeDetail(dto: YupaiOrderChangeDetailDto): YupaiOrderChangeDetail {
    let result: YupaiOrderChangeDetail = {
        ...dto,
        QRDate: toDayjs(dto.QRDate) ?? null,
        ZHDate: toDayjs(dto.ZHDate) ?? null,
        ChangeTime: toDayjs(dto.ChangeTime) ?? null,
        ActionName: '未知',
        ChangeDate: toDayjs(formatDate(dto.ChangeTime)) ?? null,
    }
    switch (result.ActionCode) {
        case 0:
            result.ActionName = "新增";
            break;
        case 1:
            result.ActionName = "更新";
            break;
        case 2:
            result.ActionName = "删除";
            break;
        case 3:
            result.ActionName = "恢复";
            break;
        case 4:
            result.ActionName = "下生产单";
            break;
    }
    return result
}

/**
 * 全订单汇总（按年查询的一行）。
 *
 * 刻意写成 `type`（对象类型字面量）而不是 `interface`：表格组件的 `records` 是
 * `Array<Record<string, unknown>>`，而 **interface 不会隐式获得字符串索引签名**，
 * 直接传给 FilterTable / VTable 会报
 * `Index signature for type 'string' is missing in type 'YupaiAllGroup'`（TS2322）。
 * 对象类型字面量则会隐式带索引签名（microsoft/TypeScript#15300），所以能直接传。
 * 同类 DTO（如 `YupaiOrderChangeDetail`）也都是 `type`。
 */
export type YupaiAllGroup = {
    Ywy: string;
    Ywz: string;
    WorkPlace: string;
    YPDate?: Dayjs;
    Tp: number;
    TpName: string;
    OrderCode: string;
    OrderPrefix: string;
    StyleCode: string;
    ProductName: string;
    Color: string;
    Size: string;
    JHDate?: Dayjs;
    QRDate?: Dayjs;
    CompleteDate?: Dayjs;
    StyleQty: number;
    ZHDate?: Dayjs;
    POCount: number;
    WorkDate?: Dayjs;
    ZHMonth: string;
    WorkMonth: string;
    KnitWt: number;
    DyeWg: number;
    SewWt: number;
    KnitSumWt: number;
    DyeSumWg: number;
    SewSumWt: number;
    SewGroup: string;
};

/**
 * 预订单服务
 */
export const yupaiService = {

    /**
     * 预订单列表（HTTP 直返）。
     *
     * 必须在这里过一遍 toYupaiOrder：`http.get<YupaiOrderDto[]>` 的泛型是纯断言，
     * 后端返回里没有 OrderZQ，不补的话页面拿到的是「类型说有、运行时没有」。
     */
    async list(query: YupaiOrderQuery = {}): Promise<ApiResponse<YupaiOrder[]>> {
        const res = await yupaiApi.list(query);
        return {...res, data: res.data?.map(toYupaiOrder)};
    },

    /**
     * 预订单日志记录
     * @param yupaiOrderID
     */
    async log(yupaiOrderID: string): Promise<YupaiOrder[]> {
        const res = await yupaiApi.log(yupaiOrderID);
        if (res.data) {
            return res.data.map((o) => {
                if (o.IsDel === 0) {
                    o.DelTime = undefined;
                    o.DelUser = undefined;
                }
                return toYupaiOrder(o);
            });
        }
        return [];
    },

    /**
     * 预订单信息查询
     * @param orderCode
     * @param styleCode
     */
    async queryOrder(orderCode?: string, styleCode?: string): Promise<ApiResponse<YupaiOrder[]>> {
        let sqlString = 'SELECT * FROM [transitDB].[dbo].[YupaiOrder] WHERE IsDel = 0 ';
        const params: string[] = []
        if (orderCode) {
            sqlString += " AND OrderCode = ? "
            params.push(orderCode)
        }
        if (styleCode) {
            sqlString += " AND StyleCode = ?"
            params.push(styleCode)
        }
        sqlString = sqlString + " ORDER BY UpdateTime DESC";
        let result = await sqlApi.query({SQL: sqlString, Args: params})
        if (!result.data) {
            return {
                code: result.code,
            }
        }
        const orders = result.data.parseToList<YupaiOrderDto>(YupaiOrderMapping)

        return {
            code: result.code,
            // parse 出来的是后端形状（YupaiOrderDto），派生字段由 toYupaiOrder 补 ——
            // 与 HTTP 直返那条路共用同一份算法
            data: orders?.map(toYupaiOrder) ?? [],
        }
    },

    /**
     * 预订单变更记录加载
     * @param orderCode
     * @param startDate
     * @param endDate
     */
    async changeList(orderCode?: string, startDate?: string, endDate?: string): Promise<ApiResponse<YupaiOrderChangeDetail[]>> {
        let sqlString = 'SELECT distinct A.*,B.WorkPlace,B.Number,B.QRDate,B.ZHDate,CONVERT(nvarchar(10),A.ChangeTime,120) as ChangeDate FROM [transitDB].[dbo].[YupaiOrderChangeDetail] A LEFT JOIN [transitDB].[dbo].[YupaiOrder] B ON A.YupaiOrderID = B.YupaiOrderID AND A.Env = B.Env WHERE 1 = 1 ';
        const params: string[] = []
        if (orderCode) {
            sqlString += " AND A.OrderCode = ? "
            params.push(orderCode)
        }
        if (startDate) {
            sqlString += " AND A.ChangeTime >= ? "
            params.push(formatDate(startDate));
        }
        if (endDate) {
            sqlString += " AND A.ChangeTime <= ? "
            params.push(formatDate(endDate));
        }
        sqlString = sqlString + " ORDER BY CONVERT(nvarchar(10),A.ChangeTime,120) DESC,A.OrderCode DESC,A.ChangeTime DESC,A.StyleCode";
        let result = await sqlApi.query({SQL: sqlString, Args: params})
        if (!result.data) {
            return {
                code: result.code,
            }
        }
        const changes = result.data.parseToList<YupaiOrderChangeDetailDto>(YupaiOrderChangeMapping)

        return {
            code: result.code,
            data: changes?.map(toYupaiOrderChangeDetail) ?? [],
        }
    },

    /**
     * 全订单汇总
     * @param year
     */
    async allGroup(year: string): Promise<YupaiAllGroup[]> {
        if (!year) {
            year = now().format('YYYY');
        }
        const result = await sqlApi.procedure({
            ProcedureName: '[transitDB].dbo.YupaiOrderAllNoColorSize',
            Args: {
                year: year,
            }
        })
        if (!result.data || !result.data.DataVals || result.data.DataVals.length < 1) {
            return []
        }
        return result.data.DataVals.map((row): YupaiAllGroup => {
            const tp = toNumberOrZero(row['Tp']);
            const orderCode = toStringOrEmpty(row['OrderCode']);
            const zhDate = toDayjs(row['ZHDate']);
            const knitWt = toNumberOrZero(row['KnitWt']);
            const dyeWg = toNumberOrZero(row['DyeWg']);
            const sewWt = toNumberOrZero(row['SewWt']);
            const workDate = zhDate?.add(-7, 'day')
            const styleQty = toNumberOrZero(row['StyleQty']);
            return {
                Ywy: toStringOrEmpty(row['Ywy']),
                Ywz: toStringOrEmpty(row['Ywz']),
                WorkPlace: toStringOrEmpty(row['WorkPlace']),
                YPDate: toDayjs(row['YPDate']),
                Tp: tp,
                TpName: tp == 1 ? '预订单' : tp == 2 ? '下单' : '',
                OrderCode: orderCode,
                OrderPrefix: orderCode.split('-')[0],
                StyleCode: toStringOrEmpty(row['StyleCode']),
                ProductName: toStringOrEmpty(row['ProductName']),
                Color: toStringOrEmpty(row['Color']),
                Size: toStringOrEmpty(row['Size']),
                JHDate: toDayjs(row['JHDate']),
                QRDate: toDayjs(row['QRDate']),
                CompleteDate: toDayjs(row['CompleteDate']),
                StyleQty: styleQty,
                ZHDate: zhDate,
                POCount: toNumberOrZero(row['POCount']),
                WorkDate: workDate,
                ZHMonth: zhDate?.format('YYYY-MM') ?? '',
                WorkMonth: workDate?.format('YYYY-MM') ?? '',
                KnitWt: knitWt,
                DyeWg: dyeWg,
                SewWt: sewWt,
                KnitSumWt: knitWt * styleQty / 1000,
                DyeSumWg: dyeWg * styleQty / 1000,
                SewSumWt: sewWt * styleQty / 1000,
                SewGroup: toStringOrEmpty(row['SewGroup']),
            }
        });
    }

}

/**
 * 详情行的**单字段**校验规则：字段 → 校验函数（返回提示文案表示不通过，undefined 表示通过）。
 *
 * 一处定义、两处使用：
 * - 整表校验 `validateYupaiOrderDetailRows`（保存前拦截 + 表格标红）
 * - 页面注册编辑器时做「编辑提交前拦截」（见 yupaiOrderEditColumns.ts）
 *
 * 分开写两份必然漂移 —— 编辑器放行的值，保存时又被拦下，用户会觉得莫名其妙。
 *
 * 字段名必须用**详情行模型**（`yupaiOrderDetailRow`）的字段，写错编译器拦不住：
 * `Number(undefined)` 是 NaN、比较恒为 false，规则会静默不触发，错误键也匹配不到任何列。
 */
export const DETAIL_FIELD_RULES: Record<string, (value: unknown) => string | undefined> = {
    StyleCode: (value) => {
        if (isBlank(value)) {
            return '款号不能为空';
        }
        const styleCode = toStringOrEmpty(value)
        if (!styleCode.match("^[0-9a-zA-Z]+$")) {
            return "请输入规范的款式编码[只允许存在数字或者字母]"
        }
        return undefined;
    },
    ProduceName: (value) => (isBlank(value) ? '款式描述不能为空' : undefined),
    MWeight: (value) => (toNumberOrZero(value) <= 0 ? '中码下机克重不能为空' : undefined),
    MCycle: (value) => (toNumberOrZero(value) <= 0 ? '中码下机时间不能为空' : undefined),
    HDWorkName: (value) => (isBlank(value) ? '后道主工序不能为空' : undefined),
};

/**
 * 检测预订单是否为空
 * @param row
 */
export function isEmptyYupaiOrder(row: Record<string, unknown> | null): boolean {
    if (!row) {
        return true;
    }
    return isBlankExcept(row, ["_id", "YupaiOrderID", "DataVersion"]);
}

/**
 * 预订单详情行的整行校验（纯函数，不发请求）
 *
 * 返回「行主键 → 字段 → 提示文案」，没有问题时返回空对象。
 *
 * 主键取详情行的 YupaiOrderID 而**不是行号**：详情表格支持点列头排序，
 * VTable 回传的行号是「当前 records 数组（已被排序）里的位置」，
 * 而页面改的是未排序的那份数据 —— 用行号定位，排序后就会写错行。
 * 主键与行序无关，排序、增删行之后依然精确对应。
 *
 * 内容 = 单字段规则（DETAIL_FIELD_RULES，与编辑器拦截共用）+ 跨字段规则。
 * 页面把结果拍平成「行主键#字段 → 提示」交给 cellStyle 标红。
 */
export function validateYupaiOrderDetailRows(
    rows: Array<Record<string, unknown>>,
): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    /**
     * 款号 → 出现过的行主键。
     * 查重是**跨行**规则，一行里判不出来，所以先登记、等所有行都看过再统一标注（见循环之后）。
     * 空款号不登记：那种情况由单字段规则报「款号不能为空」，不该再报一次重复。
     */
    const styleCodeRows = new Map<string, string[]>();

    for (const row of rows) {
        if (isEmptyYupaiOrder(row)) {
            continue;
        }
        const rowKey = String(row._id ?? '');
        // 没有主键的行不参与校验：否则它们会挤在同一个键上互相覆盖
        if (!rowKey) continue;

        const errors: Record<string, string> = {};

        // 单字段规则：编辑器「提交前拦截」用的是同一份
        for (const [field, rule] of Object.entries(DETAIL_FIELD_RULES)) {
            const message = rule(row[field]);
            if (message) errors[field] = message;
        }

        // ─── 跨字段规则：要整行（甚至多行）才判得了，编辑器那一层覆盖不到 ──────
        const styleCode = toStringOrEmpty(row.StyleCode).trim();
        if (styleCode) {
            const keys = styleCodeRows.get(styleCode);
            if (keys) keys.push(rowKey);
            else styleCodeRows.set(styleCode, [rowKey]);
        }

        const sizeSum = YupaiMachineSizeHeader.reduce(
            (sum, _title, index) => sum + toNumberOrZero(row[`MCSize${index + 1}`]), 0,
        );
        if (sizeSum !== toNumberOrZero(row.Number)) {
            errors.Number = '尺码合计与款式数量不一致';
        }
        // ─────────────────────────────────────────────────────────────────

        if (Object.keys(errors).length > 0) result[rowKey] = errors;
    }

    // 款号重复：标在涉及的所有行上（两行都标，用户才知道是「跟谁重了」）
    styleCodeRows.forEach((rowKeys, styleCode) => {
        if (rowKeys.length < 2) return;
        rowKeys.forEach((rowKey) => {
            const existing = result[rowKey];
            // 该格已经有更根本的问题（为空 / 格式不规范）就别覆盖它 —— 那两个先解决
            if (existing?.StyleCode) return;
            result[rowKey] = {...(existing ?? {}), StyleCode: `款号 ${styleCode} 在明细中重复`};
        });
    });

    return result;
}