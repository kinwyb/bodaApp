import {http} from "@/api";

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

export const biApi = {
    /**
     * 报表列表
     */
    list: () => http.get<BIList[]>('/bi/list')
}