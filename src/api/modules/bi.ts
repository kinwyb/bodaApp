import {http} from "@/api";
import {ProductionWeekDataSchema} from "../schemas/bi/productionWeekData";

export interface BIQueryArg {
    Name: string;
    Field: string;
    Val: string;
    ValType: string;
    SQL: string;
}

export interface BIList {
    ID: string;
    BIName: string;
    Hold: boolean;
    QuerySQL: string;
    Args: BIQueryArg[];
    Children?: BIList[];
}

export interface BIData {
    Headers: string[];
    ColumnTypes: string[];
    DataVals: Record<string, any>[];
}

export const biApi = {
    /**
     * 报表列表
     */
    list: () => http.get<BIList[]>('/bi/list'),

    /**
     * 查询报表
     * @param params
     */
    query: (params: BIList) => http.post<BIData>('/bi/query', params),

    /**
     * 周/月生产数据按年份查（旧客户端 BIAPI.ProductionWeekDateQuery）。
     * @param year 年份
     * @param monthData false 周数据（V0326）/ true 月数据（V0372）
     */
    productionWeekDateQuery: (year: number, monthData: boolean) =>
        http.getSchema('/bi/productionWeekDate/query', ProductionWeekDataSchema.array(), {year, monthData}),
}
