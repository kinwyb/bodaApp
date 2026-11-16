import type {Department} from '@/api/schemas/config/department';
import type {CommandItem} from '@/components/CommandBar';
import type {UIAction, UIForm, UIGuide, UISnapshotData} from '@/pages/agent/protocol';
import {
    createFormWriteActions,
    createFormWriteHandlers,
    createFormWriter,
    createTableBridge,
    type FormFieldSpec,
    type TableReadApi,
    type UIBridgeHandler,
    type UIBridgeHost,
} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import type {DepartmentSaveResult} from './command/types';
import {
    DEPARTMENT_ATTRIBUTES,
    DEPARTMENT_COLUMN_HINTS,
    DEPARTMENT_COLUMNS,
    DEPARTMENT_KEY_FIELDS,
} from './columns';
import {ROOT_KEY, type DepartmentRow} from './departmentTree';

/**
 * V0005_V0010（基础资料 > 部门设定）的界面桥声明。
 *
 * **这个文件存在本身就是「本页接入了界面桥」的标记**：工作台的导航清单靠它判定。
 *
 * 这一页没有 GridTable，左边是部门树、右边是明细表单，所以两段能力各接一个通用层：
 * - 树 → `createDepartmentTreeTable` 适配成 `TableReadApi`，再交给 `createTableBridge`
 *   （列目录、按行号取数、按主键取整行、选中，全部复用，页面不自己写取数命令）；
 * - 表单 → `createFormWriter`（批量写字段、判锁、回执）。
 * 命令条的动作表直接来自页面的 `commands`，不另抄一份。
 */

/** 页面交给桥的东西：只有状态与能力，没有桥的结构 */
export type DepartmentBridgeContext = {
    view: string;
    /** 命令条上的命令（已按权限过滤，与屏幕上看得见的按钮一致） */
    commands: CommandItem[];
    /** 摊平后的部门行（含虚拟根），顺序 = 树的先序 */
    rows: DepartmentRow[];
    activeKey: string | null;
    activeNode: Department | null;
    adding: boolean;
    dirty: boolean;
    loading: boolean;
    saving: boolean;
    readTable: () => TableReadApi | null;
    /** 右侧表单此刻的值（antd Form store 才是真相，不缓存快照） */
    readFormValues: () => Record<string, unknown>;
    fieldLock: (id: string) => string | null;
    writeForm: (patch: Record<string, unknown>) => void;
    save: () => Promise<DepartmentSaveResult>;
    reload: () => Promise<void>;
};

const GUIDE: UIGuide = {
    summary: '部门设定：维护工厂 / 车间 / 班组的部门树，选中部门后修改名称、属性、联系人、简码与是否显示，或在选中部门下新增子部门',
    steps: [
        '部门树摊平在 data 表里：用 data.page 按行号取部门，再用 data.select 传 rowId 选中它，右侧表单随即带出该部门的资料',
        '改部门：data.select 选中 → form.setMany 一次传齐要改的字段 → save',
        '新增子部门：data.select 选中上级部门 → add（编码自动生成、名称清空）→ form.setMany 填名称等字段 → save',
        '新增顶级部门：先选中树根「所有部门」（rowId = __all_departments__）再 add',
        '删除：data.select 选中后执行 delete；它只弹确认框，真实结果看 action.outcome 事件',
    ],
    terms: {
        部门编码: 'No，上级编码 + 两位序号（如 01 / 0101），界面只读，新增时自动算',
        部门属性: 'Attribute，取值：工厂 / 车间 / 班组',
        部门简码: 'Code，主要用在打印工序条码时',
        是否显示: 'Visible，false 的部门在员工选择等业务界面里不出现，本页仍然列出',
        所有部门: '树根虚拟节点（Level = 0，rowId = __all_departments__），不是真实部门',
    },
    cautions: [
        'data 表是整棵部门树摊平后的**全部**节点（含树上折叠起来的），按先序排列：父在前、子紧随其后。' +
        '行号与展开状态无关，层级看 Level / ParentName 两列',
        'Level = 0 的那一行是树根「所有部门」：不能保存、不能删除，只能在它下面新增顶级部门',
        '部门编号（No）与上级部门（ParentName）只读：编码按层级生成，换上级要靠新增与删除',
        'add 只是进入新增态并生成编码，没有落库；必须再执行 save',
        'save 成功后页面会重新取一次树：新增部门的主键由后端生成，与 add 时的草稿不是同一个 rowId，' +
        '要继续操作它请重新 data.page 按编码找',
    ],
};

