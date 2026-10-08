import {ApiError, http} from '../request';
import type {ApiResponse} from "@/api";

export const DataSource = {
    /**
     * 博大
     */
    Boda: 1,
    /**
     * Nautilus
     */
    Nautilus: 2,
    /**
     * 染色
     */
    Dye: 3,
} as const;

export type DataSource = typeof DataSource[keyof typeof DataSource];

/**
 * 查询执行参数
 */
export interface SQLQuery {
    /**
     * SQL语句
     */
    SQL: string;
    /**
     * 数据源
     */
    DataSource?: DataSource;
    /**
     * 参数
     */
    Args?: string[]
}

/**
 * 构建SQL查询请求
 * @param params
 */
const buildSQLQueryRequest = (params: SQLQuery): SQLQuery & { Secret: string; } => {
    const trimmed = params.SQL.trim();
    if (!trimmed) {
        return {SQL: '', Secret: 'SQL不能为空', DataSource: params.DataSource};
    }

    const lower = trimmed.toLowerCase();
    if (
        lower.includes('delete ') ||
        lower.includes('update ') ||
        lower.includes('insert ') ||
        lower.includes(';') ||
        lower.includes(' set ') ||
        !lower.startsWith('select')
    ) {
        return {
            SQL: '',
            Secret: '非法SQL:仅允许SELECT语句',
            DataSource: params.DataSource,
        };
    }

    // const signSource = [
    //     Common.DefaultAPI.Token,
    //     trimmed,
    //     Common.IP,
    //     ...(args ?? []),
    //     Common.DefaultAPI.Token,
    // ].join('');

    return {
        SQL: trimmed,
        Args: params.Args,
        Secret: 'md5', //这里要对内容md5摘要
        DataSource: params.DataSource,
    };
}

/**
 * 存储过程执行参数
 */
export interface SQLProcedure {
    /**
     * 存储过程名称
     */
    ProcedureName: string;
    /**
     * 数据源
     */
    DataSource?: DataSource;
    /**
     * 参数
     */
    Args?: Record<string, string>
}

/**
 * 存储过程实际请求参数
 */
type sqlProcedureWithArrayArgs = Omit<SQLProcedure, 'Args'> & { Args?: string[]; Secret: string; };

/**
 * 存储过程参数校验
 * @param params
 */
const buildSQLProcedureRequest = (params: SQLProcedure): sqlProcedureWithArrayArgs => {
    const trimmed = params.ProcedureName.trim();

    if (!trimmed) {
        return {
            ProcedureName: '',
            Secret: 'SQL不能为空',
            DataSource: params.DataSource,
        };
    }

    const parseSQL = trimmed.toLowerCase();
    if (
        parseSQL.includes('delete ') ||
        parseSQL.includes('update ') ||
        parseSQL.includes('insert ') ||
        parseSQL.includes(';') ||
        parseSQL.includes(' set ') ||
        parseSQL.startsWith(' ')
    ) {
        return {
            ProcedureName: '',
            Secret: '非法SQL',
            DataSource: params.DataSource,
        };
    }

    // Dictionary<string, string> → string[]，格式 "key:value"
    const args: string[] = [];
    if (params.Args != null) {
        for (const key of Object.keys(params.Args)) {
            args.push(`${key}:${params.Args[key]}`);
        }
    }

    // const signSource = [
    //     Common.DefaultAPI.Token,
    //     trimmed,
    //     Common.IP,
    //     ...args,
    //     Common.DefaultAPI.Token,
    // ].join('');

    return {
        ProcedureName: trimmed,
        Args: args,
        Secret: 'md5', //md5摘要
        DataSource: params.DataSource,
    };
}


// ============================================================
// 返回类型定义
// ============================================================

/** 列数据类型 */
export type ColumnDataType =
    | 'INT'
    | 'DECIMAL'
    | 'BIT'
    | 'DATE'
    | 'DATETIME'
    | 'STRING';

/** 字段目标类型（用于 parse 转换） */
export type FieldType = 'string' | 'number' | 'boolean' | 'date';

// 类型预设常量
export const S = {type: 'string'} as const;
export const N = {type: 'number'} as const;
export const B = {type: 'boolean'} as const;
export const D = {type: 'date'} as const;

