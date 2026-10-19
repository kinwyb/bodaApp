import {ApiError, http} from '../request';
// ApiResponse 在 ../types 里，别从 "@/api"（barrel）引 —— api 内部的模块引 barrel 会绕回自己，
// 轻则多一层循环，重则像 modules/yupai.ts 那样在模块评估期踩到未初始化的导出
import type {ApiResponse} from "../types";

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
    | 'FLOAT'
    | 'DOUBLE'
    | 'BIT'
    | 'DATE'
    | 'DATETIME'
    | 'STRING';

/**
 * 字段目标类型（用于 parse 转换）。
 *
 * **没有 `'date'`**：这一层只负责「SQL 字符串 → 目标类型」，日期在后端是字符串、
 * 到这一层也仍是字符串。转成 `Dayjs` 是**业务模型**的事（services 层的 `toYupaiOrder`）。
 *
 * 在原始层就转日期的话，HTTP 直返那条路（没有 mapping）没人转 ——
 * 两条路的日期形态必然不一致，这正是之前踩过的坑。
 */
export type FieldType = 'string' | 'number' | 'boolean';

/**
 * 类型预设常量。`Op` 前缀 = optional（缺列时写 undefined 且整个 key 不写，
 * 见 FieldConfig.optional）。
 */
export const S = {type: 'string'} as const;
export const N = {type: 'number'} as const;
export const B = {type: 'boolean'} as const;
export const OpS = {type: 'string', optional: true} as const;
export const OpN = {type: 'number', optional: true} as const;
export const OpB = {type: 'boolean', optional: true} as const;

/** 单个字段的解析配置 */
export interface FieldConfig {
    /** SQL 结果中的字段名，缺省时用对象属性名同名匹配 */
    field?: string;
    /** 目标类型，缺省为 'string' */
    type?: FieldType;
    /** 自定义转换函数，优先级高于 type */
    convert?: (value: string, row: Record<string, string>) => unknown;
    /**
     * 「允许没有」：SQL 里没有这一列（或值为 null、转换失败、convert 返回空）时，
     * 写 **undefined 且整个 key 都不写**，而不是类型默认值。
     *
     * 给 T 里声明成可选的字段用（`Memo?: string`）—— 让「真的没有」和
     * 「查到了空值」在结果里区分得开：'' / 0 / false 属于后者
     * （有这个字段，值是空），undefined（key 不存在）才是前者。
     *
     * 优先级在 `default` 之下：两处都配了以 `default` 为准。
     */
    optional?: boolean;
    /**
     * 兜底值：SQL 结果里**没有这一列**（或转换失败、convert 返回空）时写进结果的值。
     * 不配就按 `type` 取类型默认值（见 defaultValueByType：'' / 0 / false）。
     *
     * 配 `undefined` 视为没配 —— 否则又会把 undefined 带进结果，
     * 「返回完整的 T」这个承诺就不成立了（那还不如退回 Partial<T>）。
     * **要 undefined 请用 `optional: true`**，别写 `default: undefined`。
     */
    default?: unknown;
}

/**
 * mapping：键 = 对象属性名，值 = 字段配置。
 *
 * `-?` 不能省：T 里声明成可选的字段（`Memo?: string`）如果不加它，mapped type 会保留
 * 可选修饰 → 这个字段在 mapping 里**可以不写** → 结果对象上连 key 都没有
 * （读出来是 undefined，而兜底逻辑根本没参与），
 * 「mapping 覆盖 T 全部具名字段」这个编译期保证也就形同虚设了。
 * 加上之后漏写报 TS2741；想让可选字段在缺列时就是 undefined，写 `{optional: true}`。
 */
export type FieldMapping<T> = {
    [K in keyof T]-?: FieldConfig;
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
    /** 单元格值：不含 `Date` —— 日期列也是原样字符串（见 FieldType 的注释） */
    rows: Array<Array<string | number | boolean | null>>;
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
        case 'string':
        default:
            return raw;
    }
}

/**
 * 字段「查不到值」时的类型默认值（`FieldConfig.default` 优先于它）。
 *
 * 存在的理由：`parse` / `parseToList` 承诺返回**完整的 T**（不再是 Partial<T>），
 * 那么每个字段都必须有值可写 —— 这就是「SQL 里没这一列」时写进去的东西。
 * 少了它，「字段全都在」就不再是构造上的保证，返回 T 只能靠一句无根据的断言。
 */
function defaultValueByType(type: FieldType): unknown {
    switch (type) {
        case 'number':
            return 0;
        case 'boolean':
            return false;
        case 'string':
        default:
            return '';
    }
}

