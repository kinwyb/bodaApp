import React, { useMemo } from 'react';
import type { ColumnsDefine } from '@visactor/vtable';
import type { EmployeeRecord } from '@/api';
import { QuickSelectModal } from '../QuickSelectModal';
import { buildColumns, type AppColumnDef } from '../grid-table/columnBuilder';

export type { EmployeeRecord } from '@/api';

/** 弹窗展示的三列：工号、姓名、部门（字段名照后端 /employee 的返回，姓名为 Employee、部门为 Department） */
const EMPLOYEE_COLUMNS: AppColumnDef[] = [
  { field: 'EmployeeNo', title: '工号', width: 110 },
  { field: 'Employee', title: '姓名', width: 140 },
  { field: 'Department', title: '部门', width: 240 },
];

export interface EmployeeQuickSelectProps {
  /** 是否显示弹窗，由调用方控制 */
  open: boolean;
  /**
   * 数据加载：完全自定义。
   * 默认本地过滤（localFilter = true）时只在打开时调用一次，关键字由组件在本地过滤；
   * 传 localFilter={false} 时会把关键字透传给 loadData，由调用方做服务端过滤。
   */
  loadData: (keyword: string) => Promise<EmployeeRecord[]> | EmployeeRecord[];
  /** 选择回调：点「选择」或双击行时回传选中的员工记录 */
  onSelect: (employee: EmployeeRecord) => void;
  /** 关闭回调 */
  onCancel: () => void;
  /** 弹窗标题，默认「快速选择-员工」 */
  title?: string;
  /** 弹窗宽度，默认 720 */
  width?: number;
  /** 内容区高度（含工具条），默认 460 */
  height?: number;
  /** 输入框占位符，默认「工号/姓名/部门」 */
  searchPlaceholder?: string;
  /** 空数据提示 */
  emptyTip?: string;
  /** 是否本地过滤，默认 true（按工号、姓名、部门匹配） */
  localFilter?: boolean;
  /** 列宽总和不足弹窗宽度时是否拉宽填满，默认 true（三列时不留白） */
  autoFillWidth?: boolean;
}

/**
 * 员工快速选择弹窗：基于通用控件 QuickSelectModal。
 * 表格固定展示工号、姓名、部门三列，数据来源由调用方通过 loadData 提供。
 *
 * <EmployeeQuickSelect
 *   open={open}
 *   loadData={async () => (await employeeApi.list()).data}
 *   onSelect={(employee) => { setYwy(employee.Employee); setOpen(false); }}
 *   onCancel={() => setOpen(false)}
 * />
 */
export const EmployeeQuickSelect: React.FC<EmployeeQuickSelectProps> = ({
  open,
  loadData,
  onSelect,
  onCancel,
  title = '快速选择-员工',
  width = 720,
  height = 460,
  searchPlaceholder = '工号/姓名/部门',
  emptyTip,
  localFilter = true,
  autoFillWidth = true,
}) => {
  const columns = useMemo<ColumnsDefine>(() => buildColumns(EMPLOYEE_COLUMNS), []);

  return (
    <QuickSelectModal<EmployeeRecord>
      open={open}
      title={title}
      columns={columns}
      rowKey="EmployeeNo"
      loadData={loadData}
      searchFields={localFilter ? ['EmployeeNo', 'Employee', 'Department'] : undefined}
      searchLabel="快速选择:"
      searchPlaceholder={searchPlaceholder}
      width={width}
      height={height}
      emptyTip={emptyTip}
      autoFillWidth={autoFillWidth}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
};

export default EmployeeQuickSelect;
