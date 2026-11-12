import type {SimpleDataTable} from "@/api/modules/sql.ts";
import type {AppColumnLeafDef, ColumnDataType} from "@/components/grid-table/columnBuilder.ts";

export type DataTableOptions = {
    /** 默认列宽，与历史 BI 表格保持一致 */
    width?: number;
    /** 是否为可筛选类型生成 filterType */
    filterable?: boolean;
    /** 数值列是否自动求和 */
    summarizeNumeric?: boolean;
    /** 可选行主键字段；生成结果时按行序号补值 */
    rowKeyField?: string;
};

/** SQL/BI 的列类型 → GridTable 的 dataType。动态报表统一走这一份映射 */
export function toAppColumnDataType(dataType: SimpleDataTable['columns'][number]['dataType']): ColumnDataType {
    switch (dataType) {
        case 'DATETIME':
            return 'datetime';
        case 'DATE':
            return 'date';
        case 'INT':
            return 'int';
        case 'DECIMAL':
        case 'FLOAT':
        case 'DOUBLE':
            return 'double';
        case 'BIT':
            return 'boolean';
        default:
            return 'text';
    }
}

function toFilterType(dataType: ColumnDataType): AppColumnLeafDef['filterType'] | undefined {
    if (dataType === 'int' || dataType === 'double') return 'number';
    if (dataType === 'date' || dataType === 'datetime') return 'date';
    return 'text';
}

/**
 * 数据表
 */
export class DataTable {

    /** SQL 结果列 → 叶子列（标题组在这里没有意义，全是数据列） */
    columns: AppColumnLeafDef[];
    datas: Record<string, unknown>[];

    constructor(simpleData: SimpleDataTable, options: DataTableOptions = {}) {
        const width = options.width ?? 80;
        this.columns = simpleData.columns.map((column): AppColumnLeafDef => {
            const dataType = toAppColumnDataType(column.dataType);
            const numeric = dataType === 'int' || dataType === 'double';
            return {
                field: column.columnName,
                title: column.caption,
                width,
                dataType,
                ...(options.filterable ? {filterType: toFilterType(dataType)} : {}),
                ...(options.summarizeNumeric && numeric ? {aggregate: 'sum' as const} : {}),
            };
        })
        this.datas = simpleData.rows.map((row, rowIndex) => {
            const record = Object.fromEntries(row.map((v, index) => {
                return [this.columns[index].field, v]
            }));
            if (options.rowKeyField) record[options.rowKeyField] = String(rowIndex);
            return record;
        })
    }

}
