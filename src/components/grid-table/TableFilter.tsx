import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, DatePicker, Divider, Input, InputNumber, Popover, Select, Space, Tag } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { FilterType } from './columnBuilder';

/** 可筛选的列：类型决定用哪种筛选控件。通常不用手写 —— FilterTable 从列定义的 `filterType` 自动收集 */
export interface FilterField {
  field: string;
  title: string;
  /** enum 多选（候选项按当前页数据去重）、date / number 区间、text 包含 */
  type: FilterType;
}

/** 单个字段的筛选条件 */
export interface FilterCondition {
  /** enum 选中值 */
  values?: string[];
  /** 区间下限（date 为 YYYY-MM-DD，number 为数值） */
  min?: string | number;
  /** 区间上限 */
  max?: string | number;
  /** text 包含 */
  text?: string;
}

/** 整体筛选条件：字段名 -> 条件 */
export type FilterModel = Record<string, FilterCondition>;

export interface TableFilterProps {
  fields: FilterField[];
  /** enum 候选项：字段名 -> 去重后的值 */
  options?: Record<string, Array<string | number>>;
  value: FilterModel;
  onChange: (value: FilterModel) => void;
}

const isEmpty = (condition?: FilterCondition): boolean => {
  if (!condition) return true;
  const noValues = !condition.values?.length;
  const noMin = condition.min === undefined || condition.min === '';
  const noMax = condition.max === undefined || condition.max === '';
  const noText = !condition.text;
  return noValues && noMin && noMax && noText;
};

/** 条件摘要，用于展示成标签 */
function describe(condition: FilterCondition, type: FilterField['type']): string {
  if (type === 'enum') return (condition.values ?? []).join('、');
  if (type === 'text') return `包含「${condition.text}」`;
  if (type === 'date') {
    if (condition.min && condition.max) return `${condition.min} ~ ${condition.max}`;
    return condition.min ? `≥ ${condition.min}` : `≤ ${condition.max}`;
  }
  if (condition.min !== undefined && condition.max !== undefined) return `${condition.min} ~ ${condition.max}`;
  return condition.min !== undefined ? `≥ ${condition.min}` : `≤ ${condition.max}`;
}

/**
 * 通用筛选条：按列的筛选类型自动生成对应控件。
 * - enum：多选，候选项从后端返回的去重值里取
 * - date / number：区间
 * - text：包含
 */
export const TableFilter: React.FC<TableFilterProps> = ({ fields, options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterModel>(value);

  // 每次打开时用外部条件初始化草稿，避免未点确定也生效
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const activeFields = useMemo(() => fields.filter((item) => !isEmpty(value[item.field])), [fields, value]);

  const patch = useCallback((field: string, condition: FilterCondition) => {
    setDraft((prev) => ({ ...prev, [field]: condition }));
  }, []);

  const renderControl = (item: FilterField) => {
    const condition = draft[item.field] ?? {};
    if (item.type === 'enum') {
      return (
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          style={{ width: '100%' }}
          placeholder="全部"
          value={condition.values}
          options={(options?.[item.field] ?? []).map((v) => ({ value: String(v), label: String(v) }))}
          onChange={(values: string[]) => patch(item.field, { values })}
        />
      );
    }
    if (item.type === 'date') {
      return (
        <DatePicker.RangePicker
          style={{ width: '100%' }}
          value={[
            condition.min ? dayjs(String(condition.min)) : null,
            condition.max ? dayjs(String(condition.max)) : null,
          ]}
          onChange={(range) =>
            patch(item.field, {
              min: range?.[0]?.format('YYYY-MM-DD'),
              max: range?.[1]?.format('YYYY-MM-DD'),
            })
          }
        />
      );
    }
    if (item.type === 'number') {
      return (
        <Space.Compact style={{ width: '100%' }}>
          <InputNumber
            style={{ width: '50%' }}
            placeholder="最小"
            value={condition.min as number}
            onChange={(v) => patch(item.field, { ...condition, min: v ?? undefined })}
          />
          <InputNumber
            style={{ width: '50%' }}
            placeholder="最大"
            value={condition.max as number}
            onChange={(v) => patch(item.field, { ...condition, max: v ?? undefined })}
          />
        </Space.Compact>
      );
    }
    return (
      <Input
        allowClear
        placeholder="包含关键字"
        value={condition.text}
        onChange={(event) => patch(item.field, { text: event.target.value })}
      />
    );
  };

  const panel = (
    <div className="table-filter-panel">
      <div className="table-filter-rows">
        {fields.map((item) => (
          <div key={item.field} className="table-filter-row">
            <span className="table-filter-label">{item.title}</span>
            <div className="table-filter-control">{renderControl(item)}</div>
          </div>
        ))}
      </div>
      <Divider style={{ margin: '4px 0 12px' }} />
      <div className="table-filter-actions">
        <Button
          size="small"
          onClick={() => {
            setDraft({});
            onChange({});
            setOpen(false);
          }}
        >
          清空
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={() => {
            const next: FilterModel = {};
            Object.entries(draft).forEach(([field, condition]) => {
              if (!isEmpty(condition)) next[field] = condition;
            });
            onChange(next);
            setOpen(false);
          }}
        >
          确定
        </Button>
      </div>
    </div>
  );

  return (
    <div className="table-filter">
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger="click"
        placement="bottomLeft"
        content={panel}
      >
        <Badge count={activeFields.length} size="small">
          <Button size="small" icon={<FilterOutlined />}>
            筛选
          </Button>
        </Badge>
      </Popover>

      {activeFields.map((item) => (
        <Tag
          key={item.field}
          closable
          onClose={() => {
            const next = { ...value };
            delete next[item.field];
            onChange(next);
          }}
        >
          {item.title}：{describe(value[item.field], item.type)}
        </Tag>
      ))}

      {activeFields.length > 0 && (
        <Button size="small" type="link" onClick={() => onChange({})}>
          清空筛选
        </Button>
      )}
    </div>
  );
};
