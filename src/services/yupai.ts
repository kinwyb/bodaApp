import {sqlApi, S, N, YupaiMachineSizeHeader} from "@/api";
import type {ApiResponse, YupaiOrder,} from "@/api";
import type {FieldConfig} from "@/api/modules/sql.ts";
import {isBlank, isBlankExcept, toNumberOrZero, toStringOrEmpty} from "@/utils";

/**
 * 预订单服务
 */
export const yupaiService = {

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
        const orders = result.data.parseToList<YupaiOrder>({
            ID: {type: "string", field: "YupaiOrderID"},
            YPDate: S,
            Ywy: S,
            YwyNo: S,
            OrderCode: S,
            Qty: N,
            StyleCode: S,
            ProduceName: S,
            Number: N,
            JHDate: S,
            QRDate: S,
            WCDate: S,
            ZHDate: S,
            XDRate: S,
            Memo: S,
            YLDate: S,
            FLDate: S,
            BZFLDate: S,
            YLZLDate: S,
            YLDHDate: S,
            ZQCheckDate: S,
            ZQCheckMemo: S,
            HDWorkName: S,
            TSWorkName: S,
            Color: S,
            MCycle: S,
            ZZCycle: N,
            MWeight: S,
            ZZMWeight: N,
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
            ...YupaiMachineSizeHeader.reduce<Record<string, FieldConfig>>((acc, _, index) => {
                acc[`MCSize${index + 1}`] = {type: "number", field: `MC_SIZE${index + 1}`};
                return acc;
            }, {}),
        })

        return {
            code: result.code,
            // parseToList 返回的就是完整的 YupaiOrder[]（缺列的字段由 mapping 的
            // type 默认值补齐），不需要再断言一次
            data: orders ?? [],
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
    ZZMWeight: (value) => (toNumberOrZero(value) <= 0 ? '中码下机克重不能为空' : undefined),
    ZZMTime: (value) => (toNumberOrZero(value) <= 0 ? '中码下机时间不能为空' : undefined),
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