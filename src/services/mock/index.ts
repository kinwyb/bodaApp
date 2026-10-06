import type { ApiResponse, PageInfo, QueryParams } from '../types';

/**
 * Mock 数据按 API 路径组织在 data/ 目录下：
 *   GET /menus              → data/menus.json
 *   GET /user/menus         → data/user/menus.json
 *   GET /preorders          → data/preorders.json
 *   GET /preorders/changes  → data/preorders/changes.json
 *   GET /preorders/filters  → data/preorders/filters.json
 *   GET /employees          → data/employees.json
 *   GET /views/{any}/rows   → data/views/_dynamic/rows.json
 *
 * 分页规则：请求参数包含 page 或 pageSize 时自动分页，否则返回全量数据。
 * 写操作（POST/PUT/DELETE）直接回传请求体，不持久化。
 */

/** 构建时 eager-import 所有 mock JSON，key 格式：./data/{path}.json */
const MOCK_FILES = import.meta.glob<Record<string, unknown>>('./data/**/*.json', { eager: true });

export interface MockRequestInit {
  method: string;
  path: string;
  params?: QueryParams;
  body?: unknown;
}

/** 按 API 路径查找 mock 数据文件，未命中返回 undefined */
function findMockData(apiPath: string): unknown[] | Record<string, unknown> | undefined {
  const key = `./data/${apiPath}.json`;
  const mod = MOCK_FILES[key];
  if (mod) return mod as unknown[] | Record<string, unknown>;

  // 动态路径降级：/views/V0005_V0010/rows → /views/_dynamic/rows
  const parts = apiPath.split('/');
  if (parts.length >= 3) {
    const fallback = [...parts.slice(0, -2), '_dynamic', parts[parts.length - 1]].join('/');
    const fallbackKey = `./data/${fallback}.json`;
    const fallbackMod = MOCK_FILES[fallbackKey];
    if (fallbackMod) return fallbackMod as unknown[] | Record<string, unknown>;
  }

  return undefined;
}

/** 自动分页：请求参数中有 page 或 pageSize 时启用 */
function autoPaginate<T>(list: T[], params: QueryParams): ApiResponse<T[]> {
  const hasPaging = params.page !== undefined || params.pageSize !== undefined;
  if (!hasPaging) {
    return { code: 0, data: list };
  }
  const page = Math.max(1, Number(params.page) || 1);
  const rows = Math.max(1, Number(params.pageSize) || 10);
  const total = list.length;
  const allpage = Math.max(1, Math.ceil(total / rows));
  const start = (page - 1) * rows;
  const pageInfo: PageInfo = { page, rows, total, allpage };
  return { code: 0, data: list.slice(start, start + rows), page: pageInfo };
}

/**
 * Mock 请求分发。返回 undefined 表示未命中 mock 规则，
 * 由调用方回退到真实网络请求。
 */
export async function mockRequest<T>(init: MockRequestInit): Promise<ApiResponse<T> | undefined> {
  const { method, params = {}, body } = init;
  const apiPath = init.path.replace(/^\/+/, '').replace(/\/+$/, '');

  // 模拟网络延迟
  await new Promise<void>((r) => setTimeout(r, 200));

  // GET：读取 mock 文件
  if (method === 'GET') {
    const data = findMockData(apiPath);
    if (data === undefined) return undefined;
    if (Array.isArray(data)) return autoPaginate(data, params) as ApiResponse<T>;
    return { code: 0, data: data as unknown as T };
  }

  // DELETE：返回空数据
  if (method === 'DELETE') {
    return { code: 0, data: null as unknown as T };
  }

  // POST / PUT / PATCH：回传请求体
  if (body !== undefined) {
    return { code: 0, data: body as unknown as T };
  }

  return undefined;
}
