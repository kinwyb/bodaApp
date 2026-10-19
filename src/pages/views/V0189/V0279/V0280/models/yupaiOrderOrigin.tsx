import React, {useCallback, useEffect, useState} from 'react';
import {App, Button, Input, Modal, Select} from 'antd';
import {yupaiApi, type YupaiOrder} from '@/api';
import {isDebugEnv, toStringOrEmpty} from '@/utils';
import {ORG_SELECT_OPTIONS} from "@/store/orgs.ts";
import type {YupaiOrderOrgSettings} from "@/api/modules/yupai.ts";
import {ErrorMessage} from "@/api/request.ts";

export interface YupaiOrderOriginModalProps {
    open: boolean;
    order: YupaiOrder | null;
    onCancel: () => void;
    onSaved: () => void;
}

/**
 * 工段产地设置：织造产地（`KnitOrgID`）+ 缝制产地（`OrgID`）。
 *
 * 字段是**组织机构 id**，界面上显示工厂名；两者在同一条订单上是成对的
 * （`OrgID` ↔ `WorkPlace`），所以选项从列表数据里汇总得到。
 *
 * 保存接口由业务方接入（见 handleSave 末尾的接入点）。
 */
const YupaiOrderOriginModal: React.FC<YupaiOrderOriginModalProps> = ({
                                                                         open,
                                                                         order,
                                                                         onCancel,
                                                                         onSaved,
                                                                     }) => {
    const {message} = App.useApp();
    const [knitOrgID, setKnitOrgID] = useState('');
    const [orgID, setOrgID] = useState('');

    useEffect(() => {
        if (!open) return;
        setKnitOrgID(toStringOrEmpty(order?.KnitOrgID));
        setOrgID(toStringOrEmpty(order?.OrgID));
    }, [open, order]);

    const handleSave = useCallback(async () => {
        const payload: YupaiOrderOrgSettings = {
            YupaiOrderID: toStringOrEmpty(order?.ID),
            /** 织造产地（组织机构 id） */
            KnitOrgID: knitOrgID,
            /** 缝制产地（组织机构 id） */
            SewOrgID: orgID,
        };
        try {
            isDebugEnv && console.log('[工段产地设置] 提交数据', payload);
            await yupaiApi.orgSetting(payload);
            void message.success('保存成功');
            onSaved();
        } catch (error) {
            void message.error(ErrorMessage(error, '组织产地保存失败'))
        }

    }, [knitOrgID, message, onSaved, order, orgID]);

    const labelStyle: React.CSSProperties = {
        width: 84,
        flex: 'none',
        textAlign: 'right',
        marginRight: 8,
    };

    return (
        <Modal
            open={open}
            title="工段产地设置"
            width={420}
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
            <div style={{display: 'flex', alignItems: 'center', marginTop: 16}}>
                <span style={labelStyle}>款号：</span>
                <Input
                    style={{flex: 1}}
                    placeholder="款号"
                    value={toStringOrEmpty(order?.StyleCode)}
                    readOnly
                />
            </div>
            <div style={{display: 'flex', alignItems: 'center', marginTop: 16}}>
                <span style={labelStyle}>织造产地：</span>
                <Select
                    style={{flex: 1}}
                    placeholder="请选择"
                    showSearch
                    options={ORG_SELECT_OPTIONS}
                    value={knitOrgID || undefined}
                    onChange={setKnitOrgID}
                />
            </div>

            <div style={{display: 'flex', alignItems: 'center', marginTop: 12}}>
                <span style={labelStyle}>缝制产地：</span>
                <Select
                    style={{flex: 1}}
                    placeholder="请选择"
                    showSearch
                    options={ORG_SELECT_OPTIONS}
                    value={orgID || undefined}
                    onChange={setOrgID}
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

export default YupaiOrderOriginModal;
