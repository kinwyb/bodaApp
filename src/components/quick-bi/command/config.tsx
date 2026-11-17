import {SettingOutlined} from '@ant-design/icons';
import type {QuickBICommandFactory} from './types';

/**
 * 配置明细：维护 BIViewConfig（哪个指标点开哪些明细标签页）。
 * C# 里仅 SuperUserID 可见（detailViewConfigBtn_ItemClick 判 UserInfo == SuperUserID），
 * 非超管直接不产出这条命令 —— 权限体现在「按钮有没有」，不是「点了报错」。
 */
export const configCommand: QuickBICommandFactory = ({isSuperUser, openConfig}) => {
    if (!isSuperUser) return [];
    return {
        key: 'config',
        label: '配置明细',
        icon: <SettingOutlined/>,
        onClick: openConfig,
    };
};
