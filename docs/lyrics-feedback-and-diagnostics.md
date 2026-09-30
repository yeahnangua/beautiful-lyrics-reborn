# 歌词反馈与诊断后台

## 目标与完成范围

用户在普通歌词页或全屏歌词页点击旗帜按钮，即可提交歌词准确性反馈。类型、说明、邮箱均选填；歌曲、来源、播放位置、歌词偏移、扩展版本、缓存标志、原始与显示歌词快照自动附带。维护者通过同域 `/admin` 查询反馈与请求日志，核对来源和耗时、处理反馈、记录内部备注并导出 JSON。

这是本地可验证的完整实现；生产 D1 与管理 secrets 需要在上线时配置。不会自动修改歌词、屏蔽来源或发送邮件。

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

每次通过路由和令牌格式检查的歌词请求生成唯一 ID，记录歌曲、开始时间、总耗时、结果、最终来源和指纹。结果为 `success`、`none`、`failed` 或 `cancelled`。服务端异常返回 502，并保留诊断；无歌词仍维持原来的空 200 响应。

每个来源尝试包含：来源名称、`metadata` / `syllable` / `line` / `static` 阶段、开始时间、耗时、结果、可用歌词类型、匹配来源信息、成功与未取得歌词的匹配条目列表（`matches`）、重试次数和上游 HTTP 事件。来源结果区分 `success`、`none`、`failed`、`timeout`、`cancelled`。竞速胜出后，未完成来源会取消并记录；逐字和逐行阶段仍共享原有预算。

上游事件只保存域名与路径、HTTP 状态、耗时和结果；不保存请求/响应头、查询参数或响应体。访问令牌、Cookie、酷狗 accesskey、带凭据的完整 URL 不进入诊断存储。任意异常消息不直接保存，使用固定的错误描述。共享的 Musixmatch 匿名 token 获取任务独立于歌曲调用，不重复归属到每个等待者；歌曲 richsync 请求和重试正常记录。

Worker 用 `waitUntil()` 异步写入 D1，失败只输出固定提示，不影响歌词响应。普通请求日志不保存完整歌词。反馈提交会复制关联日志；如果反馈先于异步日志落库，日志写入会回填诊断。如果日志写入发生在反馈查询与插入之间，反馈事务也会补齐。原日志清理后，反馈仍保留诊断副本。

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
- 每 IP 每分钟最多 5 次新提交，D1 原子计数，超限返回 429 和 `Retry-After: 60`；数据库内只保存 IP 的 SHA-256 限流键。
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

列表每页 50 条，按时间和 UUID 倒序，通过响应 `nextCursor` 作为下次查询的 `cursor` 参数。查询参数：`q`（歌曲/歌手子串）、`spotifyId`、`requestId`、`source`、`from`、`to`；反馈另支持 `category`、`status`；请求日志另支持 `outcome`。时间过滤为可解析的 ISO 时间，界面将本地时间转换成 UTC。

反馈状态为 `pending`、`in_progress`、`resolved`、`ignored`。每次状态/备注保存都产生操作时间、状态和本次备注的历史记录。JSON 导出包含详情、快照及历史。界面以 `textContent` 显示用户输入和快照，不执行其中 HTML。

使用独立管理密码和 HMAC-SHA-256 签名会话。会话有效期 12 小时，Cookie 为 `__Host-lyrics_admin`，带 `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`。D1 存储有效会话 ID，退出时撤销；修改会话密钥使已有签名失效。密码比较经过固定长度 SHA-256 摘要后逐字节比较。

全部后台数据接口鉴权。登录每 IP 每分钟最多 5 次；所有非 GET 操作要求 `Origin` 与 Worker 同源。后台无通配 CORS，详情及 API 禁止缓存；页面 CSP 限制跨域连接、嵌入和对象。后台只显示登录表单时不暴露反馈数据。生产登录应使用 HTTPS。

## 数据库与保留期

迁移：`Server/migrations/0001_feedback.sql`。

