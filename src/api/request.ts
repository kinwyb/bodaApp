import type {ApiResponse, RequestOptions} from './types';

/** 接口基础路径。后端接口统一带 /v1/boda 前缀，兜底值与 .env 保持一致。 */
const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/v1/boda';
const TOKEN_KEY = 'boda_token';
const MOCK_ENABLED = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'false';

/**
 * 表示「凭证无效 / 已过期」的 code。
 * - 401 / 403：HTTP 状态码直接透传的情况；
 * - 10001：本项目后端的业务码，`{"code":10001,"errmsg":"用户未登入"}`（2026-10-12 实测）。
 */
const UNAUTHORIZED_CODES = new Set([401, 403, 10001]);

/** 接口返回 code 非 0，或网络/解析异常时抛出 */
export class ApiError extends Error {
    readonly code: number;

    constructor(code: number, errmsg: string) {
        super(errmsg || `请求失败 (code: ${code})`);
        this.name = 'ApiError';
        this.code = code;
    }
}

type SessionExpiredListener = () => void;

/**
 * 会话失效监听器。
 *
 * 请求层刻意不 import 任何 store —— 那会形成「请求 → store → 请求」的循环依赖。
 * 改为由 store 反向注册：接口拿到未授权响应时请求层只负责广播，
 * 具体怎么处理（清 token、退回登录页）交给 store 决定。
 */
let sessionExpiredListener: SessionExpiredListener | null = null;

/** 注册会话失效监听，返回注销函数 */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
    sessionExpiredListener = listener;
    return () => {
        if (sessionExpiredListener === listener) sessionExpiredListener = null;
    };
}

/** 该错误是否属于「凭证失效」。网络异常、5xx、响应解析失败都不算。 */
export function isUnauthorizedError(error: unknown): boolean {
    return error instanceof ApiError && UNAUTHORIZED_CODES.has(error.code);
}

/**
 * 统一抛错出口：凭证失效时先广播再抛出。
 * 收敛到一处，避免以后新增分支时漏掉广播。
 */
function fail(code: number, errmsg: string): never {
    const error = new ApiError(code, errmsg);
    if (isUnauthorizedError(error)) sessionExpiredListener?.();
    throw error;
}

export function getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
}

function joinUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const base = BASE_URL.replace(/\/$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
}

/**
 * query 与 form body 共用的取值规则：跳过空值，日期转 ISO 串，数组按重复键展开。
 * 两者只差「输出到 URL 还是请求体」，规则必须一致，所以抽出来一份。
 */
function appendParams(search: URLSearchParams, source: Record<string, unknown>): void {
    Object.entries(source).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (Array.isArray(value)) {
            value.forEach((item) => search.append(key, String(item)));
        } else if (value instanceof Date) {
            search.append(key, value.toISOString());
        } else {
            search.append(key, String(value));
        }
    });
}

function buildQuery(params?: RequestOptions['params']): string {
    if (!params) return '';
    const search = new URLSearchParams();
    appendParams(search, params as Record<string, unknown>);
    const qs = search.toString();
    return qs ? `?${qs}` : '';
}

/** 表单编码的请求体（application/x-www-form-urlencoded） */
function buildFormBody(body: unknown): string {
    if (typeof body !== 'object' || body === null) return String(body);
    const search = new URLSearchParams();
    appendParams(search, body as Record<string, unknown>);
    return search.toString();
}

/**
 * 统一请求入口。所有服务都通过 method + path + 参数调用，
 * 返回值固定为 { code, data, errmsg?, page? }，code 非 0 时抛 ApiError。
 */
export async function request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
): Promise<ApiResponse<T>> {
    const {params, body, headers, signal, contentType = 'json'} = options;
    const upperMethod = method.toUpperCase();
    // GET / DELETE 的查询条件放在 URL query 中，其余方法放在 body
    const useQuery = upperMethod === 'GET' || upperMethod === 'DELETE' || upperMethod === 'HEAD';
    const queryString = useQuery ? buildQuery(params) : '';

    if (MOCK_ENABLED) {
        const {mockRequest} = await import('./mock');
        const mocked = await mockRequest<T>({
            method: upperMethod,
            path,
            params: useQuery ? params : undefined,
            body,
        });
        if (mocked) {
            if (mocked.code !== 0) {
                fail(mocked.code, mocked.errmsg ?? '请求失败');
            }
            return mocked;
        }
    }

    const useForm = contentType === 'form';
    const token = getToken();
    const response = await fetch(`${joinUrl(path)}${queryString}`, {
        method: upperMethod,
        headers: {
            'Content-Type': useForm
                ? 'application/x-www-form-urlencoded'
                : 'application/json',
            // ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(token ? {token: `${token}`} : {}),
            ...headers,
        },
        body: body === undefined ? undefined : useForm ? buildFormBody(body) : JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        fail(response.status, `网络请求失败：${response.status} ${response.statusText}`);
    }

    let payload: ApiResponse<T>;
    try {
        payload = (await response.json()) as ApiResponse<T>;
    } catch {
        fail(-1, '响应内容不是合法的 JSON');
    }

    if (typeof payload?.code !== 'number') {
        fail(-1, '响应格式不符合约定');
    }
    if (payload.code !== 0) {
        fail(payload.code, payload.errmsg ?? '请求失败');
    }
    return payload;
}

/** 按 HTTP 方法封装的快捷调用 */
export const http = {
    get: <T = unknown>(path: string, params?: RequestOptions['params'], options?: Omit<RequestOptions, 'params' | 'body'>) =>
        request<T>('GET', path, {params, ...options}),
    post: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
        request<T>('POST', path, {body, ...options}),
    put: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
        request<T>('PUT', path, {body, ...options}),
    patch: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
        request<T>('PATCH', path, {body, ...options}),
    delete: <T = unknown>(path: string, params?: RequestOptions['params'], options?: Omit<RequestOptions, 'params'>) =>
        request<T>('DELETE', path, {params, ...options}),
};

/**
 * 错误消息转换
 * @param error
 * @param defaultMsg
 * @constructor
 */
export const ErrorMessage = (error: any, defaultMsg: string) => {
    return error instanceof ApiError ? error.message : defaultMsg;
}