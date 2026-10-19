import {FieldTimeOutlined, SettingOutlined, ShopOutlined} from '@ant-design/icons';
import type {YupaiOrderSettingsCommandFactory} from './types';

/**
 * 三个「设置」类命令：预订单阶段 / 工段产地 / 计划部。
 *
 * 共用 YupaiOrderSettingsCommandFactory（多一个 openSetting）：三者的差别只是
 * 「打开哪一个弹窗」，没必要各占一份扩展依赖。
 *
 * 都作用于**当前激活行**（activeRow），没有激活行时按钮置灰 ——
 * 与分批、变更日志同一条判据：这类设置是针对某一单的，多选时看用户此刻聚焦的那一行。
 */

/** 预订单阶段（产前样 / 全码样 / 待客户反馈 / 待订单 + 其它阶段） */
export const stageCommand: YupaiOrderSettingsCommandFactory = ({activeRow, openSetting}) => ({
    key: 'stage',
    label: '预订的阶段',
    icon: <FieldTimeOutlined/>,
    disabled: !activeRow,
    onClick: () => {
        if (!activeRow) return;
        openSetting('stage', activeRow);
    },
});

/** 工段产地（织造产地 / 缝制产地） */
export const originCommand: YupaiOrderSettingsCommandFactory = ({activeRow, openSetting}) => ({
    key: 'origin',
    label: '工段产地',
    icon: <ShopOutlined/>,
    permission: '产地设置',
    disabled: !activeRow,
    onClick: () => {
        if (!activeRow) return;
        openSetting('origin', activeRow);
    },
});

/** 计划部设定（原料资料提供期 / 原料计划到货期） */
export const planCommand: YupaiOrderSettingsCommandFactory = ({activeRow, openSetting}) => ({
    key: 'plan',
    label: '计划部设定',
    icon: <SettingOutlined/>,
    permission: 'PMC设置',
    disabled: !activeRow,
    onClick: () => {
        if (!activeRow) return;
        openSetting('plan', activeRow);
    },
});