/** 右侧表单的字段表（与 index.tsx 的 Form.Item 一一对应） */
const FORM_FIELDS: FormFieldSpec[] = [
    {
        id: 'ParentName',
        label: '上级部门',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: '由树结构决定，换上级要靠新增与删除',
    },
    {
        id: 'No',
        label: '部门编号',
        type: 'readonly',
        readOnly: true,
        readOnlyReason: '编码按「上级编码 + 两位序号」自动生成，不可修改',
    },
    {id: 'Name', label: '部门名称', type: 'text', required: true},
    {id: 'ContactUser', label: '联系人', type: 'text'},
    {id: 'Attribute', label: '部门属性', type: 'select', options: DEPARTMENT_ATTRIBUTES},
    {id: 'Code', label: '部门简码', type: 'text'},
    {id: 'Visible', label: '是否显示', type: 'switch'},
];

const FIELD_HINTS: Record<string, string> = {
    Code: '主要用在打印工序条码时使用',
    Visible: 'true / false；false 的部门在员工选择等业务界面里不出现',
    Attribute: '只能填 工厂 / 车间 / 班组',
};

/** 表单段：没选中部门时右侧是空的，就不声明表单 */
function departmentForm(ctx: DepartmentBridgeContext): UIForm | null {
    if (!ctx.activeKey || !ctx.activeNode) return null;
    const values = ctx.readFormValues();
    const no = toStringOrEmpty(values.No);
    const name = toStringOrEmpty(values.Name);
    return {
        id: 'department',
        title: ctx.adding
            ? `新增部门 · 上级 ${toStringOrEmpty(ctx.activeNode.Name)}`
            : `部门 ${no} ${name}`.trim(),
        mode: ctx.adding ? 'add' : 'edit',
        recordId: ctx.adding || ctx.activeKey === ROOT_KEY ? null : toStringOrEmpty(ctx.activeNode.ID) || null,
        fields: FORM_FIELDS.map((spec) => {
            const lock = ctx.fieldLock(spec.id);
            return {
                ...spec,
                value: values[spec.id] ?? null,
                readOnly: spec.readOnly === true || lock !== null,
                readOnlyReason: spec.readOnlyReason ?? lock ?? undefined,
                hint: FIELD_HINTS[spec.id],
            };
        }),
        errors: [],
        dirty: ctx.dirty,
    };
}

/** 把通用写入命令的示例换成本页真实可写的字段（默认示例会挑到只读的上级部门） */
function formWriteActions(): UIAction[] {
    return createFormWriteActions(FORM_FIELDS).map((action) => {
        if (action.id === 'form.setMany') {
            return {
                ...action,
                params: action.params?.map((param) => param.name === 'values'
                    ? {
                        ...param,
                        hint: '字段 id → 新值的对象（也接受 JSON 字符串），例如 ' +
                            '{"Name":"缝制一车间","Attribute":"车间","Visible":true}。' +
                            '字段 id 见 form.fields[].id；一次传齐，不要一个字段调一次',
                    }
                    : param),
            };
        }
        if (action.id === 'form.set') {
            return {
                ...action,
                params: action.params?.map((param) => param.name === 'field'
                    ? {...param, hint: '字段 id，见 form.fields[].id，例如 Name / Attribute / Visible'}
                    : param),
            };
        }
        return action;
    });
}

