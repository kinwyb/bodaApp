/**
 * 订单号组合输入控件 = `Space.Compact + Input + Button` + `OrderCodeQuickSelect`。
 *
 * 与 `MaterialSelect` 一样直接放进 `Form.Item`：
 *
 * ```tsx
 * <Form.Item name="OrderCode" label="订单号">
 *     <OrderCodeSelect style={{width: 160}}/>
 * </Form.Item>
 * ```
 *
 * `OrderCodeQuickSelect` 仍保留为独立弹窗，需要单独控制弹窗的场景可以直接使用它。
 */

import React, {useState} from 'react';
import {SearchOutlined} from '@ant-design/icons';
import {Button, Input, Space} from 'antd';
import {toStringOrEmpty} from '@/utils';
import {OrderCodeQuickSelect} from './OrderCodeQuickSelect';

export type OrderCodeSelectProps = {
    /** 当前订单号（受控：直接放进 Form.Item 即可） */
    value?: string;
    /** 手输、清空或选择订单号时回调 */
    onChange?: (orderCode: string) => void;
    /** 从弹窗选中订单号时额外回调，可用于选择后自动查询 */
    onSelect?: (orderCode: string) => void;
    /** 输入框被清空时回调 */
    onClear?: () => void;
    disabled?: boolean;
    placeholder?: string;
    style?: React.CSSProperties;
    className?: string;
    allowClear?: boolean;
    /** 选择按钮图标，默认省略号 */
    icon?: React.ReactNode;
};

export const OrderCodeSelect: React.FC<OrderCodeSelectProps> = ({
                                                                    value,
                                                                    onChange,
                                                                    onSelect,
                                                                    onClear,
                                                                    disabled,
                                                                    placeholder = '订单号',
                                                                    style,
                                                                    className,
                                                                    allowClear = true,
                                                                    icon = <SearchOutlined/>,
                                                                }) => {
    const [open, setOpen] = useState(false);
    const orderCode = toStringOrEmpty(value);

    return (
        <>
            <Space.Compact className={className}>
                <Input
                    value={orderCode}
                    disabled={disabled}
                    allowClear={allowClear}
                    placeholder={placeholder}
                    style={style}
                    onChange={(event) => {
                        const next = event.target.value;
                        onChange?.(next);
                        if (!next.trim()) onClear?.();
                    }}
                    onPressEnter={() => setOpen(true)}
                />
                <Button
                    aria-label="选择订单号"
                    icon={icon}
                    disabled={disabled}
                    onClick={() => setOpen(true)}
                />
            </Space.Compact>
            <OrderCodeQuickSelect
                open={open}
                defaultKeyword={orderCode.trim()}
                onSelect={(next) => {
                    onChange?.(next);
                    onSelect?.(next);
                    setOpen(false);
                }}
                onCancel={() => setOpen(false)}
            />
        </>
    );
};

export default OrderCodeSelect;
