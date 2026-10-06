import { http } from '../request';
import type { PageQuery } from '../types';

export type UserStatus = 'active' | 'inactive';

export interface UserRecord {
  id: string;
  name: string;
  status: UserStatus;
  createdAt: string;
}

export interface UserQuery extends PageQuery {
  keyword?: string;
  status?: UserStatus;
}

export const userService = {
  list: (query: UserQuery = {}) => http.get<UserRecord[]>('/users', query),
  detail: (id: string) => http.get<UserRecord>(`/users/${id}`),
  update: (id: string, payload: Partial<Pick<UserRecord, 'name' | 'status'>>) =>
    http.put<UserRecord>(`/users/${id}`, payload),
  remove: (id: string) => http.delete<null>(`/users/${id}`),
};