function commandDisabledReason(item: CommandItem, ctx: DepartmentBridgeContext): string | undefined {
    if (!item.disabled) return undefined;
    if (ctx.loading) return '部门树正在加载，请等数据落地后再操作';
    if (ctx.saving) return '保存进行中，请等保存结果';
    switch (item.key) {
        case 'add':
            return ctx.adding
                ? '已经在新增态：填完字段执行 save，或先 data.select 选中别的部门'
                : '先用 data.select 选中一个上级部门';
        case 'save':
            return ctx.activeKey === ROOT_KEY && !ctx.adding
                ? '「所有部门」是树根，不能保存；要新建顶级部门请执行 add'
                : '还没有改动：先 form.setMany 改字段，或执行 add 新增';
        case 'delete':
            if (!ctx.activeKey) return '先用 data.select 选中一个部门';
            if (ctx.activeKey === ROOT_KEY) return '树根「所有部门」不是真实部门，不能删除';
            return '右侧有未保存的改动：先 save，或重新 data.select 选中该部门放弃改动，再删除';
        default:
            return '当前状态下不可用';
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 选中是页面 state，要等它落地再回执，否则补丁里的 selection 还是空的 */
async function waitForSelection(read: () => DepartmentBridgeContext, rowId: string): Promise<boolean> {
    const deadline = Date.now() + 800;
    for (;;) {
        if (read().activeKey === rowId) return true;
        if (Date.now() >= deadline) return false;
        await sleep(16);
    }
}

export function createDepartmentBridge(read: () => DepartmentBridgeContext): UIBridgeHost {
    const tableBridge = createTableBridge({
        columns: DEPARTMENT_COLUMNS,
        rowKey: 'ID',
        readTable: () => read().readTable(),
        keyFields: DEPARTMENT_KEY_FIELDS,
        columnHints: DEPARTMENT_COLUMN_HINTS,
        waitSelected: (rowId) => waitForSelection(read, rowId),
    });

    const writer = createFormWriter({
        fields: () => FORM_FIELDS,
        fieldLock: (id) => read().fieldLock(id),
        write: (patch) => read().writeForm(patch),
    });

    const handlers: Record<string, UIBridgeHandler> = {
        ...tableBridge.handlers,
        ...createFormWriteHandlers(writer),
    };

    read().commands.forEach((item) => {
        handlers[item.key] = async () => {
            const ctx = read();
            // 命令项随状态重新生成，闭包里那份可能过期：执行时按 key 重新取
            const latest = ctx.commands.find((command) => command.key === item.key);
            if (!latest?.onClick) throw new Error(`命令「${item.key}」当前不可用`);
            if (latest.disabled) {
                throw new Error(commandDisabledReason(latest, ctx) ?? `「${latest.label}」当前不可用`);
            }
            if (latest.key === 'save') {
                const result = await ctx.save();
                if (!result.ok) throw new Error(result.message);
                return result.message;
            }
            if (latest.key === 'refresh') {
                await ctx.reload();
                return '已重新加载部门树';
            }
            latest.onClick();
            if (latest.waitConfirm) {
                return `「${latest.label}」已触发，但还没有生效：界面上弹出了确认框，用户点「确认删除」之后才会执行。` +
                    '不要重复调用这条命令；最终结果以 action.outcome 事件或重新读取部门树为准';
            }
            if (latest.key === 'add') {
                return '已进入新增态：部门编码按上级自动生成，用 form.setMany 填名称等字段后执行 save';
            }
            return `已执行：${latest.label}`;
        };
    });

    return {
        snapshot: (): UISnapshotData => {
            const ctx = read();
            const form = departmentForm(ctx);
            return {
                view: ctx.view,
                title: '基础资料 > 部门设定',
                mode: ctx.adding || ctx.dirty ? 'form' : 'list',
                guide: GUIDE,
                actions: [
                    ...ctx.commands.map((item) => ({
                        id: item.key,
                        label: item.label,
                        group: 'toolbar' as const,
                        danger: item.danger,
                        waitConfirm: item.waitConfirm,
                        disabled: item.disabled,
                        disabledReason: commandDisabledReason(item, ctx),
                    })),
                    ...tableBridge.actions(),
                    ...(form ? formWriteActions() : []),
                ],
                tables: [
                    tableBridge.data({
                        unreadableReason: ctx.loading ? '部门树正在加载，稍等片刻再取数' : null,
                    }),
                ],
                form,
            };
        },
        handlers,
        events: [
            {
                id: 'action.outcome',
                label: '需要确认的命令结果',
                delivery: 'immediate',
                waitConfirmFor: ['delete'],
                mergeBy: ['actionId'],
                payload: [
                    {name: 'actionId', type: 'text', required: true},
                    {name: 'outcome', type: 'text', required: true},
                ],
                hint: '只在 agent 发起 delete 后，用户最终确认或取消时立即上报',
            },
        ],
    };
}