/** 单个字段的解析配置 */
export interface FieldConfig {
    /** SQL 结果中的字段名，缺省时用对象属性名同名匹配 */
    field?: string;
    /** 目标类型，缺省为 'string' */
    type?: FieldType;
    /** 自定义转换函数，优先级高于 type */
    convert?: (value: string, row: Record<string, string>) => unknown;
}

/** mapping：键 = 对象属性名，值 = 字段配置 */
export type FieldMapping<T> = {
    [K in keyof T]: FieldConfig;
};

/** 简化版 DataTable 的列定义 */
export interface DataColumn {
    columnName: string;
    caption: string;
    dataType: ColumnDataType;
}

/** 简化版 DataTable */
export interface SimpleDataTable {
    columns: DataColumn[];
    rows: Array<Array<string | number | boolean | Date | null>>;
}

/** 按 FieldType 转换 */
function convertByFieldType(raw: string, type: FieldType): unknown {
    switch (type) {
        case 'number': {
            const n = Number(raw);
            return Number.isNaN(n) ? raw : n;
        }
        case 'boolean':
            return raw === '1' || raw.toLowerCase() === 'true';
        case 'date': {
            const d = new Date(raw);
            return Number.isNaN(d.getTime()) ? raw : d;
        }
        case 'string':
        default:
            return raw;
    }
}

/** 按 ColumnDataType 转换（用于 field / toDataTable） */
function convertByColumnType<T = string>(
    value: string | undefined,
    type?: ColumnDataType,
): T | undefined {
    if (value == null) return value as unknown as T;
    if (!type || type === 'STRING') return value as unknown as T;

    switch (type) {
        case 'INT': {
            const n = parseInt(value, 10);
            return (Number.isNaN(n) ? value : n) as unknown as T;
        }
        case 'DECIMAL': {
            const n = parseFloat(value);
            return (Number.isNaN(n) ? value : n) as unknown as T;
        }
        case 'BIT':
            return (value === '1' || value.toLowerCase() === 'true') as unknown as T;
        case 'DATE':
        case 'DATETIME': {
            const d = new Date(value);
            return (Number.isNaN(d.getTime()) ? value : d) as unknown as T;
        }
        default:
            return value as unknown as T;
    }
}

// ============================================================
// SQLResult
// ============================================================
export class SQLResult {
    /** 错误消息 */
    ErrMsg?: string;

    /** 列名 */
    Headers: string[] = [];

    /** 列类型 */
    ColumnTypes?: string[];

    /** 数据内容 */
    DataVals?: Array<Record<string, string>>;

    /** 是否错误 */
    get IsError(): boolean {
        return !!this.ErrMsg;
    }

    // ----------------------------------------------------------
    // 解析：单一 mapping 参数
    // ----------------------------------------------------------

    /**
     * 解析单行为对象
     * @param mapping 字段配置，键 = 对象属性名，值 = { field?, type?, convert? }
     * @param index   行索引，默认 0
     */
    parse<T extends object>(mapping: FieldMapping<T>, index = 0): Partial<T> | null {
        if (!this.DataVals || index >= this.DataVals.length) return null;
        return this.mapRow(mapping, this.DataVals[index]);
    }

    /**
     * 解析成对象数组
     */
    parseToList<T extends object>(mapping: FieldMapping<T>): Array<Partial<T>> | null {
        if (!this.DataVals) return null;
        return this.DataVals.map((row) => this.mapRow(mapping, row));
    }

    // ----------------------------------------------------------
    // 单字段读取
    // ----------------------------------------------------------

    /**
     * 获取单个字段值
     * 会按 ColumnTypes 自动转换
     */
    field<T = string>(fieldName: string, index = 0): T | undefined {
        if (!this.DataVals || index >= this.DataVals.length) return undefined;
        const row = this.DataVals[index];
        if (!(fieldName in row)) return undefined;
        return convertByColumnType<T>(row[fieldName], this.getColumnType(fieldName));
    }

    // ----------------------------------------------------------
    // 列类型
    // ----------------------------------------------------------

    /**
     * 获取字段数据类型
     */
    getColumnType(columnName: string): ColumnDataType {
        const index = this.Headers.indexOf(columnName);
        if (index >= 0 && index < (this.ColumnTypes?.length ?? 0)) {
            const t = this.ColumnTypes![index];
            switch (t) {
                case 'INT':
                case 'DECIMAL':
                case 'BIT':
                case 'DATE':
                case 'DATETIME':
                    return t as ColumnDataType;
            }
        }
        return 'STRING';
    }

