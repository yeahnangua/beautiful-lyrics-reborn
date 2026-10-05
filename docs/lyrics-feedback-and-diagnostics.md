# 歌词反馈与诊断后台

## 目标与完成范围

用户在普通歌词页或全屏歌词页点击旗帜按钮，即可提交歌词准确性反馈。类型、说明、邮箱均选填；歌曲、来源、播放位置、歌词偏移、扩展版本、缓存标志、原始与显示歌词快照自动附带。维护者通过同域 `/admin` 查询反馈与请求日志，核对来源和耗时、处理反馈、记录内部备注并导出 JSON。

这是本地可验证的完整实现；生产 D1 与管理 secrets 需要在上线时配置。维护者可以按歌曲、平台和歌词类型手动屏蔽来源；用户提交反馈不会自动屏蔽来源、修改歌词或发送邮件。

## 来源与指纹

保持现有歌词 JSON 顶层结构，新增可选字段，兼容旧客户端：

```json
{
  "Type": "Syllable",
  "Source": {
    "Provider": "netease",
    "Transport": "direct",
    "TrackId": "12345",
    "MatchedTitle": "实际匹配标题"
  },
  "RequestId": "11111111-1111-1111-1111-111111111111",
  "RetrievedAt": "2026-09-30T08:00:00.000Z",
  "LyricsHash": "64 位十六进制 SHA-256",
  "Content": []
}
```

- `Provider`：`qqmusic`、`kugou`、`netease`、`musixmatch`、`applemusic`、`spotify`、`deezer`、`youtube`、`genius`、`lrclib`。
- `Transport`：`direct` 或 `lyrically`。Spotify 代理与直连接口、酷狗/网易云逐字与逐行回退都保留各自路径。
- `TrackId` 是上游歌曲 ID、hash、视频 ID 或 Genius 歌词页面路径；酷狗直连提供 `LyricsId`。没有可用字段时省略，绝不以一次新请求补猜旧歌词来源。
- `MatchedTitle` 是上游实际匹配标题，能获取时保留。
- `RequestId` 标识最初取得这份歌词的请求，缓存读取不生成新 ID。
- `RetrievedAt` 为原请求开始时间，使用 UTC ISO 8601。
- `LyricsHash` 在最终选源并解码 HTML 实体后生成，覆盖歌词 JSON 中的文字与时间轴，排除上述四个来源字段。

选源遵循逐字竞速、现场版优选、逐行回退与纯文本回退逻辑。Musixmatch 与其他来源同时请求，但其逐字歌词只作为其他逐字来源均未取得逐字结果后的回退，且最早在请求开始 5 秒后返回。其他逐字来源仍在请求时继续等待，最多等到逐字阶段原有的 15 秒预算耗尽；已取得的 Musixmatch 逐字结果在超时后仍可使用。逐行和纯文本结果不会优先于 Musixmatch 逐字。日志记录来源实际请求耗时，不包含选源等待时间。

原始和转换后缓存版本都从 8 升到 9；转换用 `structuredClone` 保留来源元数据。缓存期限仍为普通歌词 2 天、逐字歌词 30 天。复用转换缓存前校验 `RequestId` 和 `LyricsHash`，不同结果重新转换。当前原始快照保存在 `SongProviderLyrics`；`SongLyricsFromCache` 仅标识原始歌词来自本地缓存。

## 请求诊断

每次通过路由和令牌格式检查的歌词请求生成唯一 ID，记录歌曲、开始时间、总耗时、结果、最终来源和指纹。结果为 `success`、`none`、`failed` 或 `cancelled`。全部请求保存完整诊断，不抽样，也不按每日条数丢弃日志。服务端异常返回 502；无歌词仍维持原来的空 200 响应。

每个来源尝试包含：来源名称、`metadata` / `syllable` / `line` / `static` 阶段、开始时间、耗时、结果、可用歌词类型、匹配来源信息、成功与未取得歌词的匹配条目列表（`matches`）、重试次数和上游 HTTP 事件。来源结果区分 `success`、`none`、`failed`、`timeout`、`cancelled`。竞速胜出后，未完成来源会取消并记录；逐字和逐行阶段仍共享原有预算。

