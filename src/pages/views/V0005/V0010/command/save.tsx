import {SaveOutlined} from '@ant-design/icons';
import type {DepartmentCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0005_V0010");


/**
 * 保存：把右侧表单提交到 `/department/save`（新增与修改同一个接口，靠 ID 是否为空区分）。
 *
 * 提示由页面的 `save()` 统一弹，命令这里只负责触发 —— 界面桥也走同一个函数，
 * 两条入口的成功/失败口径才不会分叉。
 */
export const saveCommand: DepartmentCommandFactory = ({canSave, save}) => ({
    key: 'save',
    label: t("保存"),
    icon: <SaveOutlined/>,
    permission: '保存',
    disabled: !canSave,
    onClick: () => void save(),
});
