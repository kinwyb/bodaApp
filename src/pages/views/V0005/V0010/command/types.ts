import type {Department} from '@/api/schemas/config/department';
import type {CommandBaseContext, CommandFactory} from '@/components/commands';

/** 保存结果：界面用它弹提示，界面桥用它决定回执是成功还是失败 */
export type DepartmentSaveResult = {ok: boolean; message: string};

/** 本页命令的业务依赖 */
export interface DepartmentCommandDeps {
    /** 当前选中的树节点（含虚拟根「所有部门」）；没选中为 null */
    activeNode: Department | null;
    /** 选中的是不是虚拟根：它不是真实部门，不能删除 */
    isRootSelected: boolean;
    /** 三个按钮的可用态，与旧客户端 newBtn / saveBtn / delBtn 的 Enabled 一一对应 */
    canAdd: boolean;
    canSave: boolean;
    canDelete: boolean;
    /** 进入新增态：在选中节点下建一个子部门草稿（编码自动生成） */
    startAdd: () => void;
    /** 保存右侧表单（新增或修改） */
    save: () => Promise<DepartmentSaveResult>;
    /** 重新取部门树 */
    reload: () => Promise<void>;
}

/**
 * 本页命令上下文。
 *
 * 左侧是部门树、右侧是表单，**整页没有 GridTable**，所以不继承 `CommandBaseContext` 里的
 * `tableRef`（那是给表格页用的框架能力，这里塞一个永远为 null 的 ref 只会误导后来的命令）。
 */
export type DepartmentCommandContext = Omit<CommandBaseContext, 'tableRef'> & DepartmentCommandDeps;

export type DepartmentCommandFactory = CommandFactory<DepartmentCommandContext>;
