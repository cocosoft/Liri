// app/scripts 的类型环境声明（D-137 收网批次，2026-09-30）
//
// 需求：这些脚本使用 Bun 专有 API（实测仅 bun:sqlite），而 bun-types 不是 @types/* 包
// ⇒ 不会被 TS 的 @types 自动加载机制引入。
//
// ⚠️ 为什么只引用 bun-types/sqlite，而**不是**整个 bun-types：
// ① bun-types 主入口会给程序注入大量全局声明，与项目既有的 @types/node + DOM 冲突 ——
//    实测（include src+tests+scripts + 主入口）⇒ 41 错，特征为
//      · process.on('SIGINT') 不匹配 "memoryPressure"
//      · fetch 缺 preconnect
//      · Mock<…> 转 typeof fetch "may be a mistake"
// ② bun-types/sqlite.d.ts 是**自足**文件（纯 declare module "bun:sqlite"），无全局副作用
// ⇒ 只取所需（同 src/tools/CodeRunner/staticValidation.ts 的"最小接口、避免类型依赖"约定）。
//
// ⚠️ 为什么用 triple-slash 引用而非 compilerOptions.types：types 是【替代】语义，
// 显式指定后 TS 不再自动加载 @types 包 ⇒ 脚本传递依赖的 src 文件会因 adm-zip / nodemailer
// / imapflow 等声明丢失而报错（实测 36 错，30+ 来自 src/packages）；引用是【附加】语义。
//
// ⚠️ 本文件必须用 `//` 行注释：块注释里若出现 glob 通配（双星斜杠相邻）会提前闭合注释。
//
// 生效范围：仅 app/tsconfig.scripts.json 的程序；主 tsconfig.json 的 src / tests 程序不受影响。
/// <reference types="bun-types/sqlite" />
