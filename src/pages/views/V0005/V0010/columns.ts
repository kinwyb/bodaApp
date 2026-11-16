import type {AppColumnDef} from '@/components/grid-table';

/**
 * 部门树的列目录（页面与界面桥共用这一份）。
 *
 * 屏幕左侧是 antd `Tree`（对应旧客户端的 `TreeList`，两列：部门编码 + 部门名称），
 * 树本身没有列定义，这份定义是给界面桥用的「这张表有哪些列」。
 *
 * 所以它比屏幕上多几列：树靠缩进与展开箭头表达的从属关系，摊平成行之后必须落成
 * `ParentName` / `Level` 两列，否则模型读不出层级；右侧表单里的属性、联系人、简码、
 * 是否显示也一并列出来，模型才能在不逐个选中节点的情况下比对整棵部门树。
 */
export const DEPARTMENT_COLUMNS: AppColumnDef[] = [
    {field: 'No', title: '部门编码', dataType: 'text', width: 130},
    {field: 'Name', title: '部门名称', dataType: 'text', width: 200},
    {field: 'ParentName', title: '上级部门', dataType: 'text', width: 160},
    {field: 'Level', title: '层级', dataType: 'int', width: 70},
    {field: 'Attribute', title: '部门属性', dataType: 'text', width: 100},
    {field: 'ContactUser', title: '联系人', dataType: 'text', width: 110},
    {field: 'Code', title: '部门简码', dataType: 'text', width: 100},
    {field: 'Visible', title: '是否显示', dataType: 'boolean', width: 90},
];

/** 桥取数时的默认投影列：认部门 + 看层级就够了，其余列按需用 fields 要 */
export const DEPARTMENT_KEY_FIELDS = ['No', 'Name', 'ParentName', 'Level', 'Attribute'];

export const DEPARTMENT_COLUMN_HINTS: Record<string, string> = {
    No: '部门编码：上级编码 + 两位序号，如 01 / 0101；新增时按同级最大序号自动加一',
    Level: '层级：0 = 树根「所有部门」（虚拟节点，不是真实部门），1 = 顶级部门，往下依次加一',
    Attribute: '部门属性，取值：工厂 / 车间 / 班组',
    Code: '部门简码，主要用在打印工序条码时',
    Visible: '是否显示：false 的部门在员工选择等业务界面里不出现，本页仍然列出',
};

/** 部门属性下拉（旧客户端 `depType.Properties.Items`，只能选不能填） */
export const DEPARTMENT_ATTRIBUTES = ['工厂', '车间', '班组'];