上游事件只保存域名与路径、HTTP 状态、耗时和结果；不保存请求/响应头、查询参数或响应体。访问令牌、Cookie、酷狗 accesskey、带凭据的完整 URL 不进入诊断存储。任意异常消息不直接保存，使用固定的错误描述。共享的 Musixmatch 匿名 token 获取任务独立于歌曲调用，不重复归属到每个等待者；歌曲 richsync 请求和重试正常记录。

Worker 用 `waitUntil()` 异步写入 D1，失败只输出固定提示，不影响歌词响应。统计页仍通过 Analytics Engine 统计原有结果。

每个请求将完整诊断（包括所有来源尝试）放在 `lyric_requests.data` 的一条 JSON 中，不再逐条写入 `provider_attempts`。旧的分表日志仍可查询、复制到反馈，不做全库重写。D1 的写入额度包括表行和索引维护；原先一次请求会写请求表及多个索引，再为每个尝试维护表行与主键索引，批量执行 SQL 并不能免除这些写入。

第三次迁移移除 `requests_track` 和 `requests_provider` 两个请求日志筛选索引，保留请求 ID 主键和 `requests_time(created_at DESC,id DESC)`。反馈关联日志和请求详情按主键读取，时间分页与过期清理仍使用时间索引。歌曲、来源筛选保持可用，但要沿时间索引筛选更多记录，大量日志下会增加读取量。反馈表写入较少，保留其查询索引；`reports_missing_diagnostics` 只索引还没有诊断副本的关联反馈，避免每次写日志都扫描所有反馈。

真实本地 D1 的 `meta.rows_written` 对照测试中，包含 10 个来源尝试且没有待回填反馈的请求，原存储产生 25 行写入（请求行及 4 个索引共 5 行，每个尝试 2 行）；新存储产生 3 行写入（完整请求行、主键索引、时间索引），减少 88%。来源尝试的数量和内容均未减少。反馈提交、诊断回填、会话、限流与过期删除的消耗另计；Cloudflare 免费计划本身的每日额度仍适用。

普通请求日志不保存完整歌词，两份完整歌词快照由用户上报时提交并保存。反馈提交会复制关联日志；如果反馈先于异步日志落库，日志写入会回填诊断。如果日志写入发生在反馈查询与插入之间，反馈事务也会补齐。没有关联日志时不重复把反馈诊断字段写成 NULL。原日志清理后，反馈仍保留诊断副本；过期或写入失败的日志可能不可用。旧的 `DIAGNOSTICS_*` 抽样和预算配置已移除，即使部署环境仍残留这些变量，新 Worker 也不会据此丢弃日志。

## 公开反馈接口

`POST /reports`，`Content-Type: application/json`，允许公开跨域请求。

```json
{
  "submissionId": "客户端为一次弹窗生成的 UUID",
  "track": { "id": "SpotifyID", "name": "歌曲", "artists": ["歌手"] },
  "category": "other",
  "description": "可选说明",
  "email": "",
  "source": { "Provider": "spotify", "Transport": "direct", "TrackId": "SpotifyID" },
  "requestId": "原始歌词请求 UUID，可省略",
  "retrievedAt": "可省略",
  "lyricsHash": "可省略",
  "playbackPosition": 10,
  "lyricsOffset": 0.2,
  "extensionVersion": "5.2.2",
  "fromCache": true,
  "original": { "Type": "Static", "Lines": [{ "Text": "歌词" }] },
  "displayed": { "Type": "Static", "Lines": [{ "Text": "歌词" }] }
}
```

