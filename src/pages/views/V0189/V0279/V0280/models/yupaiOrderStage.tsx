import React, {useCallback, useEffect, useState} from 'react';
import {App, Button, Checkbox, Input, Modal} from 'antd';
import {yupaiApi, type YupaiOrder} from '@/api';
import {isDebugEnv, toNumberOrZero, toStringOrEmpty} from '@/utils';
import {ErrorMessage} from "@/api/request.ts";
import type {YupaiOrderStep} from "@/api/modules/yupai.ts";

export interface YupaiOrderStageModalProps {
    open: boolean;
    /** 要设置阶段的那一单 */
    order: YupaiOrder | null;
    onCancel: () => void;
    /** 确认后回调（当前只打印数据，接口接入后由调用方刷新列表） */
    onSaved: () => void;
}

/**
 * 四个阶段勾选项：字段 → 文案，顺序与截图一致。
 *
 * 后端用 0/1 表示是否，不是布尔：读的时候 `=== 1`，写回时 `1 / 0`。
 * 字段名与 `YupaiOrderDto` 对齐（SSStep=产前样、QMStep=全码样、
 * WaitCustStep=待客户反馈、WaitOrderStep=待订单）。
 */
const STAGE_ITEMS: ReadonlyArray<{ field: 'SSStep' | 'QMStep' | 'WaitCustStep' | 'WaitOrderStep'; label: string }> = [
    {field: 'SSStep', label: '产前样阶段'},
    {field: 'QMStep', label: '全码样阶段'},
    {field: 'WaitCustStep', label: '待客户反馈阶段'},
    {field: 'WaitOrderStep', label: '待订单阶段'},
];

/**
 * 预订单阶段设置。
 *
 * 界面：订单号 / 款号 → 四个阶段勾选 → 其它阶段描述 → 确认。
 * 保存接口由业务方接入（见 handleConfirm 末尾的接入点）。
 */
const YupaiOrderStageModal: React.FC<YupaiOrderStageModalProps> = ({open, order, onCancel, onSaved}) => {
    const {message} = App.useApp();
    /** 字段 → 是否勾选（用对象而不是四个 state：勾选项以后增删只改 STAGE_ITEMS） */
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [otherStep, setOtherStep] = useState('');

    useEffect(() => {
        if (!open) return;
        const next: Record<string, boolean> = {};
        STAGE_ITEMS.forEach(({field}) => {
            next[field] = toNumberOrZero(order?.[field]) === 1;
        });
        setChecked(next);
        setOtherStep(toStringOrEmpty(order?.OtherStep));
    }, [open, order]);

    const labelStyle: React.CSSProperties = {
        width: 112,
        flex: 'none',
        textAlign: 'right',
        marginRight: 8,
    };

    const handleConfirm = useCallback(async () => {
        const payload: YupaiOrderStep = {
            QMStep: toNumberOrZero(order?.QMStep),
            SSStep: toNumberOrZero(order?.SSStep),
            WaitCustStep: toNumberOrZero(order?.WaitCustStep),
            WaitOrderStep: toNumberOrZero(order?.WaitOrderStep),
            ID: toStringOrEmpty(order?.ID),
            OtherStep: otherStep.trim()
        };
        STAGE_ITEMS.forEach(({field}) => {
            payload[field] = checked[field] ? 1 : 0;
        });

        isDebugEnv && console.log('[预订单阶段设置] 提交数据', payload);

        try {
            await yupaiApi.orderStepSave([payload]);
            void message.success('设置成功');
            onSaved();
        } catch (error) {
            void message.error(ErrorMessage(error, '设置失败'));
        }

    }, [checked, message, onSaved, order, otherStep]);

    return (
        <Modal
            open={open}
            title="预订单阶段设置"
            width={600}
            destroyOnHidden
            footer={null}
            mask={{closable: false}}
            onCancel={onCancel}
        >
            <div style={{display: 'flex', alignItems: 'center', marginTop: 16}}>
                <span style={labelStyle}>订单号：</span>
                <Input
                    style={{flex: 1}}
                    placeholder="订单号"
                    value={toStringOrEmpty(order?.OrderCode)}
                    readOnly
                />
            </div>
            <div style={{display: 'flex', alignItems: 'center', marginTop: 16, marginBottom: 16}}>
                <span style={labelStyle}>款号：</span>
                <Input
                    style={{flex: 1}}
                    placeholder="款号"
                    value={toStringOrEmpty(order?.StyleCode)}
                    readOnly
                />
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 18, paddingLeft: 8}}>
                {STAGE_ITEMS.map(({field, label}) => (
                    <Checkbox
                        key={field}
                        checked={checked[field] === true}
                        onChange={(event) =>
                            setChecked((prev) => ({...prev, [field]: event.target.checked}))
                        }
                    >
                        {label}
                    </Checkbox>
                ))}
            </div>

            <div style={{display: 'flex', marginTop: 24}}>
                <span style={{width: 84, flex: 'none', lineHeight: '22px'}}>其它阶段：</span>
                <Input.TextArea
                    rows={9}
                    placeholder="其它阶段描述"
                    value={otherStep}
                    onChange={(event) => setOtherStep(event.target.value)}
                    style={{flex: 1, resize: 'none'}}
                />
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 16}}>
                <Button type="primary" style={{minWidth: 88}} onClick={handleConfirm}>
                    确认
                </Button>
            </div>
        </Modal>
    );
};

export default YupaiOrderStageModal;
