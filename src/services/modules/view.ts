import { http } from '../request';
import type { PageQuery } from '../types';

export type ViewRowStatus = 'enabled' | 'disabled';

export interface ViewRow {
  id: string;
  name: string;
  status: ViewRowStatus;
  createdAt: string;
}

export interface ViewRowQuery extends PageQuery {
  keyword?: string;
  status?: ViewRowStatus;
  startDate?: string;
  endDate?: string;
}

/** 通用页面数据服务，按 View 路径取列表 */
export const viewService = {
  rows: (view: string, query: ViewRowQuery = {}) =>
    http.get<ViewRow[]>(`/views/${encodeURIComponent(view)}/rows`, query),
  removeRow: (view: string, id: string) =>
    http.delete<null>(`/views/${encodeURIComponent(view)}/rows/${encodeURIComponent(id)}`),
};
