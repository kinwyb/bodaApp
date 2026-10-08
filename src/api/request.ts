import type { ApiResponse, RequestOptions } from './types';

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';
const TOKEN_KEY = 'boda_token';
const MOCK_ENABLED = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'false';

/** 接口返回 code 非 0，或网络/解析异常时抛出 */
export class ApiError extends Error {
  readonly code: number;

  constructor(code: number, errmsg: string) {
    super(errmsg || `请求失败 (code: ${code})`);
    this.name = 'ApiError';
    this.code = code;
  }
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

function buildQuery(params?: RequestOptions['params']): string {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, String(item)));
    } else if (value instanceof Date) {
      search.append(key, value.toISOString());
    } else {
      search.append(key, String(value));
    }
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
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
  const { params, body, headers, signal } = options;
  const upperMethod = method.toUpperCase();
  // GET / DELETE 的查询条件放在 URL query 中，其余方法放在 body
  const useQuery = upperMethod === 'GET' || upperMethod === 'DELETE' || upperMethod === 'HEAD';
  const queryString = useQuery ? buildQuery(params) : '';

  if (MOCK_ENABLED) {
    const { mockRequest } = await import('./mock');
    const mocked = await mockRequest<T>({
      method: upperMethod,
      path,
      params: useQuery ? params : undefined,
      body,
    });
    if (mocked) {
      if (mocked.code !== 0) {
        throw new ApiError(mocked.code, mocked.errmsg ?? '请求失败');
      }
      return mocked;
    }
  }

  const token = getToken();
  const response = await fetch(`${joinUrl(path)}${queryString}`, {
    method: upperMethod,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new ApiError(response.status, `网络请求失败：${response.status} ${response.statusText}`);
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(-1, '响应内容不是合法的 JSON');
  }

  if (typeof payload?.code !== 'number') {
    throw new ApiError(-1, '响应格式不符合约定');
  }
  if (payload.code !== 0) {
    throw new ApiError(payload.code, payload.errmsg ?? '请求失败');
  }
  return payload;
}

/** 按 HTTP 方法封装的快捷调用 */
export const http = {
  get: <T = unknown>(path: string, params?: RequestOptions['params'], options?: Omit<RequestOptions, 'params' | 'body'>) =>
    request<T>('GET', path, { params, ...options }),
  post: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { body, ...options }),
  put: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PUT', path, { body, ...options }),
  patch: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PATCH', path, { body, ...options }),
  delete: <T = unknown>(path: string, params?: RequestOptions['params'], options?: Omit<RequestOptions, 'params'>) =>
    request<T>('DELETE', path, { params, ...options }),
};