    // ----------------------------------------------------------
    // 转 DataTable
    // ----------------------------------------------------------

    /**
     * 返回 SimpleDataTable
     * @param columnType 可选，为每列指定类型和显示名
     */
    toDataTable(
        columnType?: (
            columnName: string,
        ) => { type: ColumnDataType; caption: string } | null,
    ): SimpleDataTable {
        const columnTypeMap = new Map<string, ColumnDataType>();
        const table: SimpleDataTable = {columns: [], rows: []};

        for (const column of this.Headers) {
            if (!columnType) {
                columnTypeMap.set(column, 'STRING');
                table.columns.push({
                    columnName: column,
                    caption: column,
                    dataType: 'STRING',
                });
            } else {
                const info = columnType(column);
                if (!info) continue;
                columnTypeMap.set(column, info.type);
                table.columns.push({
                    columnName: column,
                    caption: info.caption,
                    dataType: info.type,
                });
            }
        }

        if (this.DataVals && table.columns.length > 0) {
            for (const row of this.DataVals) {
                const vals: Array<string | number | boolean | Date | null> = [];
                for (const col of table.columns) {
                    if (!(col.columnName in row)) {
                        vals.push(null);
                        continue;
                    }
                    const tp = columnTypeMap.get(col.columnName) ?? 'STRING';
                    const converted = convertByColumnType(row[col.columnName], tp);
                    vals.push((converted ?? null) as string | number | boolean | Date | null);
                }
                table.rows.push(vals);
            }
        }

        return table;
    }

    // ----------------------------------------------------------
    // 内部：单行映射
    // ----------------------------------------------------------

    private mapRow<T extends object>(
        mapping: FieldMapping<T>,
        row: Record<string, string>,
    ): Partial<T> {
        const result: Partial<T> = {};

        for (const key of Object.keys(mapping) as Array<keyof T>) {
            const config = mapping[key] as FieldConfig | undefined;
            if (!config) continue;

            // field 缺省时用属性名同名匹配
            const fieldName = config.field ?? (key as string);
            const raw = row[fieldName];
            if (raw === undefined) continue;

            try {
                const value = config.convert
                    ? config.convert(raw, row)
                    : convertByFieldType(raw, config.type ?? 'string');

                (result as Record<string, unknown>)[key as string] = value;
            } catch {
                // 转换失败保持缺省，和 C# 的 catch 行为一致
            }
        }

        return result;
    }
}

// SQLResul parse 用法
// const list = result.parseToList<YupaiOrder>({
//     ID: { type: 'number' },
//     Status: {
//         convert: (v) => ({ '1': '待处理', '2': '已处理' })[v] ?? '未知',
//     },
//     CreatedAt: {
//         field: 'CreateTime',
//         convert: (v) => new Date(v).toLocaleString(),
//     },
// });

/**
 * 包装返回对象，必须做这一层包装，否则json反序列化后只有属性值不带方法，无法调用SQLResult中带的方法
 * @param result
 */
function buildResult(result: ApiResponse<SQLResult>): ApiResponse<SQLResult> {
    if (result.data?.IsError) {
        throw new ApiError(500, result.data?.ErrMsg ?? "请求失败")
    }
    const resultData = new SQLResult();
    if (result.data) {
        resultData.Headers = result.data.Headers ?? [];
        resultData.ColumnTypes = result.data.ColumnTypes;
        resultData.DataVals = result.data.DataVals;
    }
    result.data = resultData
    return result;
}

/**
 * SQL操作的API
 */
export const sqlApi = {
    /**
     * 执行查询
     * @param params
     */
    query: async (params: SQLQuery): Promise<ApiResponse<SQLResult>> => {
        const request = buildSQLQueryRequest(params);
        if (!request.SQL) {
            throw new ApiError(500, request.Secret)
        }
        const result = await http.post<SQLResult>('/sqlAdapter/query', request);
        return buildResult(result);
    },
    /**
     * 执行存储过程
     * @param params
     */
    procedure: async (params: SQLProcedure): Promise<ApiResponse<SQLResult>> => {
        const request = buildSQLProcedureRequest(params);
        if (!request.ProcedureName) {
            throw new ApiError(500, request.Secret)
        }
        const result = await http.post<SQLResult>('/sqlAdapter/procedure', params);
        return buildResult(result);
    },
};