- 问题类型：`lyrics`（歌词错误）、`timing`（时间不同步）、`version`（版本错配）、`display`（显示问题）、`other`（其他，默认值）。
- 邮箱最多 254 字符，非空时校验格式；说明最多 2,000 字符。
- 限制流式请求体为 1 MiB；类型错误返回 400，非 JSON 返回 415，超限返回 413。
- 每 IP 每分钟最多 5 次新提交，D1 原子计数，超限返回 429 和 `Retry-After: 60`；数据库内只保存 IP 的 SHA-256 限流键。计数达到 5 后，拒绝请求不再递增计数，避免持续重复写入；后台登录使用相同策略。
- `submissionId` 唯一约束与事务保证重试、并发提交幂等。重复已持久化提交返回同一反馈 ID，不重复占用限流次数。
- 成功保存后返回 `201 { "id": "反馈 UUID" }`，已存在时返回 200；D1 缺失或失败返回明确的 503。
- 原始和显示快照仅接收歌词字段，未知附加对象不会进入快照；歌词文字和空白按原样保存。
- 旧服务端/未知来源反馈允许缺省元数据，后台显示 `unknown` 和日志可用状态。

弹窗同步捕获歌曲和快照，因此用户输入期间切歌不会改变上报对象。提交中禁用按钮，超时或失败保留输入及提交 ID，可重试。关闭弹窗或销毁视图会取消客户端等待、清理 DOM 和监听；已到达服务端的事务可正常完成。无歌词或本地/DJ 歌曲隐藏入口，加载期间禁用。

## 管理后台

入口：`https://lyrics.txw.qzz.io/admin`。

