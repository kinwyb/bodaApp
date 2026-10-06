import dayjs from 'dayjs';
import type { MenuNode, UserMenuPermission } from '../modules/menu';
import type { PreorderChange, PreorderRecord } from '../modules/preorder';
import type { ApiResponse, QueryParams } from '../types';
import menus from './menus.json';
import preorderChangesJson from './preorderChanges.json';
import preordersJson from './preorders.json';
import userMenus from './userMenus.json';

const menuTree = menus as unknown as MenuNode[];
const permissionTree = userMenus as unknown as UserMenuPermission[];
const preorders = preordersJson as unknown as PreorderRecord[];
const preorderChanges = preorderChangesJson as unknown as PreorderChange[];

/** 按数据集自动生成筛选候选项：低基数、短文本的字段才作为枚举候选 */
function buildFilterOptions(rows: PreorderRecord[]): Record<string, string[]> {
  const options: Record<string, string[]> = {};
  if (!rows.length) return options;
  Object.keys(rows[0]).forEach((field) => {
    if (field === 'ID' || field.endsWith('ID')) return;
    const values = new Set<string>();
    for (const row of rows) {
      const value = row[field];
      if (value === undefined || value === null || value === '') continue;
      const text = String(value);
      if (text.length > 30) return;
      values.add(text);
      if (values.size > 60) return;
    }
    if (values.size > 0 && values.size <= 60) {
      options[field] = [...values].sort();
    }
  });
  return options;
}

interface FilterConditionInput {
  values?: string[];
  min?: string | number;
  max?: string | number;
  text?: string;
}

/** 应用自定义筛选条件 */
function applyFilters(list: PreorderRecord[], filters?: string): PreorderRecord[] {
  if (!filters) return list;
  let model: Record<string, FilterConditionInput>;
  try {
    model = JSON.parse(filters) as Record<string, FilterConditionInput>;
  } catch {
    return list;
  }
  let result = [...list];
  Object.entries(model).forEach(([field, condition]) => {
    if (!condition) return;
    const { values, min, max, text } = condition;
    if (values?.length) {
      const allow = new Set(values.map(String));
      result = result.filter((item) => allow.has(String(item[field] ?? '')));
    }
    if (text) {
      const keyword = text.toLowerCase();
      result = result.filter((item) => String(item[field] ?? '').toLowerCase().includes(keyword));
    }
    if (min !== undefined && min !== '') {
      result = result.filter((item) => {
        const value = item[field];
        if (value === undefined || value === null || value === '') return false;
        return typeof min === 'number'
          ? Number(value) >= min
          : String(value).slice(0, 10) >= String(min);
      });
    }
    if (max !== undefined && max !== '') {
      result = result.filter((item) => {
        const value = item[field];
        if (value === undefined || value === null || value === '') return false;
        return typeof max === 'number' ? Number(value) <= max : String(value).slice(0, 10) <= String(max);
      });
    }
  });
  return result;
}

export interface MockRequestInit {
  method: string;
  path: string;
  params?: QueryParams;
  body?: unknown;
}

interface MockEntity {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createOrders(): MockEntity[] {
  const statuses = ['pending', 'processing', 'completed', 'cancelled'];
  return Array.from({ length: 171 }, (_, i) => ({
    id: `ORD-${String(i + 1).padStart(4, '0')}`,
    name: `订单项目 ${i + 1}`,
    status: statuses[i % statuses.length],
    createdAt: dayjs().subtract(i, 'day').format('YYYY-MM-DD HH:mm:ss'),
  }));
}

function createUsers(): MockEntity[] {
  return Array.from({ length: 36 }, (_, i) => ({
    id: `USR-${String(i + 1).padStart(3, '0')}`,
    name: `用户${i + 1}`,
    status: i % 3 === 0 ? 'inactive' : 'active',
    createdAt: dayjs().subtract(i, 'day').format('YYYY-MM-DD HH:mm:ss'),
  }));
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** 生成本地 mock 主键：优先用 UUID，退化到时间戳 */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().toUpperCase();
  }
  return `MOCK-${Date.now().toString(16).toUpperCase()}`;
}

