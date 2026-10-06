import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, DatePicker, Dropdown, Form, Input, InputNumber, Modal, Select } from 'antd';
import type { MenuProps } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { ApiError, preorderService, type PreorderRecord } from '@/services';
import { VTable } from '@/components/VTable';
import {
  buildPreorderDetailColumns,
  createDetailRow,
  DETAIL_EDITOR_FIELDS,
  SIZE_HEADERS,
  type PreorderDetailRow,
} from './detailColumns';

const DATE_FORMAT = 'YYYY-MM-DD';

/** 表单值：日期为 dayjs，提交前再转成后端字符串 */
interface PreorderFormValues {
  OrderCode?: string;
  YPDate?: Dayjs;
  Ywy?: string;
  WorkPlace?: string;
  JHDate?: Dayjs;
  QRDate?: Dayjs;
  WCDate?: Dayjs;
  ZHDate?: Dayjs;
  YLDate?: Dayjs;
  FLDate?: Dayjs;
  BZFLDate?: Dayjs;
  XDRate?: string;
  Qty?: number;
  Memo?: string;
  ZQCheckDate?: Dayjs;
  ZQCheckMemo?: string;
}

export interface PreorderFormModalProps {
  open: boolean;
  mode: 'add' | 'edit';
  /** 编辑时的原始记录，新增时为 undefined */
  record?: PreorderRecord | null;
  /** 业务员候选（来自筛选候选项） */
  salesmen: string[];
  /** 产地候选（来自筛选候选项） */
  workPlaces: string[];
  /** 是否整体禁用（详情分组连同下面的明细表格一起禁用） */
  disabled?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

/** 后端用 0001-01-01 表示空日期 */
const toDayjs = (value: unknown): Dayjs | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const text = String(value);
  if (text.startsWith('0001-01-01')) return undefined;
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed : undefined;
};

const toDateString = (value: Dayjs | undefined): string =>
  value && dayjs.isDayjs(value) ? value.format(DATE_FORMAT) : '';

/** 编辑时把原始记录铺进表单，新增时给一个空表单（预排日期、总数量给默认值） */
const buildValues = (record?: PreorderRecord | null): PreorderFormValues => {
  if (!record) {
    return { YPDate: dayjs(), Qty: 0 };
  }
  return {
    OrderCode: String(record.OrderCode ?? ''),
    YPDate: toDayjs(record.YPDate),
    Ywy: String(record.Ywy ?? ''),
    WorkPlace: String(record.WorkPlace ?? ''),
    JHDate: toDayjs(record.JHDate),
    QRDate: toDayjs(record.QRDate),
    WCDate: toDayjs(record.WCDate),
    ZHDate: toDayjs(record.ZHDate),
    YLDate: toDayjs(record.YLDate),
    FLDate: toDayjs(record.FLDate),
    BZFLDate: toDayjs(record.BZFLDate),
    XDRate: String(record.XDRate ?? ''),
    Qty: Number(record.Qty) || 0,
    Memo: String(record.Memo ?? ''),
    ZQCheckDate: toDayjs(record.ZQCheckDate),
    ZQCheckMemo: String(record.ZQCheckMemo ?? ''),
  };
};

/** 编辑时由原始记录生成一行款式明细；新增时给一行空白行供输入 */
const buildDetailRows = (record?: PreorderRecord | null): PreorderDetailRow[] => {
  if (!record) return [createDetailRow('__new__')];
  const row: PreorderDetailRow = {
    __id: String(record.ID ?? 'detail-1'),
    StyleCode: String(record.StyleCode ?? ''),
    Number: Number(record.Number) || '',
    ProduceName: String(record.ProduceName ?? ''),
    Color: String(record.Color ?? ''),
    TSWorkName: String(record.TSWorkName ?? ''),
    HDWorkName: String(record.HDWorkName ?? ''),
    ZZMWeight: Number(record.ZZMWeight) || '',
    ZZMTime: '',
    MSewWt: Number(record.MSewWt) || '',
  };
  SIZE_HEADERS.forEach((_, index) => {
    const field = `MCSize${index + 1}`;
    row[field] = Number(record[field]) || '';
  });
  return [row];
};