接口：

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/admin/api/login` | POST | `{ "password": "管理密码" }` |
| `/admin/api/logout` | POST | 撤销当前会话并清 Cookie |
| `/admin/api/reports` | GET | 反馈列表 |
| `/admin/api/reports/:id` | GET | 反馈、两份快照、诊断副本及历史 |
| `/admin/api/reports/:id` | PATCH | `{ "status": "resolved", "note": "内部备注" }` |
| `/admin/api/requests` | GET | 请求列表 |
| `/admin/api/requests/:id` | GET | 请求及来源尝试 |
| `/admin/api/source-blocks` | GET | 来源屏蔽规则列表 |
| `/admin/api/source-blocks/:id` | GET | 规则及操作历史 |
| `/admin/api/source-blocks` | PUT | 幂等添加、修改或停用规则 |

列表每页 50 条，按时间和 UUID 倒序，通过响应 `nextCursor` 作为下次查询的 `cursor` 参数。查询参数：`q`（歌曲/歌手子串）、`spotifyId`、`requestId`、`source`、`from`、`to`；反馈另支持 `category`、`status`；请求日志另支持 `outcome`。时间过滤为可解析的 ISO 时间，界面将本地时间转换成 UTC。

反馈状态为 `pending`、`in_progress`、`resolved`、`ignored`。每次状态/备注保存都产生操作时间、状态和本次备注的历史记录。JSON 导出包含详情、快照及历史。界面以 `textContent` 显示用户输入和快照，不执行其中 HTML。

使用独立管理密码和 HMAC-SHA-256 签名会话。会话有效期 12 小时，Cookie 为 `__Host-lyrics_admin`，带 `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`。D1 存储有效会话 ID，退出时撤销；修改会话密钥使已有签名失效。密码比较经过固定长度 SHA-256 摘要后逐字节比较。

全部后台数据接口鉴权。登录每 IP 每分钟最多 5 次；所有非 GET 操作要求 `Origin` 与 Worker 同源。后台无通配 CORS，详情及 API 禁止缓存；页面 CSP 限制跨域连接、嵌入和对象。后台只显示登录表单时不暴露反馈数据。生产登录应使用 HTTPS。

## 按歌曲、来源和歌词类型屏蔽

规则唯一匹配 **Spotify ID + 来源平台 + 歌词类型**，覆盖该平台的直连及代理。例如 `1rutoX4kIkjtKW8OqBNYFP / qqmusic / Syllable` 只屏蔽这首歌的 QQ 逐字歌词，不影响其他歌曲或平台，也不屏蔽 QQ 的其他类型。当前 QQ 接口只提供逐字歌词，本功能不新增其逐行接口。

反馈详情的“屏蔽此来源的此类歌词”根据反馈 Spotify ID、`Source.Provider` 和原始快照 `Type` 打开预填表单，展示范围、原因及现有操作历史。来源未知时禁用快捷操作。保存规则与反馈状态相互独立；需要标记处理结果时仍单独保存反馈状态。

后台“来源屏蔽”页可手动添加规则，按 Spotify ID、来源、歌词类型及状态筛选，查看历史、修改原因或选择“恢复来源”。默认显示屏蔽中的规则，选择“已恢复”或“全部”可查看停用规则。

`PUT /admin/api/source-blocks` 请求示例：

```json
{
  "spotifyId": "1rutoX4kIkjtKW8OqBNYFP",
  "provider": "qqmusic",
  "lyricsType": "Syllable",
  "enabled": true,
  "reason": "已确认逐字时间轴不同步"
}
```

- 类型仅接受 `Syllable`、`Line`、`Static`；平台仅接受当前启用的十个平台；Spotify ID 沿用现有非空字母数字、最多 100 字符校验。原因最多 2,000 字符，可以留空。
- 可附带 `reportId`，服务端校验反馈歌曲、平台及原始歌词类型与规则一致；不存在返回 404，不一致返回 400。省略时保留现有关联，反馈清理后仍能修改规则。
- 返回 200 与规则详情，包含 `id`、匹配条件、`enabled`、原因、关联反馈、创建／更新时间和 `history`。相同 PUT 重试或并发不会新增重复规则、重复历史或刷新更新时间；实际更改与历史写入处于同一 D1 事务。
- `enabled: false` 恢复来源；规则及历史保留。规则不随反馈过期删除。仅持有反馈 UUID 不授予管理权限。
- 列表每页 50 条，按创建时间及 UUID 倒序，支持 `spotifyId`、`source`、`lyricsType`、`enabled=true/false` 和返回的 `nextCursor`。

每次新歌词请求在选源前按歌曲查询启用规则。只返回逐字的直连接口可以直接跳过；返回多种类型的接口仍执行，并按结果实际的 `Source.Provider` 与 `Type` 过滤。过滤发生在竞速和回退缓存之前；Spotify 元数据请求继续执行。未屏蔽的候选沿用原有逐字、现场版、逐行、纯文本及 Musixmatch 延迟策略。没有可用候选时仍为空 200。

请求诊断新增 `sourceBlocks` 和 `sourcePolicyStatus`（`applied`、`unavailable`、`unconfigured`）。来源尝试被屏蔽时记为 `outcome: blocked`，用 `blockAction: skipped/filtered` 区分未请求和结果被过滤；过滤结果保留来源及歌词类型，但不进入候选池。

公开只读 `GET /lyrics-policy/:spotifyId` 返回：

```json
{ "blocks": [{ "provider": "qqmusic", "lyricsType": "Syllable" }] }
```

接口允许跨域，无需 Spotify token，禁止缓存，只公开启用的匹配条件，不公开原因、关联反馈或操作历史。数据库读取失败返回固定 503；未配置数据库时返回空列表。新歌词请求在数据库未配置或读取失败时沿用原选源逻辑，失败记录固定日志提示及诊断状态，优先保持歌词可用。

扩展准备复用歌曲歌词缓存时查询规则，包含读取响应体在内最多等 2 秒，并随切歌取消。命中规则时只删除该歌曲的原始及转换缓存，然后重新获取歌词；缺少来源且存在规则也重新获取。其他缓存继续复用；规则超时、网络失败、旧服务端返回 404 或响应无效时继续使用缓存。新歌词直接由 Worker 过滤，不重复查询规则。缓存版本仍为 9，期限保持逐字 30 天、其他 2 天，偏移量设置不受影响。

规则在用户下一次加载歌曲时检查，不推送替换正在显示的歌词。撤销后继续使用已有歌词缓存，等正常过期后重新选源。旧扩展的新请求同样受 Worker 规则约束，但旧扩展不会主动检查已有缓存。

## 数据库与保留期

迁移：`Server/migrations/0001_feedback.sql`、`0002_diagnostic_budget.sql`、`0003_request_indexes.sql` 和 `0004_source_blocks.sql`。先应用全部未执行的迁移，再发布新版 Worker；部署脚本会按这个顺序执行。保留已经提交的历史迁移，第三次迁移仅移除两个请求日志索引，第四次新增屏蔽规则及历史，不删除诊断数据。

- `lyric_requests`：请求完整诊断与检索字段，新日志内嵌来源尝试。
- `provider_attempts`：旧版来源尝试，保持兼容读取；新日志不写此表。
- `diagnostic_daily_budget`：第二次迁移留下的预算表，当前版本不再读写，也不用于限制日志量。
- `lyric_reports`：反馈元数据、诊断副本、当前状态。
- `report_snapshots`：两份歌词快照，随反馈级联删除。
- `report_history`：状态和备注历史，随反馈级联删除。
- `rate_limits`：短期原子限流记录。
- `admin_sessions`：可撤销会话 ID 与到期时间。
- `source_blocks`：按歌曲、平台和歌词类型唯一的规则，包含停用记录和原因。
- `source_block_history`：规则实际变更历史，不随反馈和日志过期清理。

每日 UTC 19:15（北京时间次日 03:15）清理 60 天前的请求和 365 天前的反馈，同时清理失效会话和旧限流计数。每次最多删除 1,000 条旧来源尝试，再删除至多 1,000 条已无分表尝试的过期请求，避免旧日志级联删除放大写入。反馈最多删除 100 条（及其关联快照和历史），限流记录最多 1,000 条，会话最多 100 条。大量积压可能延迟清理；反复手动触发会继续消耗额度。旧代码每次最多删除 10,000 条请求及全部尝试，迁移后不再使用该清理规模。清理失败提示不会影响普通歌词请求。

## 本地验证

```sh
cd Server
npm ci
npm test
npm run typecheck
npx wrangler d1 migrations apply FEEDBACK_DB --local
npx wrangler dev --local --port 8787 \
  --var ADMIN_PASSWORD:local-feedback-test \
  --var ADMIN_SESSION_SECRET:local-only-session-signing-key-for-feedback-tests
