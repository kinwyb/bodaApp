import {ReloadOutlined} from '@ant-design/icons';
import type {DepartmentCommandFactory} from './types';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0005_V0010");


/**
 * 刷新：重新取整棵部门树。
 *
 * 这一页**没有查询条**（旧客户端也没有任何查询条件，进页面就取全量），
 * 所以刷新必须保留 —— 否则用户想拿最新数据只能关掉页签重开。
 *
 * 不声明 `permission`：菜单里 V0005_V0010 只配了新增 / 保存 / 删除三个 action，
 * 声明一个不存在的「刷新」会让 CommandBar 直接把按钮藏掉，等于没迁。
 */
export const refreshCommand: DepartmentCommandFactory = ({reload}) => ({
    key: 'refresh',
    label: t("刷新"),
    icon: <ReloadOutlined/>,
    dividerBefore: true,
    onClick: () => void reload(),
});
