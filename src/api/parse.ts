import type {ZodType} from 'zod';
import type {ApiResponse} from './types';

/**
 * 用 zod schema 校验并转换后端响应体。
 *
 * 收掉各接口里重复的这一段：
 * ```ts
 * if (res.data === undefined || res.data === null) return {...res, data: undefined};
 * return {...res, data: XxxSchema.array().parse(res.data)};
 * ```
 * 变成一行：
 * ```ts
 * return parseData(res, XxxSchema.array());
 * ```
 *
 * **是不是数组由调用点决定**：要数组传 `XxxSchema.array()`，要对象传 `XxxSchema`。
 * 别指望函数自己判断 —— 类型参数 `T` 只存在于编译期，运行时拿不到
 * 「这里该不该是数组」。代价只是多敲 `.array()`，换来的是：
 * - `T` 由 schema 自动推导，不需要手写泛型参数；
 * - 函数声明的返回类型与 schema 不一致时（比如声明 `Xxx[]` 却只传了 `XxxSchema`）
 *   直接编译报错，而不是等到运行时才炸。
 *
 * `data` 为 `null` / `undefined` 时不校验，原样返回 `data: undefined`：
 * 后端用 null 表示「没查到」，这是正常结果而非错误，schema 不该为此抛错。
 *
 * 已经拿到响应对象时用它；还没发请求时用 `http.getSchema` 等变体，一步到位。
 */
export function parseData<T>(res: ApiResponse<unknown>, schema: ZodType<T>): ApiResponse<T> {
    if (res.data === undefined || res.data === null) {
        return {...res, data: undefined};
    }
    return {...res, data: schema.parse(res.data)};
}

/** 请求 + 校验合流，`http.xxxSchema` 内部用 */
export async function fetchParsed<T>(
    pending: Promise<ApiResponse<unknown>>,
    schema: ZodType<T>,
): Promise<ApiResponse<T>> {
    return pending.then((res) => parseData(res, schema));
}