```

`wrangler.toml` 的全零 D1 UUID 仅用于本地开发和 dry-run。通过 `http://localhost:8787/admin` 登录测试。生产 Secret 不应写在 CLI 参数或提交到 Git；本地私有配置可以放在已忽略的 `Server/.dev.vars`。需要手动测试清理时按 Wrangler 启动提示访问 `http://localhost:8787/cdn-cgi/handler/scheduled`。

```sh
cd Extension
deno check Source/main.ts Spices/Build/Bundle.ts
node --test Tests/*.test.mjs
deno task release
cd ../Server
npx wrangler deploy --dry-run
```

集成测试用 Miniflare 的真实本地 D1 执行全部迁移及事务；覆盖空选填、输入约束、并发幂等、限流拒绝后不递增、两种日志晚到竞态（新旧存储格式）、分页筛选、处理历史、鉴权、同源校验、退出、过期、清理及存储失败。新增验证并发请求全量保存完整诊断、旧抽样配置不生效、反馈完整关联诊断、来源尝试存入单行、旧日志兼容、有界清理，以及实际写入行数从 25 降到 3。`EXPLAIN QUERY PLAN` 验证详情查询和时间分页仍使用索引。来源测试覆盖所有启用平台及直连/代理路径；请求测试覆盖脱敏、HTTP 状态、重试、超时和取消。扩展测试验证转换保留来源、快照固定对象、缓存请求 ID 错配重新转换及切歌后不发布旧结果。

屏蔽测试另外覆盖跨路径一致性、实际类型与阶段不同、逐行／纯文本回退、全部候选被屏蔽、Musixmatch 延迟、Spotify 元数据保留、规则查询故障降级、规则并发幂等、筛选分页、鉴权、关联反馈匹配与清理后规则保留；扩展覆盖缓存命中／未命中／来源未知、撤销后保留缓存、网络与响应失败、2 秒体读取超时和切歌取消。

