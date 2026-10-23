# API Schema 自动生成（OpenAPI → zod）

后端 Swagger 2.0 规范：**`http://boda.bj.company/apidocs.json`**（内网地址）。

规范里共 **904 paths / 680 definitions / 944 operations**，`basePath` 是 `/v1/boda`
（与 `.env` 的 `VITE_API_BASE_URL` 一致）。项目实际用到的接口全都在里面。

> ⚠️ 别用 `http://192.168.9.9:82/swagger/v1/swagger.json` 或 `/openapi.json` ——
> 那些地址返回 **200，但内容是 React SPA 的 `index.html`**（前端路由兜底），不是规范。
> 判断是不是真规范要看内容，别只看状态码。

## 一、按 API 路径生成（推荐）

```bash
# 单接口
npm run gen:api -- --path /nc/bom/packBomMatrix --out src/api/schemas/nc/packBomMatrix.ts

# 多接口写一个文件
npm run gen:api -- --path /login/userInfo --path /power/desktopMenu --out src/api/schemas/common.ts

# 直接点名 definition（不需要路径时）
npm run gen:api -- --def ncBean.PackBomMatrix --out src/api/schemas/x.ts

# 只取某个方法（同一路径有多个方法时）
npm run gen:api -- --path /login --method post --out src/api/schemas/login.ts

# 用本地规范文件（内网连不上 / 想锁版本时）
npm run gen:api -- --spec ./apidocs.json --path /nc/bom/packBomMatrix --out ...
```

**`--path` 会自动做的事**：

1. 从 `responses.200.schema` 拿到响应根类型（是数组就取 `items`）；
2. 递归收集它引用到的所有 `$ref`，形成 **依赖闭包**（不用手工列）；
3. 只生成这个闭包，不会把 680 个 definition 全铺出来。

例：`--path /nc/bom/packBomMatrix` → 根是 `ncBean.PackBomMatrix`，
自动带出 `BomMatrixDetail`、`PackBomMatrix.ColorMatch`、`PackBomMatrix.SizeMatch`，
共 4 个 schema。

## 二、生成的代码长什么样

```ts
// 全部字段 nullish、对象 loose
export const PackBomMatrixSchema = z.object({
    PackBomMatrixID: z.string().nullish(),          // 包装bom矩阵ID
    Detail: z.array(z.lazy(() => PackBomMatrixDetailSchema)).nullish(), // 包装物料明细
    ColorMatch: z.record(z.string(), z.lazy(() => PackBomMatrixColorMatchSchema)).nullish(),
}).loose();
export type PackBomMatrix = z.output<typeof PackBomMatrixSchema>;
```

`Xxx` 类型由 `z.output` 推出， **不用手写 interface**。

### 命名规则：去掉包名前缀

| definition                        | 生成的标识符          |
|-----------------------------------|-----------------------|
| `ncBean.PackBomMatrix`            | `BomMatrix`           |
| `ncBean.PackBomMatrixDetail`      | `BomMatrixDetail`     |
| `ncBean.PackBomMatrix.ColorMatch` | `BomMatrixColorMatch` |
| `planBean.YupaiOrder`             | `YupaiOrder`          |

去掉第一段包名（`ncBean` / `planBean` / `configBean` / `loginBean` …）。

⚠️ **内层类保留父名**：`ncBean.PackBomMatrix.ColorMatch` 生成 `BomMatrixColorMatch`
而不是 `ColorMatch` —— `ColorMatch` / `SizeMatch` 这种名字太通用，
一旦同一文件里出现两个类的同名内层类型就会互相顶掉。

⚠️ **生成器会做撞名检查**：去掉包名后如果两个 definition 算出同一个标识符，直接报错退出
（退出码 1，不写文件）。实测全规范里有 **10 组**会撞：
`configBean.Employee` vs `misBean.Employee`、`configBean.DepartmentTree` vs
`ncBean.DepartmentTree`、`configBean.StyleInfo` vs `plmBean.StyleInfo` …
遇到时 **分批生成到不同文件**，或只生成其中一个。

## 三、为什么全字段 `nullish` + `loose`（不是偷懒）

**Swagger 2.0 完全不标 nullable**（全规范 0/7490 个属性有 nullable 标记），
但后端实际会返回 `null`、缺字段、多余字段：

