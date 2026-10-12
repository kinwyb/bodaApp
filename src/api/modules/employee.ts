import { http } from '../request';
import type { PageQuery } from '../types';

export interface EmployeeQuery extends PageQuery {
  /** 工号 / 姓名 / 部门关键字 */
  keyword?: string;
  /** 部门 id */
  departmentId?: string;
}

/** 员工记录，字段与后端 `/employee` 返回一致（2026-10-12 实测） */
export interface EmployeeRecord {
  /** 工号 */
  EmployeeNo: string;
  /** 姓名。⚠️ 是 `Employee` 不是 `EmployeeName` */
  Employee: string;
  /** 部门名称。⚠️ 是 `Department` 不是 `DepartmentName` */
  Department: string;
  /** 部门 id */
  DepartmentID?: string;
  /** 其余字段按原样保留（PrDepartment / DepartmentNo / WorkNo / Sex / Born / EmployeeStatus …） */
  [key: string]: unknown;
}

export const employeeApi = {
  /**
   * 员工列表。
   * ⚠️ 实测后端忽略 page / pageSize，一次返回全量（2 万条量级），别在高频路径上直接调。
   */
  list: (query: EmployeeQuery = {}) => http.get<EmployeeRecord[]>('/employee', query),
};