浏览器本地验证使用实际弹窗模块、模拟播放器状态和本地 Worker：桌面与 390px 窄屏下验证输入、失败重试、成功回执、切歌对象固定，后台验证登录、筛选、详情、状态备注、快照文本显示和退出。模拟播放器验证不能替代生产 Spotify 环境的最终安装验收。

## 上线顺序

1. 创建数据库：`cd Server && npx wrangler d1 create beautiful-lyrics-feedback`。保存返回 UUID。
2. 在 `wrangler.toml` 填入真实 UUID，或配置 CI secret `FEEDBACK_DATABASE_ID`。数据库 ID 不是密码；不要填零 UUID 到生产。
3. 用 `npx wrangler secret put ADMIN_PASSWORD` 设置独立管理密码，用 `npx wrangler secret put ADMIN_SESSION_SECRET` 设置至少 32 字符的随机签名密钥（可用 `openssl rand -hex 32` 生成）。
4. 执行 `node Tasks/Deploy.mjs`。脚本校验 UUID，在同目录生成临时配置，先执行远程 D1 迁移再部署 Worker；迁移失败即停止发布，最后删除临时文件。
5. 验证新 Worker 的 `/admin` 登录、测试反馈及查询、来源元数据和请求诊断；在“来源屏蔽”页添加测试规则，确认对应 `/lyrics-policy/:spotifyId` 只返回启用条件，并验证恢复来源。旧扩展仍兼容新 Worker。未配置 D1 时歌词继续工作，上报会明确失败。
6. 发布新扩展。现有 GitHub Actions 已将迁移接入发布步骤，使用 `FEEDBACK_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；令牌需具备 Worker 发布和 D1 管理权限。D1 迁移与 Worker 配置应先准备完成，再更新扩展发布指针。若要求严格分开发行，可先单独部署 Worker，再运行扩展发布流水线。
7. 安装后测试普通和全屏入口，填写过程中切歌、未填写邮箱、缓存读取上报，后台确认歌曲/指纹/来源/关联日志一致。
8. 验证“已缓存该平台逐字歌词 → 后台屏蔽 → 下一次加载该歌曲改用允许的来源”的完整链路；恢复规则后现有缓存保留到期。不要求老扩展主动失效缓存。

仓库提交不会自动修改生产；本次实施只交付本地实现、验证和 Git 提交。生产部署沿用维护者配置后的流程。

## 回滚

优先用 Cloudflare Worker 版本回滚恢复旧服务，并恢复上一份扩展 `latest.json` 和其不可变构建文件；旧客户端忽略新增来源字段，旧 Worker 下新客户端仍可显示歌词，但反馈接口不可用时会显示失败。

迁移新增表、索引，并移除两个请求日志筛选索引，无需在代码回滚时删除数据库。保留反馈和诊断数据以便排查；不要通过删除 D1 或反向清空表来回滚。原管理后台版本能继续读取摘要字段，但不理解新日志内嵌的来源尝试，回滚后这部分详情可能缺失，重新部署新版即可恢复；也会重新开启全量分表写入，应注意额度。回滚到抽样版本会再次启用抽样和预算限制，应优先使用当前全量合并存储版本。若要撤销管理登录，轮换 `ADMIN_SESSION_SECRET` 或删除对应 secrets。缓存版本升级不会改动歌词偏移量或其他用户设置；重新发布后旧歌词缓存不会被拼接进新响应。

屏蔽规则回滚优先在后台停用对应规则。代码回滚到不支持规则的 Worker 后不再执行屏蔽，新增表与历史仍保留；新扩展遇到旧 Worker 的规则接口 404 时继续使用缓存。不可变 `.mjs` 发布包通过 `.gitattributes` 禁止换行转换，保持跨平台检出后的字节与发布哈希一致。

参考：[Cloudflare D1 Worker API（事务批量操作）](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[D1 本地开发](https://developers.cloudflare.com/d1/best-practices/local-development/)。
