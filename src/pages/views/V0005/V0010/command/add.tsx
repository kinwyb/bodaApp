import {PlusOutlined} from '@ant-design/icons';
import type {DepartmentCommandFactory} from './types';

/**
 * 新增：在**当前选中的节点下**建一个子部门草稿（旧客户端 `newBtn_ItemClick`）。
 *
 * 编码由页面按「父编码 + 同级最大序号加一」算好，名称等字段清空，是否显示默认勾选；
 * 点下去只是进入新增态，真正落库要再点「保存」。
 *
 * 旧客户端在这里判 `addPower && savePower`，新系统由按钮显隐解决：
 * 菜单里没配「新增」这个 action，按钮根本不渲染。
 */
export const addCommand: DepartmentCommandFactory = ({canAdd, startAdd}) => ({
    key: 'add',
    label: '新增',
    icon: <PlusOutlined/>,
    permission: '新增',
    disabled: !canAdd,
    onClick: startAdd,
});
