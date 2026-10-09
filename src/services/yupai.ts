import {sqlApi, S, N, YupaiMachineSizeHeader} from "@/api";
import type {ApiResponse, YupaiOrder,} from "@/api";
import type {FieldConfig} from "@/api/modules/sql.ts";

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
        let result = await sqlApi.query({SQL: sqlString})
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
        }) ?? undefined

        return {
            code: result.code,
            data: (orders ?? []) as YupaiOrder[],
        }
    },

}

/**
 * 预订单详情行的校验规则（纯函数，不发请求）
 *
 * 返回「行主键 → 字段 → 提示文案」，没有问题时返回空对象。
 *
 * 主键取详情行的 YupaiOrderID 而**不是行号**：详情表格支持点列头排序，
 * VTable 回传的行号是「当前 records 数组（已被排序）里的位置」，
 * 而页面改的是未排序的那份数据 —— 用行号定位，排序后就会写错行。
 * 主键与行序无关，排序、增删行之后依然精确对应。
 *
 * 调用方（页面）把结果拍平成「行主键#字段 → 提示」交给 cellStyle 标红。
 */
export function validateYupaiOrderDetailRows(
    rows: Array<Record<string, unknown>>,
): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const row of rows) {
        const rowKey = String(row.YupaiOrderID ?? '');
        // 没有主键的行不参与校验：否则它们会挤在同一个键上互相覆盖
        if (!rowKey) continue;

        const errors: Record<string, string> = {};
        // ─── 校验规则 ──────────────────────────────────────────────────
        if (!row.StyleCode) errors.StyleCode = '款号不能为空';
        if (!row.ProduceName) errors.ProduceName = '款式描述不能为空';
        if (Number(row.ZZMWeight) <= 0) errors.ZZMWeight = '中码下机克重不能为空';
        if (Number(row.ZZMCycle) <= 0) errors.ZZMCycle = '中码下机时间不能为空';
        const sizeSum = YupaiMachineSizeHeader.reduce(
            (sum, _title, index) => sum + Number(row[`MCSize${index + 1}`] ?? 0), 0,
        );
        if (sizeSum !== Number(row.Number)) errors.Number = '尺码合计与款式数量不一致';
        // ─────────────────────────────────────────────────────────────────────

        if (Object.keys(errors).length > 0) result[rowKey] = errors;
    }
    return result;
}