import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Breadcrumb, Input, Pagination } from 'antd';
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
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  ShopOutlined,
  StopOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { ApiError, preorderService, type PreorderQuery, type PreorderRecord } from '@/services';
import { CommandBar, type CommandItem } from '@/components/CommandBar';
import { VTable, type VTableApi, type VTableCellStyleHook } from '@/components/VTable';
import { TableFilter, type FilterModel } from '@/components/TableFilter';
import type { ViewPageProps } from '@/pages/types';
import { buildPreorderColumns, preorderFilterFields } from './columns';
import PreorderFormModal from './PreorderFormModal';

const DEFAULT_PAGE_SIZE = 20;
/** 勾选列字段名，由 VTable 自己维护状态 */
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
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState<PreorderQuery>({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  const [filters, setFilters] = useState<FilterModel>({});
  const [filterOptions, setFilterOptions] = useState<Record<string, Array<string | number>>>({});
  /** 最近变更的单元格：订单 ID -> 变更字段（空数组 = 整行变化） */
  const [changedCells, setChangedCells] = useState<Record<string, string[]>>({});
  /** 新增 / 编辑弹窗 */
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingRecord, setEditingRecord] = useState<PreorderRecord | null>(null);
  /** 表格实例引用：需要调用 autoFitColumns 等命令式方法时用 */
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

  // 筛选候选项：由后端按当前数据集去重返回
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

  // 最近变更明细：标出发生变化的单元格
  useEffect(() => {
    (async () => {
      try {
        const res = await preorderService.changes();
        const map: Record<string, string[]> = {};
        res.data.forEach((item) => {
          const key = item.YupaiOrderID;
          if (!key) return;
          const existing = map[key];
          if (existing && existing.length === 0) return; // 已是整行变更
          if (!item.FieldName) {
            map[key] = [];
            return;
          }
          if (existing) {
            if (!existing.includes(item.FieldName)) existing.push(item.FieldName);
          } else {
            map[key] = [item.FieldName];
          }
        });
        setChangedCells(map);
      } catch {
        // 变更信息拿不到不影响列表使用
      }
    })();
  }, []);

  const handleFilterChange = useCallback((model: FilterModel) => {
    setFilters(model);
    setQuery((prev) => ({
      ...prev,
      page: 1,
      filters: Object.keys(model).length ? JSON.stringify(model) : undefined,
    }));
  }, []);

  /**
   * 最近变更提醒：命中变更明细的行标绿底。
   * 这是本页的业务规则，所以放在页面里通过 cellStyle 回调实现。
   */
  const cellStyle = useCallback<VTableCellStyleHook>(
    ({ rowKey, field }) => {
      if (!rowKey) return undefined;
      const fields = changedCells[rowKey];
      if (!fields) return undefined;
      // 空数组代表整行变化
      if (fields.length === 0 || fields.includes(field)) {
        return { bgColor: '#d9f7be' };
      }
      return undefined;
    },
    [changedCells],
  );

  // 变更明细是异步到达的，拿到后主动重绘一次
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
        // 勾选了就用勾选的那一行；没勾选就用表格里当前选中的行（点一下即选中）
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

  /** 弹窗里的业务员 / 产地候选项 */
  const salesmen = useMemo(() => (filterOptions.Ywy ?? []).map(String), [filterOptions]);
  const workPlaces = useMemo(() => (filterOptions.WorkPlace ?? []).map(String), [filterOptions]);

  /** 统计行：汇总当前页的数量列 */
  const summary = useMemo(() => {
    const totals = dataSource.reduce(
      (acc, row) => {
        acc.qty += Number(row.Qty) || 0;
        acc.number += Number(row.Number) || 0;
        return acc;
      },
      { qty: 0, number: 0 },
    );
    return {
      ID: '__summary__',
      WorkPlace: `合计（${dataSource.length} 行）`,
      Qty: totals.qty,
      Number: totals.number,
    };
  }, [dataSource]);

  return (
    <div className="page-container page-fill">
      <Breadcrumb style={{ marginBottom: 12 }} items={trail.map((item) => ({ title: item.name }))} />

      <CommandBar view={view} items={commands} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <TableFilter
          fields={preorderFilterFields}
          options={filterOptions}
          value={filters}
          onChange={handleFilterChange}
        />
        <Input
          allowClear
          size="small"
          style={{ width: 220, marginLeft: 'auto' }}
          placeholder="订单号/款号/款式/业务员"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(event) => {
            const value = event.target.value;
            setKeyword(value);
            if (!value) setQuery((prev) => ({ ...prev, page: 1, keyword: undefined }));
          }}
          onPressEnter={() => setQuery((prev) => ({ ...prev, page: 1, keyword: keyword || undefined }))}
        />
      </div>

      <div className="vtable-host">
        <VTable
          ref={tableRef}
          columns={columns}
          records={dataSource}
          rowKey="ID"
          selectField={SELECT_FIELD}
          frozenColCount={2}
          summary={summary}
          cellStyle={cellStyle}
          emptyTip={loading ? '加载中…' : '暂无数据'}
          onSelectionChange={setSelectedKeys}
          onCellDblClick={(info) => {
            const target = info.record as PreorderRecord | undefined;
            if (!target?.ID) return;
            setFormMode('edit');
            setEditingRecord(target);
            setFormOpen(true);
          }}
        />
      </div>

      <div className="grid-footer">
        <span>计数 = {selectedKeys.length}</span>
        <Pagination
          size="small"
          current={query.page}
          pageSize={query.pageSize}
          total={total}
          showSizeChanger
          pageSizeOptions={[10, 20, 50, 100]}
          showTotal={(count) => `共 ${count} 条`}
          onChange={(page, pageSize) => {
            setSelectedKeys([]);
            setQuery((prev) => ({ ...prev, page, pageSize }));
          }}
        />
      </div>

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
          // 新增的记录插到最前，回到第一页；编辑保持当前页刷新
          if (formMode === 'add') setQuery((prev) => ({ ...prev, page: 1 }));
          else void loadData(query);
        }}
      />
    </div>
  );
};

export default PreorderPage;