- `lyric_requests`：请求摘要与检索字段。
- `provider_attempts`：来源尝试，随请求级联删除。
- `lyric_reports`：反馈元数据、诊断副本、当前状态。
- `report_snapshots`：两份歌词快照，随反馈级联删除。
- `report_history`：状态和备注历史，随反馈级联删除。
- `rate_limits`：短期原子限流记录。
- `admin_sessions`：可撤销会话 ID 与到期时间。

每日 UTC 19:15（北京时间次日 03:15）清理 60 天前的请求和 365 天前的反馈，同时清理失效会话与旧限流计数。删除分批、有单次工作上限；大量积压可能需要多次运行，可手动触发 scheduled 处理。诊断日志保留失败提示不会影响普通歌词请求。

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

集成测试用 Miniflare 的真实本地 D1 执行完整迁移及事务；覆盖空选填、输入约束、并发幂等、限流、两种日志晚到竞态、分页筛选、处理历史、鉴权、同源校验、退出、过期、清理及存储失败。来源测试覆盖所有启用平台及直连/代理路径；请求测试覆盖脱敏、HTTP 状态、重试、超时和取消。扩展测试验证转换保留来源、快照固定对象、缓存请求 ID 错配重新转换及切歌后不发布旧结果。

浏览器本地验证使用实际弹窗模块、模拟播放器状态和本地 Worker：桌面与 390px 窄屏下验证输入、失败重试、成功回执、切歌对象固定，后台验证登录、筛选、详情、状态备注、快照文本显示和退出。模拟播放器验证不能替代生产 Spotify 环境的最终安装验收。

## 上线顺序

1. 创建数据库：`cd Server && npx wrangler d1 create beautiful-lyrics-feedback`。保存返回 UUID。
2. 在 `wrangler.toml` 填入真实 UUID，或配置 CI secret `FEEDBACK_DATABASE_ID`。数据库 ID 不是密码；不要填零 UUID 到生产。
3. 用 `npx wrangler secret put ADMIN_PASSWORD` 设置独立管理密码，用 `npx wrangler secret put ADMIN_SESSION_SECRET` 设置至少 32 字符的随机签名密钥（可用 `openssl rand -hex 32` 生成）。
4. 执行 `node Tasks/Deploy.mjs`。脚本校验 UUID，在同目录生成临时配置，先执行远程 D1 迁移再部署 Worker；迁移失败即停止发布，最后删除临时文件。
5. 验证新 Worker 的 `/admin` 登录、测试反馈及查询、来源元数据和请求诊断；旧扩展仍兼容新 Worker。未配置 D1 时歌词继续工作，上报会明确失败。
6. 发布新扩展。现有 GitHub Actions 已将迁移接入发布步骤，使用 `FEEDBACK_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；令牌需具备 Worker 发布和 D1 管理权限。D1 迁移与 Worker 配置应先准备完成，再更新扩展发布指针。若要求严格分开发行，可先单独部署 Worker，再运行扩展发布流水线。
7. 安装后测试普通和全屏入口，填写过程中切歌、未填写邮箱、缓存读取上报，后台确认歌曲/指纹/来源/关联日志一致。

仓库提交不会自动修改生产；本次实施只交付本地实现、验证和 Git 提交。生产部署沿用维护者配置后的流程。

## 回滚

优先用 Cloudflare Worker 版本回滚恢复旧服务，并恢复上一份扩展 `latest.json` 和其不可变构建文件；旧客户端忽略新增来源字段，旧 Worker 下新客户端仍可显示歌词，但反馈接口不可用时会显示失败。

本迁移只新增表，无需在代码回滚时删除数据库。保留反馈和诊断数据以便排查；不要通过删除 D1 或反向清空表来回滚。若要撤销管理登录，轮换 `ADMIN_SESSION_SECRET` 或删除对应 secrets。缓存版本升级不会改动歌词偏移量或其他用户设置；重新发布后旧歌词缓存不会被拼接进新响应。

参考：[Cloudflare D1 Worker API（事务批量操作）](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[D1 本地开发](https://developers.cloudflare.com/d1/best-practices/local-development/)。
