import {sqlApi, YupaiMachineSizeHeader, yupaiApi} from "@/api";
import type {ApiResponse, YupaiOrder, YupaiOrderDto, YupaiOrderQuery} from "@/api";
import {isBlank, isBlankExcept, toDayjs, toNumberOrZero, toStringOrEmpty} from "@/utils";
import {YupaiOrderMapping} from "@/api/modules/yupai.ts";

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
        if (result.code != 0) {
            return {
                code: result.code,
                errmsg: result.errmsg,
            }
        }
        if (!result.data) {
            return {
                code: result.code,
            }
        }
        if (result.data.IsError) {
            return {
                code: 500,
                errmsg: result.data.ErrMsg ?? "查询失败",
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
        if (isBlankExcept(row, ["_id", "YupaiOrderID"])) {
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