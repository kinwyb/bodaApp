import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { ApiError, employeeApi, yupaiOrderApi, type YupaiOrder } from '@/api';
import { VTable } from '@/components/VTable';
import { EmployeeQuickSelect } from '@/components/quick-select';
import {
  buildPreorderDetailColumns,
  createDetailRow,
  DETAIL_EDITOR_FIELDS,
  SIZE_HEADERS,
  type PreorderDetailRow,
} from './detailColumns';

const DATE_FORMAT = 'YYYY-MM-DD';

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
  mode: 'add' | 'edit' | 'view';
  record?: YupaiOrder | null;
  workPlaces: string[];
  disabled?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

const toDayjs = (value: unknown): Dayjs | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const text = String(value);
  if (text.startsWith('0001-01-01')) return undefined;
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed : undefined;
};

const toDateString = (value: Dayjs | undefined): string =>
  value && dayjs.isDayjs(value) ? value.format(DATE_FORMAT) : '';

const buildValues = (record?: YupaiOrder | null): PreorderFormValues => {
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

const buildDetailRows = (record?: YupaiOrder | null): PreorderDetailRow[] => {
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

const PreorderFormModal: React.FC<PreorderFormModalProps> = ({
  open,
  mode,
  record,
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
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [orderChecked, setOrderChecked] = useState(false);

  const isView = mode === 'view';
  const isEdit = mode === 'edit';
  const isAdd = mode === 'add';

  const toolbarLocked = isView || isEdit;
  const detailLocked = isView || (isAdd && !orderChecked);

  useEffect(() => {
    if (!open) {
      setEmployeeOpen(false);
      setOrderChecked(false);
      return;
    }
    form.resetFields();
    form.setFieldsValue(buildValues(record));
    setDetailRows(buildDetailRows(record));
    setOrderChecked(false);
  }, [form, open, record]);

  const detailColumns = useMemo(
    () => buildPreorderDetailColumns(detailLocked),
    [detailLocked],
  );

  const handleDetailChange = useCallback(
    ({ field, rowIndex, value }: { field: string; rowIndex: number; value: unknown }) => {
      setDetailRows((prev) =>
        prev.map((row, index) => (index === rowIndex ? { ...row, [field]: value } : row)),
      );
    },
    [],
  );

  const handleCheck = useCallback(async () => {
    const code = String(form.getFieldValue('OrderCode') ?? '').trim();
    if (!code) {
      message.warning('请先输入订单号');
      return;
    }
    setChecking(true);
    try {
      const res = await yupaiOrderApi.list({ keyword: code });
      const duplicated = res.data.some(
        (item) => String(item.OrderCode) === code && item.ID !== record?.ID,
      );
      if (duplicated) {
        message.warning(`订单号 ${code} 已存在`);
        setOrderChecked(false);
      } else {
        message.success(`订单号 ${code} 可以使用`);
        setOrderChecked(true);
      }
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : '检测订单号失败');
      setOrderChecked(false);
    } finally {
      setChecking(false);
    }
  }, [form, message, record]);

  const handleSave = useCallback(async () => {
    let values: PreorderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload: Partial<YupaiOrder> = {
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
      if (mode === 'edit' && record) await yupaiOrderApi.update(record.ID, payload);
      else await yupaiOrderApi.create(payload);
      message.success(mode === 'edit' ? '保存成功' : '新增成功');
      onSaved();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [detailRows, form, message, mode, onSaved, record]);

  const modalTitle = isView ? '查看预订单' : isEdit ? '编辑预订单' : '新增预订单';

  // DatePicker: open={false} 阻止打开, inputReadOnly 阻止输入
  // Select: open={false} 阻止下拉, allowClear=false 阻止清除
  const dpProps = (locked: boolean) =>
    locked ? { open: false, inputReadOnly: true, allowClear: false } : { allowClear: true };

  const selectProps = (locked: boolean) =>
    locked ? { open: false, allowClear: false } : { allowClear: true };

  return (
    <Modal
      open={open}
      title={modalTitle}
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
      <Form form={form} component={false} className="preorder-form">
        <div className="preorder-form-toolbar">
          <span className="pf-label">订单号</span>
          <Form.Item name="OrderCode" noStyle>
            <Input
              style={{ width: 150 }}
              allowClear={!toolbarLocked}
              placeholder="订单号"
              readOnly={toolbarLocked}
            />
          </Form.Item>
          {isAdd && (
            <Button loading={checking} disabled={disabled} onClick={handleCheck}>
              检测
            </Button>
          )}
          <span className="pf-label pf-toolbar-gap">预排日期</span>
          <Form.Item name="YPDate" noStyle>
            <DatePicker
              style={{ width: 150 }}
              format={DATE_FORMAT}
              {...dpProps(toolbarLocked)}
            />
          </Form.Item>
          {!isView && (
            <Button
              type="primary"
              style={{ marginLeft: 'auto' }}
              loading={saving}
              disabled={detailLocked}
              onClick={handleSave}
            >
              保存
            </Button>
          )}
        </div>

        <fieldset className={`preorder-fieldset${detailLocked && !isView ? ' preorder-fieldset-disabled' : ''}`}>
          <legend>详情</legend>

          <div className="pf-row">
            <Field label="业务员" required>
              <Form.Item name="Ywy" noStyle>
                <Input style={{ width: 120 }} readOnly allowClear={false} />
              </Form.Item>
              <Button
                style={{ width: 30, padding: 0 }}
                className="pf-picker-btn"
                disabled={detailLocked}
                onClick={() => setEmployeeOpen(true)}
              >
                ...
              </Button>
            </Field>
            <Field label="产地">
              <Form.Item name="WorkPlace" noStyle>
                <Select
                  style={{ width: 150 }}
                  placeholder="请选择"
                  options={workPlaces.map((value) => ({ value, label: value }))}
                  {...selectProps(detailLocked)}
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
                <DatePicker
                  style={{ width: 150 }}
                  format={DATE_FORMAT}
                  {...dpProps(detailLocked)}
                />
              </Form.Item>
            </Field>
            <Field label="确认可下单期">
              <Form.Item name="QRDate" noStyle>
                <DatePicker
                  style={{ width: 150 }}
                  format={DATE_FORMAT}
                  {...dpProps(detailLocked)}
                />
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
                <DatePicker
                  style={{ width: 150 }}
                  format={DATE_FORMAT}
                  {...dpProps(detailLocked)}
                />
              </Form.Item>
            </Field>
            <Field label="走货期" required>
              <Form.Item
                name="ZHDate"
                noStyle
                rules={[{ required: true, message: '请选择走货期' }]}
              >
                <DatePicker
                  style={{ width: 150 }}
                  format={DATE_FORMAT}
                  {...dpProps(detailLocked)}
                />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="原料可下单期">
              <Form.Item name="YLDate" noStyle>
                <DatePicker
                  style={{ width: 150 }}
                  format={DATE_FORMAT}
                  {...dpProps(detailLocked)}
                />
              </Form.Item>
            </Field>
            <Field label="缝制辅料可下单期">
              <Form.Item name="FLDate" noStyle>
                <DatePicker
                  style={{ width: 150 }}
                  format={DATE_FORMAT}
                  {...dpProps(detailLocked)}
                />
              </Form.Item>
            </Field>
            <Field label="包装辅料提供期">
              <Form.Item name="BZFLDate" noStyle>
                <DatePicker
                  style={{ width: 150 }}
                  format={DATE_FORMAT}
                  {...dpProps(detailLocked)}
                />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="下单把握率">
              <Form.Item name="XDRate" noStyle>
                <Input
                  style={{ width: 150 }}
                  placeholder="如 95%"
                  readOnly={detailLocked}
                  allowClear={!detailLocked}
                />
              </Form.Item>
            </Field>
            <Field label="总数量:">
              <Form.Item name="Qty" noStyle>
                <InputNumber
                  style={{ width: 130 }}
                  min={0}
                  readOnly={detailLocked}
                />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="备注" grow>
              <Form.Item name="Memo" noStyle>
                <Input placeholder="备注" readOnly={detailLocked} allowClear={!detailLocked} />
              </Form.Item>
            </Field>
          </div>

          <div className="pf-row">
            <Field label="中期检验日期">
              <Form.Item name="ZQCheckDate" noStyle>
                <DatePicker
                  style={{ width: 150 }}
                  format={DATE_FORMAT}
                  {...dpProps(detailLocked)}
                />
              </Form.Item>
            </Field>
            <Field label="中期检验要求" grow>
              <Form.Item name="ZQCheckMemo" noStyle>
                <Input
                  placeholder="中期检验要求"
                  readOnly={detailLocked}
                  allowClear={!detailLocked}
                />
              </Form.Item>
            </Field>
          </div>

          <div className="preorder-detail-grid">
            <VTable
              columns={detailColumns}
              records={detailRows as unknown as Array<Record<string, unknown>>}
              rowKey="__id"
              editableFields={detailLocked ? undefined : DETAIL_EDITOR_FIELDS}
              onCellValueChange={handleDetailChange}
            />
            {detailRows.length === 0 && <div className="preorder-detail-empty">没有任何记录</div>}
          </div>
        </fieldset>
      </Form>

      <EmployeeQuickSelect
        open={employeeOpen}
        title="快速选择-业务员"
        loadData={async () => (await employeeApi.list()).data}
        onSelect={(employee) => {
          form.setFieldValue('Ywy', employee.EmployeeName);
          setEmployeeOpen(false);
        }}
        onCancel={() => setEmployeeOpen(false)}
      />
    </Modal>
  );
};

export default PreorderFormModal;
