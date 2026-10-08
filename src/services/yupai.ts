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
            ID: S,
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
            DepartmentID:S,
            ...YupaiMachineSizeHeader.reduce<Record<string, FieldConfig>>((acc, _, index) => {
                acc[`MCSize${index + 1}`] = N;
                return acc;
            }, {}),
        }) ?? undefined

        return {
            code: result.code,
            data: (orders ?? []) as YupaiOrder[],
        }
    },

}