- `YupaiOrder.Batchs` 实测 276/279 行是 `null`；
- `UserInfo.RoleIDs` / `RoleDepartmentNos` 是 `null`；
- 菜单树 `Children` 是 `null`（叶子节点）。

直译（不加 nullish）的后果实测过：`Employee` 上报 **56151 处**错误、菜单树 153/402 处。
所以这是 **没有选择**，不是保守。

代价要知道： **校验能抓类型错，抓不住「字段消失」和「新增字段」**。
后者靠 `loose()` 放行（后端加字段不该白屏），前者需要 TS 层的 interface 来保证。

## 四、目录约定

```
scripts/gen-api-schemas.mjs          # 生成器
src/api/schemas/
  nc/packBomMatrix.ts                # 按接口分文件，与 modules/ 同构
  common.ts                          # 多个接口共用（可选）
src/api/modules/nc/bomMatrix.ts      # 请求封装，引用上面的 schema
```

**生成物要入库**（规范在内网，构建期拉不到）。改 schema 时重跑生成命令、提交产物。
每个生成文件头部有 `⚠️ 自动生成，请勿手改` 和生成时间，diff 时能看出是重新生成的。

## 五、在请求里怎么用

`request.ts` **没有**内置 schema 参数（保持现有代码不动），校验在 api module 里做：

```ts
detail: async (id: string): Promise<ApiResponse<PackBomMatrix>> => {
    const res = await http.get<unknown>('/nc/bom/packBomMatrix', {packBomMatrixID: id});
    if (res.data == null) return {...res, data: undefined};
    return {...res, data: PackBomMatrixSchema.parse(res.data)};
},
```

**失败策略：结构不符直接抛**（zod 的 `ZodError`，`error.issues` 带精确到字段的 path）。

不搞「告警放行 + 严格」两个版本 —— 拿到结构不对的数据继续往下用，
比当场报错危险得多（下游可能 `.map()` 空数组、算错金额而不自知）。
`null` / 缺字段 / 多字段本来就是 schema 允许的（`nullish` + `loose`）， **不会**触发抛错；只有真正的类型漂移才抛。

## 六、生成器的 6 个坑（改的时候别踩回去）

| # | 坑                                                                        | 正确做法                                                                                                                                       |
|---|---------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | definition 常**没有 `type` 字段**（有 properties 却省略 `type:'object'`） | `node.type ?? (node.properties ? 'object' : undefined)`。漏了会全部落到 `z.unknown()` → **校验看着全过，实际什么都没校验**（假阳性，最难发现） |
| 2 | `$ref` 指向 type 而非常量                                                 | `z.lazy(() => XxxSchema)`，不能写 `Xxx`                                                                                                        |
| 3 | 顶层 schema 加 `.nullish()`                                               | 不要加。响应主体不会是 null，加了会让 `data` 多出 null                                                                                         |
| 4 | 递归自引用（菜单树 `Children`）                                           | 类型用 `interface`（`type X = {children: X[]}` 报 TS2456）；schema 用 `as unknown as z.ZodType<X>` 打断循环推断（否则 TS7022）                 |
| 5 | `additionalProperties`（字典，如 `ColorMatch`）                           | 生成 `z.record(z.string(), <value>)`；它指向的定义可能是空 `{}`（= 任意值）                                                                    |
| 6 | 头注释里 Markdown 风格的行                                                | 生成的是 `.ts`，每行都要 `//` 前缀，否则语法错误                                                                                               |

**验证生成器有没有效，必须反测**：故意把一个字段改成错误的类型，
schema 必须拦下来。只跑「真实数据全过」是不够的 —— 第 1 条坑就是靠这个发现的。

## 七、已知盲区

- **字段名以规范为准**：`ColorMatch` / `SizeMatch` 在规范里是
  `additionalProperties: {$ref: <空定义>}`，只能生成 `Record<string, unknown>`，
  拿不到更细的结构。要用里面的值得自己断言。
- **提交（save）方向的 schema** 目前没生成。出参 schema 只能校验响应，
  入参得单独按请求体定义生成（`--path /xxx --method post` 目前取的是 200 响应，
  请求体 schema 还没支持）。