/** 按 View 路径生成稳定的列表数据，保证同一菜单每次进入行数一致 */
function createViewRows(view: string): MockEntity[] {
  const seed = hashString(view);
  const count = 15 + (seed % 40);
  return Array.from({ length: count }, (_, i) => ({
    id: `${view}-${String(i + 1).padStart(3, '0')}`,
    name: `${view} 记录 ${i + 1}`,
    status: (seed + i) % 2 === 0 ? 'enabled' : 'disabled',
    createdAt: dayjs().subtract(i, 'day').format('YYYY-MM-DD HH:mm:ss'),
  }));
}

const orders = createOrders();
const users = createUsers();
const viewRows = new Map<string, MockEntity[]>();

function getViewRows(view: string): MockEntity[] {
  let rows = viewRows.get(view);
  if (!rows) {
    rows = createViewRows(view);
    viewRows.set(view, rows);
  }
  return rows;
}

/** 按标准分页参数裁剪并组装 page 对象 */
function paginate<T>(list: T[], params: QueryParams = {}): ApiResponse<T[]> {
  const page = Math.max(1, Number(params.page) || 1);
  const rows = Math.max(1, Number(params.pageSize) || 10);
  const total = list.length;
  const allpage = Math.max(1, Math.ceil(total / rows));
  const start = (page - 1) * rows;
  return {
    code: 0,
    data: list.slice(start, start + rows),
    page: { page, rows, total, allpage },
  };
}

function filterEntities(list: MockEntity[], params: QueryParams): MockEntity[] {
  let result = [...list];
  if (params.keyword) {
    const keyword = String(params.keyword).toLowerCase();
    result = result.filter(
      (item) => item.id.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword),
    );
  }
  if (params.status) {
    result = result.filter((item) => item.status === params.status);
  }
  if (params.startDate) {
    result = result.filter((item) => item.createdAt.slice(0, 10) >= String(params.startDate));
  }
  if (params.endDate) {
    result = result.filter((item) => item.createdAt.slice(0, 10) <= String(params.endDate));
  }
  return result;
}

function filterPreorders(list: PreorderRecord[], params: QueryParams): PreorderRecord[] {
  let result = applyFilters(list, params.filters ? String(params.filters) : undefined);
  if (params.keyword) {
    const keyword = String(params.keyword).toLowerCase();
    result = result.filter(
      (item) =>
        item.OrderCode.toLowerCase().includes(keyword) ||
        item.StyleCode.toLowerCase().includes(keyword) ||
        item.ProduceName.toLowerCase().includes(keyword) ||
        item.Ywy.toLowerCase().includes(keyword) ||
        item.Memo.toLowerCase().includes(keyword),
    );
  }
  if (params.salesman) result = result.filter((item) => item.Ywy === params.salesman);
  if (params.workPlace) result = result.filter((item) => item.WorkPlace === params.workPlace);
  return result;
}

const notFound = <T>(label: string, id: string): ApiResponse<T> => ({
  code: 1,
  data: null as unknown as T,
  errmsg: `${label} ${id} 不存在`,
});

/**
 * 本地 mock 请求分发。返回 undefined 表示未命中 mock 规则，
 * 由调用方回退到真实网络请求。
 */
