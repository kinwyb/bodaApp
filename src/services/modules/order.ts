import { http } from '../request';
import type { PageQuery } from '../types';

export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';

export interface OrderRecord {
  id: string;
  name: string;
  status: OrderStatus;
  createdAt: string;
}

export interface OrderQuery extends PageQuery {
  keyword?: string;
  status?: OrderStatus;
  startDate?: string;
  endDate?: string;
}

export interface OrderPayload {
  name: string;
  status?: OrderStatus;
}

export const orderService = {
  list: (query: OrderQuery = {}) => http.get<OrderRecord[]>('/orders', query),
  detail: (id: string) => http.get<OrderRecord>(`/orders/${id}`),
  create: (payload: OrderPayload) => http.post<OrderRecord>('/orders', payload),
  update: (id: string, payload: Partial<OrderPayload>) => http.put<OrderRecord>(`/orders/${id}`, payload),
  remove: (id: string) => http.delete<null>(`/orders/${id}`),
};
