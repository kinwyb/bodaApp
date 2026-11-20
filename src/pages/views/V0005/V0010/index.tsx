import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Form, Input, Select, Spin, Splitter, Switch, Tree, theme} from 'antd';
import type {TreeDataNode} from 'antd';
import {configApi, type DepartmentSaveRequest} from '@/api/modules/config';
import {ErrorMessage} from '@/api/request';
import type {Department} from '@/api/schemas/config/department';
import {CommandBar} from '@/components/CommandBar';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {usePermission} from '@/store/permission-context';
import {toStringOrEmpty} from '@/utils';
import {createDepartmentBridge, type DepartmentBridgeContext} from './bridged';
import {useDepartmentCommands, type DepartmentCommandContext, type DepartmentSaveResult} from './command';
import {DEPARTMENT_ATTRIBUTES} from './columns';
import {
    ancestorKeys,
    buildTreeData,
    createDepartmentTreeTable,
    findDepartment,
    flattenDepartments,
    nextChildNo,
    ROOT_KEY,
    type DepartmentTreeNode,
} from './departmentTree';

import { createPageTranslator } from '@/i18n';
import { useLocale } from '@/i18n/context';

const t = createPageTranslator("V0005_V0010");


/**
 * V0005_V0010 基础资料 > 部门设定
 *
 * 与旧客户端 `Views/V0005/V0010.cs` 逐项对应：
 * - 左树：`TreeList`（部门编码 + 部门名称两列）→ antd `Tree`，编码与名称在 titleRender 里并排；
 * - 右侧：`SplitContainerControl.Panel2` 的那组 Label + TextEdit → 一个 `Form`；
 * - 命令条：新增 / 保存 / 删除 / 刷新（`bar1` 的顺序，无分隔线）。
 *
 * 三处**有意不照搬**：
 * 1. 「每日目标SAM」「最大WIP」在设计器里 `Visible = false` 且 `Enabled = false`，不渲染；
 * 2. 保存成功后重新取一次树，而不是像旧客户端那样把草稿对象塞进本地树 ——
 *    那边塞进去的新节点没有主键（后端生成的 ID 被丢掉了），紧接着改它或删它都会失败；
 * 3. 虚拟根「所有部门」不是真实部门：只允许在它下面新增顶级部门，不允许保存或删除它。
 *
 * 界面桥声明在 `./bridged.ts`（那个文件存在就是「本页已接桥」的标记）。
 */

/** 右侧表单的字段值（字段名与接口 DTO 一致） */
type DepartmentFormValues = {
    ParentName?: string;
    No?: string;
    Name?: string;
    ContactUser?: string;
    Attribute?: string;
    Code?: string;
    Visible?: boolean;
};

/**
 * 右侧编辑区状态，对应旧客户端 `editDepartment` 与三个按钮 Enabled 的组合：
 * - none：没选中节点，右侧空白；
 * - view：选中了节点、还没动过字段（saveBtn 禁用）；
 * - edit：改过字段（saveBtn 可用、delBtn 禁用，与 `departmentInput_EditValueChanged` 一致）；
 * - add：新增中，草稿挂在 parentKey 下（newBtn / delBtn 禁用）。
 */
type EditorState =
    | {kind: 'none'}
    | {kind: 'view'; key: string}
    | {kind: 'edit'; key: string}
    | {kind: 'add'; parentKey: string};

const EMPTY_EDITOR: EditorState = {kind: 'none'};

function editorKey(editor: EditorState): string | null {
    if (editor.kind === 'none') return null;
    return editor.kind === 'add' ? editor.parentKey : editor.key;
}

function valuesOf(node: Department): DepartmentFormValues {
    return {
        ParentName: toStringOrEmpty(node.ParentName),
        No: toStringOrEmpty(node.No),
        Name: toStringOrEmpty(node.Name),
        ContactUser: toStringOrEmpty(node.ContactUser),
        Attribute: toStringOrEmpty(node.Attribute),
        Code: toStringOrEmpty(node.Code),
        Visible: node.Visible !== false,
    };
}

/** 模型给的开关值可能是 "true" / 1 这类形态，写回 antd Switch 前先收成布尔 */
function toFlag(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
}

/** 按编码找回节点：新增部门的主键由后端生成，本地只有编码这一个稳定标识 */
function keyOfNo(departments: Department[], no: string): string | null {
    const hit = flattenDepartments(departments).find((row) => row.No === no && row.Level > 0);
    return hit?.ID ?? null;
}

