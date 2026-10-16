import {biApi, type BIList} from "@/api/modules/bi.ts";
import {type SimpleDataTable, SQLResult} from "@/api/modules/sql.ts";
import {toStringOrEmpty} from "@/utils";

export const biService = {
    /**
     * 报表查询
     * @param params
     */
    query: async (params: BIList): Promise<SimpleDataTable> => {
        const result = await biApi.query(params);
        if (!result.data) {
            return {columns: [], rows: []}
        }
        const sqlRes: SQLResult = new SQLResult();
        sqlRes.Headers = result.data.Headers;
        sqlRes.ColumnTypes = result.data.ColumnTypes;
        if (result.data.DataVals && result.data.DataVals.length > 0) {
            sqlRes.DataVals = result.data.DataVals.map((v) => {
                return Object.fromEntries(Object.entries(v).map(([k, v]) => {
                    return [k, toStringOrEmpty(v)];
                }));
            })
        }
        return sqlRes.toDataTable()
    }
}