export async function mockRequest<T>(init: MockRequestInit): Promise<ApiResponse<T> | undefined> {
  const { method, params = {}, body } = init;
  const path = init.path.replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = path.split('/').map((item) => decodeURIComponent(item));
  const [resource, second, third] = segments;

  await sleep(280);

  // 菜单树
  if (resource === 'menus' && method === 'GET') {
    return { code: 0, data: menuTree as unknown as T };
  }

  // 当前用户权限菜单
  if (resource === 'user' && second === 'menus' && method === 'GET') {
    return { code: 0, data: permissionTree as unknown as T };
  }

  // 通用页面列表：/views/{view}/rows[/{id}]
  if (resource === 'views') {
    const view = second ?? '';
    const rows = getViewRows(view);
    if (method === 'GET' && third === 'rows') {
      return paginate(filterEntities(rows, params), params) as ApiResponse<T>;
    }
    if (method === 'DELETE' && third === 'rows' && segments[3]) {
      const rowId = segments[3];
      const index = rows.findIndex((item) => item.id === rowId);
      if (index < 0) return notFound<T>('记录', rowId);
      rows.splice(index, 1);
      return { code: 0, data: null as unknown as T };
    }
  }

  // 筛选候选项：按当前数据集去重
  if (resource === 'preorders' && second === 'filters' && method === 'GET') {
    return { code: 0, data: buildFilterOptions(preorders) as unknown as T };
  }

  // 最近变更明细（list/change）
  if (resource === 'preorders' && second === 'changes' && method === 'GET') {
    return { code: 0, data: preorderChanges as unknown as T };
  }

  if (resource === 'preorders' && method === 'GET') {
    return paginate(filterPreorders(preorders, params), params) as ApiResponse<T>;
  }

  // 新增预订单
  if (resource === 'preorders' && method === 'POST') {
    const payload = (body ?? {}) as Partial<PreorderRecord>;
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const created = {
      ...payload,
      ID: createId(),
      YPDate: payload.YPDate ?? dayjs().format('YYYY-MM-DD'),
      Qty: Number(payload.Qty) || 0,
      UpdateUser: payload.UpdateUser ?? payload.CreateUser ?? '',
      CreateTime: now,
      UpdateTime: now,
      Status: payload.Status ?? 0,
    } as PreorderRecord;
    preorders.unshift(created);
    return { code: 0, data: created as unknown as T };
  }

  // 修改预订单
  if (resource === 'preorders' && method === 'PUT' && second) {
    const index = preorders.findIndex((item) => item.ID === second);
    if (index < 0) return notFound<T>('预订单', second);
    preorders[index] = {
      ...preorders[index],
      ...(body as Partial<PreorderRecord>),
      ID: second,
      UpdateTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    };
    return { code: 0, data: preorders[index] as unknown as T };
  }

  if (resource === 'orders') {
    if (method === 'GET' && !second) return paginate(filterEntities(orders, params), params) as ApiResponse<T>;
    if (method === 'GET' && second) {
      const found = orders.find((item) => item.id === second);
      return found ? ({ code: 0, data: found as unknown as T }) : notFound<T>('订单', second);
    }
    if (method === 'DELETE' && second) {
      const index = orders.findIndex((item) => item.id === second);
      if (index < 0) return notFound<T>('订单', second);
      orders.splice(index, 1);
      return { code: 0, data: null as unknown as T };
    }
    if (method === 'POST') {
      const payload = (body ?? {}) as Partial<MockEntity>;
      const created: MockEntity = {
        id: `ORD-${String(orders.length + 1).padStart(4, '0')}`,
        name: payload.name ?? '新订单',
        status: payload.status ?? 'pending',
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      };
      orders.unshift(created);
      return { code: 0, data: created as unknown as T };
    }
    if (method === 'PUT' && second) {
      const index = orders.findIndex((item) => item.id === second);
      if (index < 0) return notFound<T>('订单', second);
      orders[index] = { ...orders[index], ...(body as Partial<MockEntity>), id: second };
      return { code: 0, data: orders[index] as unknown as T };
    }
  }

  if (resource === 'users') {
    if (method === 'GET' && !second) return paginate(filterEntities(users, params), params) as ApiResponse<T>;
    if (method === 'GET' && second) {
      const found = users.find((item) => item.id === second);
      return found ? ({ code: 0, data: found as unknown as T }) : notFound<T>('用户', second);
    }
    if (method === 'DELETE' && second) {
      const index = users.findIndex((item) => item.id === second);
      if (index < 0) return notFound<T>('用户', second);
      users.splice(index, 1);
      return { code: 0, data: null as unknown as T };
    }
    if (method === 'PUT' && second) {
      const index = users.findIndex((item) => item.id === second);
      if (index < 0) return notFound<T>('用户', second);
      users[index] = { ...users[index], ...(body as Partial<MockEntity>), id: second };
      return { code: 0, data: users[index] as unknown as T };
    }
  }

  return undefined;
}