function renderNodeTitle(node: DepartmentTreeNode, mutedColor: string): React.ReactNode {
    const no = toStringOrEmpty(node.department.No);
    return (
        <span style={{display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0}}>
            <span style={{flex: '0 0 62px', color: mutedColor, fontVariantNumeric: 'tabular-nums'}}>{no}</span>
            <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                {toStringOrEmpty(node.department.Name)}
            </span>
        </span>
    );
}

const DepartmentPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {locale} = useLocale();
    const {message, modal} = App.useApp();
    const {token} = theme.useToken();
    const [form] = Form.useForm<DepartmentFormValues>();

    const [departments, setDepartments] = useState<Department[]>([]);
    const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([ROOT_KEY]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    /*
     * 三份 ref 副本：命令与界面桥的 handler 会在 await 中途读状态，那时闭包里的 state 是旧的。
     * 写入一律走下面的 apply*，保证 ref 与 state 同一时刻更新（不用等 effect）。
     */
    const departmentsRef = useRef<Department[]>([]);
    const editorRef = useRef<EditorState>(EMPTY_EDITOR);
    const savingRef = useRef(false);

    const applyDepartments = useCallback((list: Department[]) => {
        departmentsRef.current = list;
        setDepartments(list);
    }, []);

    const applyEditor = useCallback((next: EditorState) => {
        editorRef.current = next;
        setEditor(next);
    }, []);

    const applySaving = useCallback((value: boolean) => {
        savingRef.current = value;
        setSaving(value);
    }, []);

    const selectedKey = editorKey(editor);
    const adding = editor.kind === 'add';
    const dirty = editor.kind === 'edit' || adding;
    const isRootSelected = selectedKey === ROOT_KEY;
    /** 虚拟根不是真实部门：选中它时右侧只读，只能用它新增顶级部门 */
    const formDisabled = !selectedKey || (isRootSelected && !adding);

    const rows = useMemo(() => flattenDepartments(departments), [departments]);
    const treeData = useMemo(() => buildTreeData(departments), [departments]);
    const activeNode = useMemo(
        () => (selectedKey ? findDepartment(departments, selectedKey) : null),
        [departments, selectedKey],
    );

    const clearEditor = useCallback(() => {
        applyEditor(EMPTY_EDITOR);
        form.resetFields();
    }, [applyEditor, form]);

    /** 选中一个节点：填右侧表单、展开到它、回到「未改动」态（旧客户端 FocusedNodeChanged） */
    const selectNode = useCallback((key: string): boolean => {
        const list = departmentsRef.current;
        const node = findDepartment(list, key);
        if (!node) return false;
        applyEditor({kind: 'view', key});
        form.setFieldsValue(valuesOf(node));
        setExpandedKeys((keys) => Array.from(new Set([...keys, ...ancestorKeys(list, key)])));
        return true;
    }, [applyEditor, form]);

    const loadData = useCallback(async (): Promise<Department[]> => {
        setLoading(true);
        try {
            const res = await configApi.departments(1);
            const list = res.data ?? [];
            applyDepartments(list);
            return list;
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
            return departmentsRef.current;
        } finally {
            setLoading(false);
        }
    }, [applyDepartments, message]);

    /** 重新取数，并把已经不存在的选中节点清掉（删除、改编码之后） */
    const reload = useCallback(async (): Promise<void> => {
        const list = await loadData();
        const key = editorKey(editorRef.current);
        if (key && !findDepartment(list, key)) clearEditor();
    }, [clearEditor, loadData]);

    useEffect(() => {
        void reload();
    }, [reload]);

    /** 新增：在选中节点下建草稿，编码自动生成（旧客户端 newBtn_ItemClick） */
    const startAdd = useCallback(() => {
        const key = editorKey(editorRef.current);
        if (!key) {
            void message.warning(t("请先在部门树上选中上级部门"));
            return;
        }
        const parent = findDepartment(departmentsRef.current, key);
        if (!parent) return;
        applyEditor({kind: 'add', parentKey: key});
        form.setFieldsValue({
            ParentName: toStringOrEmpty(parent.Name),
            No: nextChildNo(parent),
            Name: '',
            ContactUser: '',
            Attribute: undefined,
            Code: '',
            Visible: true,
        });
    }, [applyEditor, form, message]);

    const save = useCallback(async (): Promise<DepartmentSaveResult> => {
        const state = editorRef.current;
        const key = editorKey(state);
        if (savingRef.current) return {ok: false, message: t("正在保存，请等待本次保存结果")};
        if (!key) return {ok: false, message: t("请先在部门树上选中一个部门，或执行新增")};
        const node = findDepartment(departmentsRef.current, key);
        if (!node) return {ok: false, message: t("选中的部门已不存在，请刷新后重试")};
        const isAdd = state.kind === 'add';
        if (!isAdd && key === ROOT_KEY) {
            return {ok: false, message: t("「所有部门」是树根，不能保存；要新建顶级部门请执行新增")};
        }
        let values: DepartmentFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return {ok: false, message: t("部门名称必填，请补齐后再保存")};
        }
        const request: DepartmentSaveRequest = {
            ID: isAdd ? '' : toStringOrEmpty(node.ID),
            No: toStringOrEmpty(values.No),
            Name: toStringOrEmpty(values.Name).trim(),
            ParentID: isAdd ? toStringOrEmpty(node.ID) : toStringOrEmpty(node.ParentID),
            ParentName: isAdd ? toStringOrEmpty(node.Name) : toStringOrEmpty(node.ParentName),
            Attribute: toStringOrEmpty(values.Attribute),
            ContactUser: toStringOrEmpty(values.ContactUser),
            Code: toStringOrEmpty(values.Code),
            Visible: values.Visible !== false,
        };
        applySaving(true);
        try {
            await configApi.saveDepartment(request);
            const list = await loadData();
            const savedKey = keyOfNo(list, request.No ?? '');
            if (savedKey) selectNode(savedKey);
            else clearEditor();
            const text = `${isAdd ? '已新增' : '已保存'}部门 ${request.No} ${request.Name}`.trim();
            void message.success(text);
            return {ok: true, message: text};
        } catch (error) {
            const reason = ErrorMessage(error, isAdd ? '部门新增失败' : '部门保存失败');
            void message.error(reason);
            return {ok: false, message: reason};
        } finally {
            applySaving(false);
        }
    }, [applySaving, clearEditor, form, loadData, message, selectNode]);

    const canAdd = Boolean(selectedKey) && !adding && !saving;
    const canSave = Boolean(selectedKey) && dirty && !formDisabled && !saving;
    const canDelete = Boolean(selectedKey) && !isRootSelected && !dirty && !saving;

    const commandContext = useMemo<DepartmentCommandContext>(() => ({
        message,
        modal,
        activeNode,
        isRootSelected,
        canAdd,
        canSave,
        canDelete,
        startAdd,
        save,
        reload,
    }), [activeNode, canAdd, canDelete, canSave, isRootSelected, message, modal, reload, save, startAdd]);

    const commands = useDepartmentCommands(commandContext);

    /*
     * 桥的动作表只列**屏幕上真正渲染出来**的按钮：CommandBar 会按 permission 找菜单 action
     * 再判 hasButton，这里用同一套规则过一遍，否则无权的按钮会出现在 agent 的 actions 里。
     */
    const {actions, hasButton} = usePermission();
    const bridgeCommands = useMemo(() => commands.filter((item) => {
        if (!item.permission) return true;
        const action = (actions.get(view) ?? []).find((entry) => entry.name === item.permission);
        return action ? hasButton(action.menuCode) : false;
    }), [actions, commands, hasButton, view]);

    /** 桥的选中命令走这里：树是单选，取最后一个 key */
    const selectFromBridge = useCallback((keys: string[]): number => {
        const key = keys[keys.length - 1];
        if (!key) return 0;
        return selectNode(key) ? 1 : 0;
    }, [selectNode]);

    /** 字段锁：只回答「右侧此刻有没有一个可编辑的部门」；单个字段的只读由桥的字段表声明 */
    const fieldLock = useCallback((): string | null => {
        const key = editorKey(editorRef.current);
        if (!key) return '右侧还没有部门：先用 data.select 选中一个节点，或执行 add 新增';
        if (key === ROOT_KEY && editorRef.current.kind !== 'add') {
            return '「所有部门」是树根，不是真实部门：要新建顶级部门请执行 add';
        }
        return null;
    }, []);

    const writeForm = useCallback((patch: Record<string, unknown>) => {
        const next = {...patch};
        if ('Visible' in next) next.Visible = toFlag(next.Visible);
        form.setFieldsValue(next);
        const current = editorRef.current;
        if (current.kind === 'view') applyEditor({kind: 'edit', key: current.key});
    }, [applyEditor, form]);

    const bridgeContext = useMemo<DepartmentBridgeContext>(() => {
        /*
         * 树的读表适配器就在这里造：它闭包的是**本次渲染的**行与选中态，
         * 而桥每次调用都重新 read() 拿最新 context，所以不需要再维护一份 ref 副本。
         */
        const treeTable = createDepartmentTreeTable(() => ({
            rows,
            activeKey: selectedKey,
            select: selectFromBridge,
        }));
        return {
            view,
            commands: bridgeCommands,
            rows,
            activeKey: selectedKey,
            activeNode,
            adding,
            dirty,
            loading,
            saving,
            readTable: () => treeTable,
            readFormValues: () => form.getFieldsValue() as Record<string, unknown>,
            fieldLock,
            writeForm,
            save,
            reload,
        };
    }, [
        activeNode, adding, bridgeCommands, dirty, fieldLock, form, loading, reload, rows,
        save, saving, selectFromBridge, selectedKey, view, writeForm,
    ]);

    const bridge = useMemo(() => createDepartmentBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <CommandBar view={view} items={commands}/>
            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                marginTop: 12,
                padding: 5,
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: 8,
                overflow: 'hidden',
            }}>
                <Splitter style={{flex: 1, minHeight: 0, height: 'auto'}}>
                    <Splitter.Panel className="splitter-pane-body" defaultSize="42%" min="24%" max="60%"
                                    style={{overflow: 'hidden'}}>
                        <div style={{flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 4px'}}>
                            <Spin spinning={loading}>
                                <Tree
                                    blockNode
                                    treeData={treeData}
                                    expandedKeys={expandedKeys}
                                    selectedKeys={selectedKey ? [selectedKey] : []}
                                    onExpand={(keys) => setExpandedKeys(keys)}
                                    onSelect={(keys) => {
                                        // 再点一次已选中节点时 antd 会回空数组；旧客户端的焦点不会消失，这里保持选中
                                        const key = keys.length > 0 ? String(keys[0]) : '';
                                        if (key) selectNode(key);
                                    }}
                                    titleRender={(node: TreeDataNode) =>
                                        renderNodeTitle(node as DepartmentTreeNode, token.colorTextTertiary)}
                                    style={{userSelect: 'none'}}
                                />
                            </Spin>
                        </div>
                    </Splitter.Panel>
                    <Splitter.Panel className="splitter-pane-body" style={{overflow: 'auto'}}>
                        <div style={{padding: '20px 24px', maxWidth: 460}}>
                            <Form
                                form={form}
                                disabled={formDisabled}
                                layout={locale === 'zh-CN' ? 'horizontal' : 'vertical'}
                                labelCol={locale === 'zh-CN' ? {flex: '0 0 88px'} : undefined}
                                wrapperCol={locale === 'zh-CN' ? {flex: '1 1 auto'} : undefined}
                                labelAlign="right"
                                onValuesChange={() => {
                                    const current = editorRef.current;
                                    if (current.kind === 'view') applyEditor({kind: 'edit', key: current.key});
                                }}
                            >
                                <Form.Item label={t("上级部门")} name="ParentName">
                                    <Input readOnly variant="borderless"/>
                                </Form.Item>
                                <Form.Item label={t("部门编号")} name="No">
                                    <Input disabled/>
                                </Form.Item>
                                <Form.Item label={t("部门名称")} name="Name"
                                           rules={[{required: true, message: t("请填写部门名称")}]}>
                                    <Input allowClear maxLength={50}/>
                                </Form.Item>
                                <Form.Item label={t("联系人")} name="ContactUser">
                                    <Input allowClear maxLength={50}/>
                                </Form.Item>
                                <Form.Item label={t("部门属性")} name="Attribute">
                                    <Select
                                        allowClear
                                        placeholder={t("请选择")}
                                        options={DEPARTMENT_ATTRIBUTES.map((item) => ({value: item, label: t(item)}))}
                                    />
                                </Form.Item>
                                <Form.Item label={t("部门简码")} name="Code" extra={t("主要用在打印工序条码时使用")}>
                                    <Input allowClear maxLength={10} style={{width: 120}}/>
                                </Form.Item>
                                <Form.Item label={t("是否显示")} name="Visible" valuePropName="checked">
                                    <Switch/>
                                </Form.Item>
                            </Form>
                        </div>
                    </Splitter.Panel>
                </Splitter>
            </div>
        </div>
    );
};

export default DepartmentPage;
