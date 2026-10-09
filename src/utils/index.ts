/**
 * 通用工具出口。
 *
 * 这里只放**与业务无关**的纯函数（数值 / 日期等）。分层判断：
 * - 依赖后端返回结构、要发请求的 → `src/api`
 * - 依赖具体业务模型、领域规则的 → `src/services`
 * - 换个项目也能原样用的 → 就是这里
 *
 * 用法：`import { toNumberOrZero, toDayjs } from '@/utils';`
 */
export * from './date';
export * from './number';
