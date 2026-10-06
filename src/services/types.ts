/** 分页信息，仅分页接口返回 */
export interface PageInfo {
  /** 当前页 */
  page: number;
  /** 每页行数 */
  rows: number;
  /** 总行数 */
  total: number;
  /** 总页数 */
  allpage: number;
}

/** 后端统一响应结构 */
export interface ApiResponse<T = unknown> {
  /** 0 表示请求成功，非 0 表示出错 */
  code: number;
  data: T;
  /** 错误消息，出错时存在 */
  errmsg?: string;
  /** 分页信息，仅分页时存在 */
  page?: PageInfo;
}

/** 分页请求标准参数 */
export interface PageQuery {
  /** 当前页 */
  page?: number;
  /** 每页行数 */
  pageSize?: number;
  /** 允许承载各业务自定义查询字段 */
  [key: string]: unknown;
}

/** query 参数集合 */
export type QueryParams = Record<string, unknown> | object;

/** 单次请求配置 */
export interface RequestOptions {
  /** URL query 参数 */
  params?: QueryParams;
  /** 请求体，自动 JSON 序列化 */
  body?: unknown;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 用于取消请求 */
  signal?: AbortSignal;
}