/** 表单里的一组「标签 + 控件」 */
const Field: React.FC<{
  label: string;
  required?: boolean;
  grow?: boolean;
  children: React.ReactNode;
}> = ({ label, required, grow, children }) => (
  <div className={grow ? 'pf-field pf-field-grow' : 'pf-field'}>
    <span className={required ? 'pf-label pf-label-required' : 'pf-label'}>{label}</span>
    <div className="pf-control">{children}</div>
  </div>
);

/** V0189_V0279_V0280 新增 / 编辑预订单弹窗 */
const PreorderFormModal: React.FC<PreorderFormModalProps> = ({
  open,
  mode,
  record,
  salesmen,
  workPlaces,
  disabled = false,
  onCancel,
  onSaved,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<PreorderFormValues>();
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [detailRows, setDetailRows] = useState<PreorderDetailRow[]>([]);

  // 打开时重置并按模式填充：新增给空表，编辑铺原始数据
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(buildValues(record));
    setDetailRows(buildDetailRows(record));
  }, [form, open, record]);

  const detailColumns = useMemo(() => buildPreorderDetailColumns(), []);

  /** 明细表格里编辑完一个单元格后同步回本地行数据，保存时一起提交 */
  const handleDetailChange = useCallback(
    ({ field, rowIndex, value }: { field: string; rowIndex: number; value: unknown }) => {
      setDetailRows((prev) =>
        prev.map((row, index) => (index === rowIndex ? { ...row, [field]: value } : row)),
      );
    },
    [],
  );

  const salesmanMenu = useMemo<MenuProps>(
    () => ({
      items: salesmen.map((name) => ({ key: name, label: name })),
      onClick: ({ key }) => form.setFieldValue('Ywy', key),
    }),
    [form, salesmen],
  );

  const handleCheck = useCallback(async () => {
    const code = String(form.getFieldValue('OrderCode') ?? '').trim();
    if (!code) {
      message.warning('请先输入订单号');
      return;
    }
    setChecking(true);
    try {
      const res = await preorderService.list({ page: 1, pageSize: 200, keyword: code });
      const duplicated = res.data.some(
        (item) => String(item.OrderCode) === code && item.ID !== record?.ID,
      );
      if (duplicated) message.warning(`订单号 ${code} 已存在`);
      else message.success(`订单号 ${code} 可以使用`);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : '检测订单号失败');
    } finally {
      setChecking(false);
    }
  }, [form, message, record]);

  const handleSave = useCallback(async () => {
    let values: PreorderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验未通过，antd 已在控件上提示
    }

    const payload: Partial<PreorderRecord> = {
      OrderCode: values.OrderCode ?? '',
      YPDate: toDateString(values.YPDate),
      Ywy: values.Ywy ?? '',
      WorkPlace: values.WorkPlace ?? '',
      JHDate: toDateString(values.JHDate),
      QRDate: toDateString(values.QRDate),
      WCDate: toDateString(values.WCDate),
      ZHDate: toDateString(values.ZHDate),
      YLDate: toDateString(values.YLDate),
      FLDate: toDateString(values.FLDate),
      BZFLDate: toDateString(values.BZFLDate),
      XDRate: values.XDRate ?? '',
      Qty: Number(values.Qty) || 0,
      Memo: values.Memo ?? '',
      ZQCheckDate: toDateString(values.ZQCheckDate),
      ZQCheckMemo: values.ZQCheckMemo ?? '',
    };
    // 明细行回填主表的款式字段（当前一单一款式）
    const firstRow = detailRows[0];
    if (firstRow) {
      payload.StyleCode = String(firstRow.StyleCode ?? '');
      payload.Number = Number(firstRow.Number) || 0;
      payload.ProduceName = firstRow.ProduceName;
      payload.Color = firstRow.Color;
      payload.TSWorkName = firstRow.TSWorkName;
      payload.HDWorkName = firstRow.HDWorkName;
      payload.ZZMWeight = Number(firstRow.ZZMWeight) || 0;
      payload.MSewWt = Number(firstRow.MSewWt) || 0;
    }

    setSaving(true);
    try {
      if (mode === 'edit' && record) await preorderService.update(record.ID, payload);
      else await preorderService.create(payload);
      message.success(mode === 'edit' ? '保存成功' : '新增成功');
      onSaved();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [detailRows, form, message, mode, onSaved, record]);

  return (
    <Modal
      open={open}
      title={mode === 'edit' ? '编辑预订单' : '新增预订单'}
      width="94vw"
      style={{ top: 24, maxWidth: 1600 }}
      styles={{
        body: {
          height: 'calc(100vh - 168px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
      footer={null}
      mask={{ closable: false }}
      onCancel={onCancel}
    >
      <Form form={form} component={false} className="preorder-form" disabled={disabled}>
        <div className="preorder-form-toolbar">
          <span className="pf-label">订单号</span>
          <Form.Item name="OrderCode" noStyle>
            <Input style={{ width: 150 }} allowClear placeholder="订单号" />
          </Form.Item>
          <Button loading={checking} disabled={disabled} onClick={handleCheck}>
            检测
          </Button>
          <span className="pf-label pf-toolbar-gap">预排日期</span>
          <Form.Item name="YPDate" noStyle>
            <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
          </Form.Item>
          <Button
            type="primary"
            style={{ marginLeft: 'auto' }}
            loading={saving}
            disabled={disabled}
            onClick={handleSave}
          >
            保存
          </Button>
        </div>

        <fieldset className="preorder-fieldset">
          <legend>详情</legend>

          <div className="pf-row">
            <Field label="业务员" required>
              <Form.Item name="Ywy" noStyle>
                <Input style={{ width: 120 }} readOnly />
              </Form.Item>
              <Dropdown
                menu={salesmanMenu}
                trigger={['click']}
                disabled={disabled || !salesmen.length}
              >
                <Button style={{ width: 30, padding: 0 }} className="pf-picker-btn">
                  ...
                </Button>
              </Dropdown>
            </Field>
            <Field label="产地">
              <Form.Item name="WorkPlace" noStyle>
                <Select
                  allowClear
                  style={{ width: 150 }}
                  placeholder="请选择"
                  options={workPlaces.map((value) => ({ value, label: value }))}
                />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="计划下单日期" required>
              <Form.Item
                name="JHDate"
                noStyle
                rules={[{ required: true, message: '请选择计划下单日期' }]}
              >
                <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
              </Form.Item>
            </Field>
            <Field label="确认可下单期">
              <Form.Item name="QRDate" noStyle>
                <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="尾货期" required>
              <Form.Item
                name="WCDate"
                noStyle
                rules={[{ required: true, message: '请选择尾货期' }]}
              >
                <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
              </Form.Item>
            </Field>
            <Field label="走货期" required>
              <Form.Item
                name="ZHDate"
                noStyle
                rules={[{ required: true, message: '请选择走货期' }]}
              >
                <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="原料可下单期">
              <Form.Item name="YLDate" noStyle>
                <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
              </Form.Item>
            </Field>
            <Field label="缝制辅料可下单期">
              <Form.Item name="FLDate" noStyle>
                <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
              </Form.Item>
            </Field>
            <Field label="包装辅料提供期">
              <Form.Item name="BZFLDate" noStyle>
                <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="下单把握率">
              <Form.Item name="XDRate" noStyle>
                <Input style={{ width: 150 }} placeholder="如 95%" />
              </Form.Item>
            </Field>
            <Field label="总数量:">
              <Form.Item name="Qty" noStyle>
                <InputNumber style={{ width: 130 }} min={0} />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="备注" grow>
              <Form.Item name="Memo" noStyle>
                <Input placeholder="备注" />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="中期检验日期">
              <Form.Item name="ZQCheckDate" noStyle>
                <DatePicker style={{ width: 150 }} format={DATE_FORMAT} />
              </Form.Item>
            </Field>
            <Field label="中期检验要求" grow>
              <Form.Item name="ZQCheckMemo" noStyle>
                <Input placeholder="中期检验要求" />
              </Form.Item>
            </Field>
          </div>

          {/* 明细表格属于「详情」分组，禁用分组时连同表格一起禁用 */}
          <div className="preorder-detail-grid">
            <VTable
              columns={detailColumns}
              records={detailRows as unknown as Array<Record<string, unknown>>}
              rowKey="__id"
              editableFields={disabled ? undefined : DETAIL_EDITOR_FIELDS}
              onCellValueChange={handleDetailChange}
            />
            {detailRows.length === 0 && <div className="preorder-detail-empty">没有任何记录</div>}
          </div>
        </fieldset>
      </Form>
    </Modal>
  );
};

export default PreorderFormModal;
