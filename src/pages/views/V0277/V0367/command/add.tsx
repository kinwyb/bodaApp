import {FileAddOutlined} from '@ant-design/icons';
import type {ProcessRouteMatrixCommandFactory} from './types';

/**
 * 新增：打开空白的矩阵表单。
 *
 * 没有 `menuCode`：工艺路线矩阵的菜单权限编码还没拿到（包装 BOM 那边是后端给的 GUID），
 * 先不做按钮级权限 —— 菜单本身已经挡了一层。等后端给出编码，只补这一个字段。
 */
export const addCommand: ProcessRouteMatrixCommandFactory = ({openForm}) => ({
    key: 'add',
    label: '新增',
    icon: <FileAddOutlined/>,
    onClick: () => openForm('add', null),
});
