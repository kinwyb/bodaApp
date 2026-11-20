#!/usr/bin/env node
/**
 * 从旧客户端迁移菜单翻译。
 *
 * 数据优先级：
 * 1. BodaLanguage/Message.<locale>.resx：内置基础翻译
 * 2. bin/Debug/<locale>/Tr.resx：运行时下载后落盘的覆盖翻译
 * 3. MANUAL_MENU_TRANSLATIONS：新系统新增、旧资源没有的词条
 *
 * 只生成当前桌面菜单树里存在的 MenuName，避免把旧菜单的全部历史词条带进新项目。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOCALES = ['en-US', 'vi-VN'];
const LEGACY_BODA_ROOT =
  process.env.LEGACY_BODA_ROOT ?? path.join(os.homedir(), 'Downloads/Boda');
const LEGACY_LANGUAGE_ROOT =
  process.env.LEGACY_LANGUAGE_ROOT ?? path.join(os.homedir(), 'Downloads/BodaLanguage');

const SUPPLEMENTAL_MENU_TRANSLATIONS = {
  'en-US': {
    报价单: 'Quotation',
    报价单管理: 'Quotation management',
    基础设置: 'Basic settings',
    预订单明细: 'Advance order details',
    订单节点: 'Order milestones',
    订单补单节点: 'Replenishment milestones',
    订单节点总览: 'Order milestone overview',
    染厂计划: 'Dyeing plan',
    发染缸型负荷: 'Dye vat load',
    染缸排产: 'Dye vat scheduling',
    染缸生产状态: 'Dye vat production status',
    生产量: 'Production quantity',
    库存量: 'Inventory quantity',
    品质: 'Quality',
    订单发染备注: 'Order dyeing remarks',
    前置工序: 'Preceding process',
    预订单管理: 'Advance order management',
    预订单变更明细: 'Advance order change details',
    预排汇总: 'Pre-schedule summary',
    预排取消列表: 'Pre-schedule cancellation list',
    已下单列表: 'Ordered list',
    已下单分批: 'Ordered batching',
    月份汇总: 'Monthly summary',
    全订单汇总: 'All order summary',
    发染同步天富: 'Dyeing sync to Tianfu',
    项目生产进度: 'Project production progress',
    染厂大屏: 'Dyeing dashboard',
    近期订单: 'Recent orders',
    周生产数据: 'Weekly production data',
    月生产数据: 'Monthly production data',
    织造机型周数据: 'Machine model weekly data',
    '包装合同(特征码)': 'Packaging contract (feature code)',
    包装BOM矩阵: 'Packaging BOM matrix',
    包装工艺矩阵: 'Packaging process matrix',
    装箱单: 'Packing list',
    BOM矩阵: 'BOM matrix',
    采购合同: 'Purchase contract',
    挡车产量: 'Machine operator output',
    '挡车效率(越南)': 'Machine operator efficiency (Vietnam)',
    '机修工效率(越南)': 'Mechanic efficiency (Vietnam)',
    '白坯出库单(越南)': 'Greige outbound order (Vietnam)',
    '绩效统计(越南)': 'Performance statistics (Vietnam)',
    '机修绩效统计(越南)': 'Mechanic performance statistics (Vietnam)',
    销售合同: 'Sales contract',
    '产能负荷(一级计划)': 'Capacity load (level 1 plan)',
    织造: 'Weaving',
    '织造(委外)': 'Weaving (outsourced)',
    缝制: 'Sewing',
    二级计划: 'Level 2 plan',
    '织造负荷-越南': 'Weaving load - Vietnam',
    订单计划节点: 'Order planning milestones',
    '订单计划节点(分批)': 'Order planning milestones (batched)',
    产能设置: 'Capacity settings',
    日历: 'Calendar',
    '产能负荷(不累计)': 'Capacity load (non-cumulative)',
    订单节点达成: 'Order milestone achievement',
    '生产计划(四级计划)': 'Production plan (level 4 plan)',
    '织造(自动)_测试': 'Weaving (automatic)_test',
    织造四级计划: 'Weaving level 4 plan',
    缝制四级计划: 'Sewing level 4 plan',
    计划达成统计: 'Plan achievement statistics',
    订单分批: 'Order batching',
    服务端日志: 'Server logs',
    文本翻译: 'Text translation',
    数据模型: 'Data models',
    模型列表: 'Model list',
    审批流: 'Approval flow',
    审批用户组: 'Approval user groups',
    岗位: 'Positions',
    NC日历: 'NC calendar',
    销售治理: 'Sales governance',
    销售分析: 'Sales analysis',
    生产治理: 'Production governance',
    生产分析: 'Production analysis',
    订单MU分析: 'Order MU analysis',
    经营治理: 'Operations governance',
    供应链分析: 'Supply chain analysis',
    '营销(含销管)分析': 'Marketing (incl. sales management) analysis',
    研发分析: 'R&D analysis',
    财务分析: 'Financial analysis',
    生产基地分析: 'Production base analysis',
    战略中心分析: 'Strategic center analysis',
  },
  'vi-VN': {
    报价单: 'Báo giá',
    报价单管理: 'Quản lý báo giá',
    基础设置: 'Cài đặt cơ bản',
    预订单明细: 'Chi tiết đơn hàng dự kiến',
    订单节点: 'Mốc đơn hàng',
    订单补单节点: 'Mốc bổ sung đơn hàng',
    订单节点总览: 'Tổng quan mốc đơn hàng',
    染厂计划: 'Kế hoạch xưởng nhuộm',
    发染缸型负荷: 'Tải thùng nhuộm',
    染缸排产: 'Sắp xếp thùng nhuộm',
    染缸生产状态: 'Trạng thái sản xuất thùng nhuộm',
    生产量: 'Sản lượng',
    库存量: 'Tồn kho',
    品质: 'Chất lượng',
    订单发染备注: 'Ghi chú nhuộm đơn hàng',
    前置工序: 'Công đoạn trước',
    预订单管理: 'Quản lý đơn hàng dự kiến',
    预订单变更明细: 'Chi tiết thay đổi đơn hàng dự kiến',
    预排汇总: 'Tổng hợp lịch dự kiến',
    预排取消列表: 'Danh sách hủy lịch dự kiến',
    已下单列表: 'Danh sách đã đặt hàng',
    已下单分批: 'Phân lô đã đặt hàng',
    月份汇总: 'Tổng hợp theo tháng',
    全订单汇总: 'Tổng hợp toàn bộ đơn hàng',
    发染同步天富: 'Đồng bộ nhuộm Thiên Phú',
    项目生产进度: 'Tiến độ sản xuất dự án',
    染厂大屏: 'Màn hình xưởng nhuộm',
    近期订单: 'Đơn hàng gần đây',
    周生产数据: 'Dữ liệu sản xuất theo tuần',
    月生产数据: 'Dữ liệu sản xuất theo tháng',
    织造机型周数据: 'Dữ liệu tuần theo loại máy',
    '包装合同(特征码)': 'Hợp đồng đóng gói (mã đặc trưng)',
    包装BOM矩阵: 'Ma trận BOM đóng gói',
    包装工艺矩阵: 'Ma trận quy trình đóng gói',
    装箱单: 'Phiếu đóng gói',
    BOM矩阵: 'Ma trận BOM',
    采购合同: 'Hợp đồng mua hàng',
    挡车产量: 'Sản lượng vận hành máy',
    '挡车效率(越南)': 'Hiệu suất vận hành máy (Việt Nam)',
    '机修工效率(越南)': 'Hiệu suất thợ sửa máy (Việt Nam)',
    '白坯出库单(越南)': 'Phiếu xuất kho mộc (Việt Nam)',
    '绩效统计(越南)': 'Thống kê hiệu suất (Việt Nam)',
    '机修绩效统计(越南)': 'Thống kê hiệu suất thợ sửa máy (Việt Nam)',
    销售合同: 'Hợp đồng bán hàng',
    '产能负荷(一级计划)': 'Tải năng lực (kế hoạch cấp 1)',
    织造: 'Dệt',
    '织造(委外)': 'Dệt (thuê ngoài)',
    缝制: 'May',
    二级计划: 'Kế hoạch cấp 2',
    '织造负荷-越南': 'Tải dệt - Việt Nam',
    订单计划节点: 'Mốc kế hoạch đơn hàng',
    '订单计划节点(分批)': 'Mốc kế hoạch đơn hàng (phân lô)',
    产能设置: 'Cài đặt năng lực',
    日历: 'Lịch',
    '产能负荷(不累计)': 'Tải năng lực (không cộng dồn)',
    订单节点达成: 'Hoàn thành mốc đơn hàng',
    '生产计划(四级计划)': 'Kế hoạch sản xuất (kế hoạch cấp 4)',
    '织造(自动)_测试': 'Dệt (tự động)_thử nghiệm',
    织造四级计划: 'Kế hoạch dệt cấp 4',
    缝制四级计划: 'Kế hoạch may cấp 4',
    计划达成统计: 'Thống kê hoàn thành kế hoạch',
    订单分批: 'Phân lô đơn hàng',
    服务端日志: 'Nhật ký máy chủ',
    文本翻译: 'Dịch văn bản',
    数据模型: 'Mô hình dữ liệu',
    模型列表: 'Danh sách mô hình',
    审批流: 'Luồng phê duyệt',
    审批用户组: 'Nhóm người dùng phê duyệt',
    岗位: 'Vị trí',
    NC日历: 'Lịch NC',
    销售治理: 'Quản trị bán hàng',
    销售分析: 'Phân tích bán hàng',
    生产治理: 'Quản trị sản xuất',
    生产分析: 'Phân tích sản xuất',
    订单MU分析: 'Phân tích MU đơn hàng',
    经营治理: 'Quản trị vận hành',
    供应链分析: 'Phân tích chuỗi cung ứng',
    '营销(含销管)分析': 'Phân tích tiếp thị (gồm quản lý bán hàng)',
    研发分析: 'Phân tích R&D',
    财务分析: 'Phân tích tài chính',
    生产基地分析: 'Phân tích cơ sở sản xuất',
    战略中心分析: 'Phân tích trung tâm chiến lược',
  },
};

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readResx(file) {
  if (!fs.existsSync(file)) return {};
  const xml = fs.readFileSync(file, 'utf8');
  const result = {};
  const dataRe = /<data\s+([^>]*?)>([\s\S]*?)<\/data>/g;
  for (const match of xml.matchAll(dataRe)) {
    const name = match[1].match(/\bname="([^"]+)"/)?.[1];
    const value = match[2].match(/<value>([\s\S]*?)<\/value>/)?.[1];
    if (name && value !== undefined) result[decodeXml(name)] = decodeXml(value).trim();
  }
  return result;
}

function currentMenuNames() {
  const file = path.join(ROOT, 'src/api/mock/data/power/desktopMenu.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const roots = Array.isArray(parsed) ? parsed : parsed.data ?? [];
  const names = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (!node.IsAction && node.MenuName) names.push(node.MenuName.trim());
      walk(node.Children ?? []);
    }
  };
  walk(roots);
  return [...new Set(names)];
}

function translationsOf(locale) {
  return {
    ...readResx(path.join(LEGACY_LANGUAGE_ROOT, `Message.${locale}.resx`)),
    ...readResx(path.join(LEGACY_BODA_ROOT, `bin/Debug/${locale}/Tr.resx`)),
    ...SUPPLEMENTAL_MENU_TRANSLATIONS[locale],
  };
}

function writeMenu(locale, names, translations) {
  const entries = names
    .map((name) => [name, translations[name]?.trim()])
    .filter(([, value]) => value && value !== '');
  const body = entries
    .map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)},`)
    .join('\n');
  const output = [
    '/**',
    ' * 菜单翻译：按后端 DesktopMenu.MenuName 查找。',
    ' *',
    ' * 由 scripts/import-legacy-menu-i18n.mjs 从旧客户端 Message.*.resx、',
    ' * 运行时 Tr.resx 以及新菜单补充词条生成。缺失项继续回退中文。',
    ' */',
    "import type { LocaleMessages } from '../../types';",
    '',
    'export default {',
    body,
    '} satisfies LocaleMessages;',
    '',
  ].join('\n');
  const file = path.join(ROOT, `src/i18n/locales/${locale}/menu.ts`);
  fs.writeFileSync(file, output);
  return { file, translated: entries.length, missing: names.length - entries.length };
}

const names = currentMenuNames();
for (const locale of LOCALES) {
  const result = writeMenu(locale, names, translationsOf(locale));
  console.log(
    `[menu-i18n] ${locale}: translated=${result.translated} missing=${result.missing} ${path.relative(ROOT, result.file)}`,
  );
}
