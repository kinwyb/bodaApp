import type { ApiResponse, PageInfo, QueryParams } from '../types';

/**
 * Mock 数据按 API 路径组织在 data/ 目录下：
 *   /menus                          → data/menus.json
 *   /user/menus                     → data/user/menus.json
 *   /employees                      → data/employees.json
 *   /plan/yupaiOrder/list           → data/plan/yupaiOrder/list.json
 *   /plan/yupaiOrder/list/changes   → data/plan/yupaiOrder/list/changes.json
 *   /views/{any}/rows               → data/views/_dynamic/rows.json
 *
 * 命中规则：不论请求方法，一律先按路径找 data/ 下的同名 JSON 文件，
 * 命中即返回文件内容（数组自动分页）；只有文件不存在时才按方法走默认返回。
 *
 * 分页规则：请求参数包含 page 或 pageSize 时自动分页，否则返回全量数据。
 *
 * 未命中文件时的默认返回：
 *   GET / HEAD         → undefined，交回真实网络请求
 *   DELETE             → 空数据
 *   POST / PUT / PATCH → 回传请求体
 * 写操作均不持久化。
 */

/** 构建时 eager-import 所有 mock JSON，JSON 数据在 default 导出中 */
const MOCK_FILES = import.meta.glob<{ default: unknown }>('./data/**/*.json', { eager: true });

export interface MockRequestInit {
  method: string;
  path: string;
  params?: QueryParams;
  body?: unknown;
}

/** 按 API 路径查找 mock 数据文件，未命中返回 undefined */
function findMockData(apiPath: string): unknown | undefined {
  const key = `./data/${apiPath}.json`;
  const mod = MOCK_FILES[key];
  if (mod) return mod.default;

  // 动态路径降级：/views/V0005_V0010/rows → /views/_dynamic/rows
  const parts = apiPath.split('/');
  if (parts.length >= 3) {
    const fallback = [...parts.slice(0, -2), '_dynamic', parts[parts.length - 1]].join('/');
    const fallbackKey = `./data/${fallback}.json`;
    const fallbackMod = MOCK_FILES[fallbackKey];
    if (fallbackMod) return fallbackMod.default;
  }

  return undefined;
}

/**
 * 分页入参的形状：只要求能读出 page / pageSize。
 *
 * 不直接用 QueryParams 做索引访问 —— 它带一个 `object` 分支，没有索引签名，
 * `params.page` 会报 TS2339。而这个 shape 全是可选属性且类型为 unknown，
 * QueryParams 的任意分支都能赋进来，所以不必做类型断言。
 */
type PagingParams = {
  page?: unknown;
  pageSize?: unknown;
};

/** 自动分页：请求参数中有 page 或 pageSize 时启用 */
function autoPaginate<T>(list: T[], params: PagingParams): ApiResponse<T[]> {
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

  // 任意方法：先找对应 mock 文件，命中即返回文件内容
  const data = findMockData(apiPath);
  if (data !== undefined) {
    if (Array.isArray(data)) return autoPaginate(data, params) as ApiResponse<T>;
    return { code: 0, data: data as unknown as T };
  }

  // 未命中文件：DELETE 返回空数据
  if (method === 'DELETE') {
    return { code: 0, data: null as unknown as T };
  }

  // POST / PUT / PATCH：回传请求体
  if (body !== undefined) {
    return { code: 0, data: body as unknown as T };
  }

  // 其余（GET / HEAD 等）未命中，交回真实请求
  return undefined;
}
