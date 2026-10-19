import React, {useCallback, useEffect, useState} from 'react';
import {App, Button, DatePicker, Input, Modal} from 'antd';
import type {Dayjs} from 'dayjs';
import {yupaiApi, type YupaiOrder} from '@/api';
import {DATE_FORMAT, isDebugEnv, toDateString, toDayjs, toStringOrEmpty} from '@/utils';
import {ErrorMessage} from "@/api/request.ts";

export interface YupaiOrderPlanModalProps {
    open: boolean;
    order: YupaiOrder | null;
    onCancel: () => void;
    onSaved: () => void;
}

/**
 * 计划部设置：原料资料提供期（`YLZLDate`）+ 原料计划到货期（`YLDHDate`）。
 *
 * 截图里两个控件是下拉样式，实际是日期选择器（WinForm 的日期控件就长这样）；
 * 这里用 DatePicker，点开是日历面板。
 *
 * 保存接口由业务方接入（见 handleSave 末尾的接入点）。
 */
const YupaiOrderPlanModal: React.FC<YupaiOrderPlanModalProps> = ({open, order, onCancel, onSaved}) => {
    const {message} = App.useApp();
    const [ylzlDate, setYlzlDate] = useState<Dayjs | null>(null);
    const [yldhDate, setYldhDate] = useState<Dayjs | null>(null);

    useEffect(() => {
        if (!open) return;
        // 业务模型上的日期已经是 Dayjs | null，取不到有效日期就是 null（不是占位值）
        setYlzlDate(order?.YLZLDate ?? null);
        setYldhDate(order?.YLDHDate ?? null);
    }, [open, order]);

    const handleSave = useCallback(async () => {
        const payload = {
            ID: toStringOrEmpty(order?.ID),
            OrderCode: toStringOrEmpty(order?.OrderCode),
            /** 原料资料提供期 */
            YLZLDate: toDateString(ylzlDate),
            /** 原料计划到货期 */
            YLDHDate: toDateString(yldhDate),
        };

        isDebugEnv && console.log('[计划部设置] 提交数据', payload);

        try {
            await yupaiApi.pmcSetting(payload.OrderCode, payload.YLZLDate, payload.YLDHDate);
            void message.success('设置成功');
            onSaved();
        } catch (error) {
            void message.error(ErrorMessage(error, '设置失败'));
        }
    }, [message, onSaved, order, yldhDate, ylzlDate]);

    const labelStyle: React.CSSProperties = {
        width: 112,
        flex: 'none',
        textAlign: 'right',
        marginRight: 8,
    };

    return (
        <Modal
            open={open}
            title="计划部设置"
            width={460}
            destroyOnHidden
            footer={null}
            mask={{closable: false}}
            onCancel={onCancel}
        >
            <div style={{display: 'flex', alignItems: 'center', marginTop: 20}}>
                <span style={labelStyle}>订单号：</span>
                <Input
                    style={{flex: 1}}
                    placeholder="订单号"
                    value={toStringOrEmpty(order?.OrderCode)}
                    readOnly
                />
            </div>

            <div style={{display: 'flex', alignItems: 'center', marginTop: 20}}>
                <span style={labelStyle}>原料资料提供期：</span>
                <DatePicker
                    style={{flex: 1}}
                    format={DATE_FORMAT}
                    value={toDayjs(ylzlDate)}
                    onChange={(date) => setYlzlDate(date)}
                />
            </div>

            <div style={{display: 'flex', alignItems: 'center', marginTop: 12}}>
                <span style={labelStyle}>原料计划到货期：</span>
                <DatePicker
                    style={{flex: 1}}
                    format={DATE_FORMAT}
                    value={toDayjs(yldhDate)}
                    onChange={(date) => setYldhDate(date)}
                />
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 24}}>
                <Button type="primary" style={{minWidth: 88}} onClick={handleSave}>
                    保存
                </Button>
            </div>
        </Modal>
    );
};

export default YupaiOrderPlanModal;
