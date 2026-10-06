import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App } from 'antd';
import {
  ApartmentOutlined,
  CalendarOutlined,
  CheckOutlined,
  CloseOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FieldTimeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SettingOutlined,
  ShopOutlined,
  StopOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { ApiError, preorderService, type PreorderQuery, type PreorderRecord } from '@/services';
import type { CommandItem } from '@/components/CommandBar';
import { FilterTable } from '@/components/FilterTable';
import type { VTableApi, VTableCellStyleHook } from '@/components/VTable';
import type { ViewPageProps } from '@/pages/types';
import { buildPreorderColumns, preorderFilterFields } from './columns';
import PreorderFormModal from './PreorderFormModal';

const DEFAULT_PAGE_SIZE = 20;
const SELECT_FIELD = '__checked';

const COMMANDS: CommandItem[] = [
  { key: 'add', label: '新增', icon: <PlusOutlined />, permission: '新增' },
  { key: 'edit', label: '修改', icon: <EditOutlined />, permission: '编辑' },
  { key: 'delete', label: '删除', icon: <DeleteOutlined />, permission: '删除', danger: true },
  { key: 'cancel', label: '取消', icon: <CloseOutlined />, dividerBefore: true },
  { key: 'copy', label: '复制', icon: <CopyOutlined /> },
  { key: 'copyOrdered', label: '已下订单复制', icon: <CopyOutlined /> },
  { key: 'changeDate', label: '变更日期', icon: <CalendarOutlined />, dividerBefore: true },
  { key: 'publish', label: '发布', icon: <SendOutlined />, permission: '发布' },
  { key: 'ordered', label: '已下单单', icon: <TagOutlined /> },
  { key: 'assign', label: '分配', icon: <ApartmentOutlined />, dividerBefore: true },
  { key: 'stage', label: '预订的阶段', icon: <FieldTimeOutlined /> },
  { key: 'origin', label: '工厂产地', icon: <ShopOutlined />, permission: '产地设置' },
  { key: 'plan', label: '计划设立', icon: <SettingOutlined />, permission: 'PMC设置' },
  { key: 'refresh', label: '刷新', icon: <ReloadOutlined />, dividerBefore: true },
  { key: 'autoWidth', label: '列宽自适应', icon: <ColumnWidthOutlined /> },
  { key: 'stop', label: '中止', icon: <StopOutlined />, danger: true },
  { key: 'finish', label: '完成', icon: <CheckOutlined />, permission: '完成' },
  { key: 'export', label: '导出', icon: <ExportOutlined />, dividerBefore: true },
  { key: 'auth', label: '权限', icon: <SafetyCertificateOutlined />, permission: '权限管理' },
];

/** V0189_V0279_V0280 计划管理 > 预订单 > 预订单管理 */
const PreorderPage: React.FC<ViewPageProps> = ({ view, trail }) => {
  const { message } = App.useApp();
  const [dataSource, setDataSource] = useState<PreorderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [query, setQuery] = useState<PreorderQuery>({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  const [filterOptions, setFilterOptions] = useState<Record<string, Array<string | number>>>({});
  const [changedCells, setChangedCells] = useState<Record<string, string[]>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingRecord, setEditingRecord] = useState<PreorderRecord | null>(null);
  const tableRef = useRef<VTableApi | null>(null);

  const loadData = useCallback(
    async (params: PreorderQuery) => {
      setLoading(true);
      try {
        const res = await preorderService.list(params);
        setDataSource(res.data);
        setTotal(res.page?.total ?? res.data.length);
      } catch (error) {
        message.error(error instanceof ApiError ? error.message : '加载预订单失败');
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    void loadData(query);
  }, [loadData, query]);

  useEffect(() => {
    (async () => {
      try {
        const res = await preorderService.filterOptions();
        setFilterOptions(res.data);
      } catch {
        // 候选项拿不到不影响列表使用
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await preorderService.changes();
        const map: Record<string, string[]> = {};
        res.data.forEach((item) => {
          if (!map[item.YupaiOrderID]) map[item.YupaiOrderID] = [];
          if (item.FieldName) map[item.YupaiOrderID].push(item.FieldName);
        });
        setChangedCells(map);
      } catch {
        // 变更明细拿不到不影响列表使用
      }
    })();
  }, []);

  const cellStyle: VTableCellStyleHook = useCallback(
    ({ rowKey, field }) => {
      if (!rowKey || rowKey === '__summary__') return undefined;
      const fields = changedCells[rowKey];
      if (!fields) return undefined;
      if (fields.length === 0 || fields.includes(field)) {
        return { bgColor: '#d9f7be' };
      }
      return undefined;
    },
    [changedCells],
  );

  useEffect(() => {
    tableRef.current?.repaint();
  }, [changedCells]);

  const commands = COMMANDS.map((item) => ({
    ...item,
    onClick: () => {
      if (item.key === 'autoWidth') {
        tableRef.current?.autoFitColumns();
        return;
      }
      if (item.key === 'add') {
        setFormMode('add');
        setEditingRecord(null);
        setFormOpen(true);
        return;
      }
      if (item.key === 'edit') {
        const checked =
          selectedKeys.length === 1 ? dataSource.find((row) => row.ID === selectedKeys[0]) : undefined;
        const current = (tableRef.current?.getSelection().rows ?? []).find((row) =>
          dataSource.some((item) => item.ID === (row as PreorderRecord).ID),
        ) as PreorderRecord | undefined;
        const target = checked ?? current;
        if (!target) {
          message.warning('请选择一条预订单再修改');
          return;
        }
        setFormMode('edit');
        setEditingRecord(target);
        setFormOpen(true);
        return;
      }
      message.info(`${item.label}（演示）`);
    },
  }));

  const columns = useMemo(() => buildPreorderColumns(), []);

  const salesmen = useMemo(() => (filterOptions.Ywy ?? []).map(String), [filterOptions]);
  const workPlaces = useMemo(() => (filterOptions.WorkPlace ?? []).map(String), [filterOptions]);

  const summary = useCallback((records: Array<Record<string, unknown>>): Record<string, unknown> => {
    const totals = records.reduce(
      (acc, row) => {
        acc.qty += Number(row.Qty) || 0;
        acc.number += Number(row.Number) || 0;
        return acc;
      },
      { qty: 0, number: 0 },
    );
    return {
      ID: '__summary__',
      WorkPlace: `合计（${records.length} 行）`,
      Qty: totals.qty,
      Number: totals.number,
    };
  }, []);

  return (
    <>
      <FilterTable
        ref={tableRef}
        trail={trail}
        commands={commands}
        view={view}
        filterFields={preorderFilterFields}
        filterOptions={filterOptions}
        columns={columns}
        records={dataSource}
        rowKey="ID"
        selectField={SELECT_FIELD}
        frozenColCount={2}
        summary={summary}
        cellStyle={cellStyle}
        loading={loading}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        searchPlaceholder="订单号/款号/款式/业务员"
        onPageChange={(page, pageSize) => setQuery((prev) => ({ ...prev, page, pageSize }))}
        onSelectionChange={setSelectedKeys}
        onCellDblClick={(info) => {
          const target = info.record as PreorderRecord | undefined;
          if (!target?.ID) return;
          setFormMode('edit');
          setEditingRecord(target);
          setFormOpen(true);
        }}
      />

      <PreorderFormModal
        open={formOpen}
        mode={formMode}
        record={formMode === 'edit' ? editingRecord : null}
        salesmen={salesmen}
        workPlaces={workPlaces}
        onCancel={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          setSelectedKeys([]);
          if (formMode === 'add') setQuery((prev) => ({ ...prev, page: 1 }));
          else void loadData(query);
        }}
      />
    </>
  );
};

export default PreorderPage;