/** 按 ColumnDataType 转换（用于 field / toDataTable / parse 的未声明列） */
function convertByColumnType<T = string>(
    value: string | null | undefined,
    type?: ColumnDataType,
): T | null | undefined {
    if (value == null) return value as unknown as T;
    if (!type || type === 'STRING') return value as unknown as T;

    switch (type) {
        case 'INT': {
            const n = parseInt(value, 10);
            return (Number.isNaN(n) ? value : n) as unknown as T;
        }
        case 'DECIMAL':
        case 'FLOAT':
        case 'DOUBLE': {
            const n = parseFloat(value);
            return (Number.isNaN(n) ? value : n) as unknown as T;
        }
        case 'BIT':
            return (value === '1' || value.toLowerCase() === 'true') as unknown as T;
        case 'DATE':
        case 'DATETIME':
            // 后端声明的列类型确实是日期，但值**保持原样字符串** ——
            // 日期转换统一在 services 层做，原始层不引入第二种形态（见 FieldType 的注释）
            return value as unknown as T;
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
     * 解析单行为对象。
     *
     * 返回的是**完整的 T**（不是 Partial<T>）：结果里没有对应列的字段写
     * `FieldConfig.default`，没配则按 `type` 写类型默认值（'' / 0 / false）。
     *
     * 唯一例外是配了 `optional: true` 的字段 —— 那种字段「没有」就该是「没有」，
     * 结果对象上**连 key 都不写**，读出来是 undefined（见 FieldConfig.optional）。
     * 所以调用方读属性一般不用 `?.`，除非该字段确实声明成可选并配了 optional。
     *
     * mapping 只负责「转换 / 重命名 / 兜底」的字段；SQL 返回的**其余列会以列名为属性名
     * 一并带出来**（按后端声明的列类型转换，详见 mapRow），不会出现「查回来了却读不到」。
     *
     * @param mapping 字段配置，键 = 对象属性名，值 = { field?, type?, convert?, optional?, default? }
     * @param index   行索引，默认 0
     */
    parse<T extends object>(mapping: FieldMapping<T>, index = 0): T | null {
        if (!this.DataVals || index >= this.DataVals.length) return null;
        return this.mapRow(mapping, this.DataVals[index]);
    }

    /**
     * 解析成对象数组（每个元素都是完整的 T，见 parse）
     */
    parseToList<T extends object>(mapping: FieldMapping<T>): T[] | null {
        if (!this.DataVals) return null;
        return this.DataVals.map((row) => this.mapRow(mapping, row));
    }

    // ----------------------------------------------------------
    // 单字段读取
    // ----------------------------------------------------------

    /**
     * 获取单个字段值
     * 会按 ColumnTypes 自动转换
     *
     * 没有这一列 / 行号越界 → `undefined`（日期列也不会给 `null` —— 这一层的日期就是字符串）
     */
    field<T = string>(fieldName: string, index = 0): T | null | undefined {
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
                case 'FLOAT':
                case 'DOUBLE':
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
                const columnType = this.getColumnType(column);
                columnTypeMap.set(column, columnType);
                table.columns.push({
                    columnName: column,
                    caption: column,
                    dataType: columnType,
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
                const vals: Array<string | number | boolean | null> = [];
                for (const col of table.columns) {
                    if (!(col.columnName in row)) {
                        vals.push(null);
                        continue;
                    }
                    const tp = columnTypeMap.get(col.columnName) ?? 'STRING';
                    const converted = convertByColumnType(row[col.columnName], tp);
                    vals.push((converted ?? null) as string | number | boolean | null);
                }
                table.rows.push(vals);
            }
        }

        return table;
    }

    // ----------------------------------------------------------
    // 内部：单行映射
    // ----------------------------------------------------------

    /**
     * 单行映射：**每个字段都会写值**，返回完整对象（唯一例外是 `optional: true`，见下）。
     *
     * 分两遍，缺一不可：
     *
     * ① **按 mapping 走**（保证 T 的具名字段一个不少，且带上转换 / 重命名 / 兜底）：
     *    - 三种「没值」的情况统一走兜底：
     *      · SQL 结果里没有这一列（含值为 null）
     *      · convert / 类型转换抛异常
     *      · convert 自己返回了 undefined / null
     *      兜底值三级（见 FieldConfig）：`default` → `optional`（写 undefined，且整个 key 不写）
     *      → 按 type 的类型默认值。配了 `optional: true` 的字段就是上面那句「唯一例外」。
     *      原来第一、二种是被跳过的（`raw === undefined` 就 continue / catch 后什么都不写），
     *      结果对象会缺 key —— 这就是 Partial<T> 的来源。
     *    - 也必须走这一遍，因为：列名 ≠ 属性名（`field: 'MC_SIZE1'` → `MCSize1`）；
     *      SQL 没返回某一列时，只有 mapping 里有 type/default，才补得出默认值；
     *      另外属性名可能压根不是任何列名。
     *
     * ② **按 Headers（SQL 真正返回的列）补一遍**：mapping 没提到的列以**列名**为属性名带出来，
     *    取值按后端声明的列类型转换（与 `field()` 同一套）。不走这一遍的话，
     *    `SELECT *` 查回来的列在结果里根本读不到（读到 undefined），哪怕 SQL 明明返回了 ——
     *    对带索引签名的 T（如 YupaiOrder 的 `[key: string]: unknown`）编译器也不会提醒。
     *    想改某列的形态（转成字符串 / 换属性名 / 给默认值）就把它写进 mapping，会走 ①。
     *
     * 两遍的优先级：mapping 先写，补列时跳过「已用掉的列名」和「已存在的属性名」，
     * 所以 mapping 永远说了算。
     *
     * 「mapping 覆盖 T 的全部具名字段」由 FieldMapping<T> 的全必填类型保证：少写一个 key 编译不过。
     */
    private mapRow<T extends object>(mapping: FieldMapping<T>, row: Record<string, string>): T {
        const result: Record<string, unknown> = {};
        /** mapping 已经用掉的 SQL 列名（含 field 映射过去的），补列时不能重复写一遍 */
        const usedColumns = new Set<string>();

        for (const key of Object.keys(mapping) as Array<keyof T>) {
            // 类型上 mapping 的每个键都有配置，这里的兜底只是防运行时手抖
            const config = (mapping[key] as FieldConfig | undefined) ?? {};
            // field 缺省时用属性名同名匹配
            const fieldName = config.field ?? (key as string);
            usedColumns.add(fieldName);
            const raw = row[fieldName] as string | null | undefined;
            /**
             * 三级兜底：`default` 优先；其次 `optional`（缺就是真缺，不给默认值）；
             * 最后才按 `type` 取类型默认值。
             * 注意 `default: undefined` 仍视为没配 —— undefined 的唯一出口是 `optional: true`。
             */
            const fallback =
                config.default !== undefined
                    ? config.default
                    : config.optional
                        ? undefined
                        : defaultValueByType(config.type ?? 'string');

            /**
             * 写兜底值。兜底为 undefined（即 `optional: true` 且没配 default）时
             * **整个 key 都不写**：写一个值为 undefined 的键会凭空多出一个 key，
             * 按 Object.keys 判空的 isBlankExcept / Object.keys(row).length 会看到它，
             * 而「字段不存在」与「字段值是 undefined」不该混作一谈。
             */
            const writeFallback = (): void => {
                if (fallback === undefined) return;
                result[key as string] = fallback;
            };

            if (raw === undefined || raw === null) {
                writeFallback();
                continue;
            }

            try {
                const value = config.convert
                    ? config.convert(raw, row)
                    : convertByFieldType(raw, config.type ?? 'string');

                if (value === undefined || value === null) writeFallback();
                else result[key as string] = value;
            } catch {
                // 转换失败用兜底值（原来这里是「跳过这个字段」，和 C# 的 catch 行为一致 ——
                // 但跳过会让返回的对象缺 key，与返回 T 的承诺冲突）
                writeFallback();
            }
        }

        // ② SQL 返回、但 mapping 没声明的列：原样带出来（属性名 = 列名）
        for (const column of this.Headers) {
            if (usedColumns.has(column)) continue;
            // 列名与 mapping 写出的属性名撞车时以 mapping 为准（别覆盖掉转换过的值）
            if (column in result) continue;
            const raw = row[column] as string | null | undefined;
            // 这一行没有这个列（Headers 与实际数据对不上）就跳过，免得凭空多一个 undefined 字段
            if (raw === undefined) continue;
            result[column] = convertByColumnType(raw, this.getColumnType(column));
        }

        return result as T;
    }
}

// SQLResult parse 用法
// const list = result.parseToList<YupaiOrder>({
//     ID: { type: 'number' },
//     Status: {
//         convert: (v) => ({ '1': '待处理', '2': '已处理' })[v] ?? '未知',
//     },
//     CreatedAt: {
//         field: 'CreateTime',
//         convert: (v) => new Date(v).toLocaleString(),
//     },
//     // SQL 里没有这一列时想给别的值就配 default；不配则按 type 给 '' / 0 / false
//     Memo: { type: 'string', default: '-' },
// });

/**
 * 包装返回对象，必须做这一层包装，否则json反序列化后只有属性值不带方法，无法调用SQLResult中带的方法
 * @param result
 */
function buildResult(result: ApiResponse<SQLResult>): ApiResponse<SQLResult> {
    if (result.code != 0 || result.data?.IsError) {
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