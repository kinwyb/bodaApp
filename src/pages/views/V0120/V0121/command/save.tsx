import {SaveOutlined} from '@ant-design/icons';
import type {OrderInfoCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0121");


export const saveCommand: OrderInfoCommandFactory = ({editing, loading, saving, save}) => ({
    key: 'save',
    label: t("保存"),
    icon: <SaveOutlined/>,
    // 旧客户端的保存按钮与编辑共用同一权限位，菜单动作名是「编辑」。
    permission: '编辑',
    disabled: !editing || loading || saving,
    onClick: () => {
        void save();
    },
});
