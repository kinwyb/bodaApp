/**
 * lottie-web 的空替身。
 *
 * 它只经 @visactor/vrender-kits 的 barrel 进入模块图：`Lottie` 图形在
 * vtable 里从未被注册使用，打包时整块会被 tree-shake 掉，但 rolldown 在
 * 解析阶段仍要 transform 那份 1MB 的源码，于是每次构建都报一条
 * 「direct eval」警告（lottie 的 After Effects 表达式引擎）。
 *
 * 用 vite alias 把它指到这里：模块图里不再有 lottie，警告消失，构建也快一点。
 * 本项目不使用 Lottie 图形，因此不需要真实的 lottie-web。
 */
export default {};
