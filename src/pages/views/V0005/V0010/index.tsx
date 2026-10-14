import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Form, Input, Pagination, Space } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsDefine } from '@visactor/vtable';
import { ApiError, viewApi, type ViewRow, type ViewRowQuery, type ViewRowStatus } from '@/api';
import { usePermission } from '@/store/permission-context';
import { VTable } from '@/components/vtable';
import { AuthButton } from '@/components/Permission';
import type { ViewPageProps } from '@/pages/types';
import { PageBreadcrumb } from '@/components/PageBreadcrumb';

const statusMap: Record<ViewRowStatus, { color: string; label: string }> = {
  enabled: { color: '#52c41a', label: '启用' },
  disabled: { color: '#8c8c8c', label: '停用' },
};

const DEFAULT_PAGE_SIZE = 30;

/** V0005_V0010 基础资料 > 部门设定 */
const DepartmentPage: React.FC<ViewPageProps> = ({ view, trail }) => {
  const { message, modal } = App.useApp();
  const { actions, hasButton } = usePermission();
  const [form] = Form.useForm<{ keyword?: string }>();
  const [dataSource, setDataSource] = useState<ViewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState<ViewRowQuery>({ page: 1, pageSize: DEFAULT_PAGE_SIZE });

  const actionItems = actions.get(view) ?? [];
  const createAction = actionItems.find((item) => item.name === '新增');
  const canEdit = useMemo(() => {
    if (actionItems.length === 0) return true;
    const item = actionItems.find((entry) => ['编辑', '修改'].includes(entry.name));
    return item ? hasButton(item.menuCode) : false;
  }, [actionItems, hasButton]);
  const canDelete = useMemo(() => {
    if (actionItems.length === 0) return true;
    const item = actionItems.find((entry) => ['删除', '移除'].includes(entry.name));
    return item ? hasButton(item.menuCode) : false;
  }, [actionItems, hasButton]);

  const loadData = useCallback(
    async (params: ViewRowQuery) => {
      setLoading(true);
      try {
        const res = await viewApi.rows(view, params);
        setDataSource(res.data ?? []);
        setTotal(res.page?.total ?? res.data?.length ?? 0);
      } catch (error) {
        message.error(error instanceof ApiError ? error.message : '加载部门数据失败');
      } finally {
        setLoading(false);
      }
    },
    [message, view],
  );

  useEffect(() => {
    void loadData(query);
  }, [loadData, query]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await viewApi.removeRow(view, id);
        message.success(`已删除 ${id}`);
        await loadData(query);
      } catch (error) {
        message.error(error instanceof ApiError ? error.message : '删除失败');
      }
    },
    [loadData, message, query, view],
  );

  const columns = useMemo<ColumnsDefine>(() => {
    const base: ColumnsDefine = [
      { field: 'id', title: '部门编号', width: 220, sort: true },
      { field: 'name', title: '部门名称', width: 260 },
      {
        field: 'status',
        title: '状态',
        width: 100,
        fieldFormat: (record: ViewRow) => statusMap[record.status]?.label ?? '',
        style: (args: { dataValue?: unknown }) => ({
          color: statusMap[args.dataValue as ViewRowStatus]?.color ?? '#1f1f1f',
        }),
      },
      { field: 'createdAt', title: '创建时间', width: 180, sort: true },
    ];
    const operationColumns = [];
    if (canEdit) {
      operationColumns.push({
        field: '__edit',
        title: '编辑',
        width: 64,
        cellType: 'link' as const,
        fieldFormat: () => '编辑',
        style: { color: '#1677ff', textAlign: 'center' as const },
      });
    }
    if (canDelete) {
      operationColumns.push({
        field: '__delete',
        title: '删除',
        width: 64,
        cellType: 'link' as const,
        fieldFormat: () => '删除',
        style: { color: '#ff4d4f', textAlign: 'center' as const },
      });
    }
    if (operationColumns.length) {
      base.push({ title: '操作', columns: operationColumns });
    }
    return base;
  }, [canDelete, canEdit]);

  const onCellClick = useCallback(
    (info: { field?: string; record?: Record<string, unknown> }) => {
      const id = String(info.record?.id ?? '');
      if (!id) return;
      if (info.field === '__edit') {
        message.info(`编辑 ${id}`);
      } else if (info.field === '__delete') {
        modal.confirm({
          title: '确认删除该部门？',
          okText: '确认',
          cancelText: '取消',
          onOk: () => handleDelete(id),
        });
      }
    },
    [handleDelete, message, modal],
  );

  return (
    <div className="page-container page-fill">
      <PageBreadcrumb trail={trail} />
      <Form
        className="page-search"
        form={form}
        layout="inline"
        onFinish={(values: { keyword?: string }) =>
          setQuery((prev) => ({ ...prev, page: 1, keyword: values.keyword }))
        }
      >
        <Form.Item name="keyword">
          <Input placeholder="部门编号/名称" allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
              搜索
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                form.resetFields();
                setQuery({ page: 1, pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE });
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
        {createAction && (
          <Form.Item style={{ marginLeft: 'auto' }}>
            <AuthButton
              type="primary"
              icon={<PlusOutlined />}
              menuCode={createAction.menuCode}
              onClick={() => message.info('新增部门')}
            >
              新增部门
            </AuthButton>
          </Form.Item>
        )}
      </Form>

      <div className="vtable-host">
        <VTable
          columns={columns}
          records={dataSource as unknown as Array<Record<string, unknown>>}
          rowKey="id"
          emptyTip={loading ? '加载中…' : '暂无数据'}
          onCellClick={onCellClick}
        />
      </div>

      <div className="grid-footer">
        <span>计数 = {dataSource.length}</span>
        <Pagination
          size="small"
          current={query.page}
          pageSize={query.pageSize}
          total={total}
          showSizeChanger
          pageSizeOptions={[10, 30, 50, 100]}
          showTotal={(count) => `共 ${count} 条`}
          onChange={(page, pageSize) => setQuery((prev) => ({ ...prev, page, pageSize }))}
        />
      </div>
    </div>
  );
};

export default DepartmentPage;
