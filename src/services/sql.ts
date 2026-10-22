import type {SimpleDataTable} from "@/api/modules/sql.ts";
import type {AppColumnLeafDef, ColumnDataType} from "@/components/grid-table/columnBuilder.ts";

/**
 * 数据表
 */
export class DataTable {

    /** SQL 结果列 → 叶子列（标题组在这里没有意义，全是数据列） */
    columns: AppColumnLeafDef[];
    datas: Record<string, unknown>[];

    constructor(simpleData: SimpleDataTable) {
        this.columns = simpleData.columns.map((column): AppColumnLeafDef => {
            let dataType: ColumnDataType = 'text'
            switch (column.dataType) {
                case "DATETIME":
                    dataType = 'datetime';
                    break;
                case 'DATE':
                    dataType = 'date';
                    break;
                case 'INT':
                    dataType = 'int';
                    break;
                case 'DECIMAL':
                case 'FLOAT':
                case 'DOUBLE':
                    dataType = 'double';
                    break;
                case 'BIT':
                    dataType = 'boolean';
                    break;
            }
            return {field: column.columnName, title: column.caption, width: 80, dataType: dataType};
        })
        this.datas = simpleData.rows.map(row => {
            return Object.fromEntries(row.map((v, index) => {
                return [this.columns[index].field, v]
            }));
        })
    }

}