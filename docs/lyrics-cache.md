# 服务端歌词缓存

在加上这层之前，`/lyrics/:id` 每次调用都会向最多 7 个上游并发抓取。同一首歌被第二个用户播放时，整条链路照原样重跑一遍：search、候选匹配、解密、转换。

缓存把「一首歌的结果」保存在独立 D1 数据库 `lyrics-cache`（Worker 绑定名 `LYRICS_CACHE_DB`），命中时跳过上游查询。反馈、诊断和来源屏蔽规则仍在原来的 `FEEDBACK_DB`。

## 分层

一个 Spotify track 一行，质量越高活得越久。

| 类型 | TTL | 依据 |
| --- | --- | --- |
| Syllable | 30 天 | 来自官方曲库（QQ QRC / 酷狗 KRC / 网易云 YRC / Musixmatch RichSync），基本不随专辑改版变化 |
| Line | 14 天 | 来自 Spotify、Apple Music 等平台，重发专辑或换地区版本时会变 |
| Static | 3 天 | 社区投稿（Genius、LRCLIB），错字与换行修正频繁 |

TTL 定义在 `Server/src/cache.ts` 的 `ttlByType`。改这里即可，没有别处依赖。

## 正确性约束

**审核优先于缓存。** 表里额外存了 `provider` 和 `lyrics_type` 两列。读缓存时先过一遍 `isSourceBlocked`：如果管理员在 `/admin` 拉黑了这个来源，命中视为 miss，并把整行删掉。少了这一步，一条在拉黑之前写下的旧行会变成绕过审核的后门。

**并发写入保留更高质量。** `ON CONFLICT` 在数据库内比较质量等级，未过期的逐字结果不能被稍后返回的逐行或纯文本覆盖。同等级结果可刷新，过期结果可由任意等级替换。清除屏蔽或损坏行时只删除本次实际读取的版本，不删除并发请求刚写入的替代结果。

**运行时字段不入库。** `RequestId`、`RetrievedAt`、`LyricsHash` 描述的是单次响应，`strip()` 在写入前剥掉。命中时由路由层重新生成，所以 `RequestId` 每次不同、`LyricsHash` 保持稳定（`hashLyrics` 本来就只哈希内容）。

**存储故障不影响主链路。** 读失败 → `catch` 成 miss；写失败 → `waitUntil` 里吞掉。D1 挂掉时插件退化成加缓存之前的行为，不会更差。

## 数据库隔离

`lyrics-cache` 只存 `lyrics_cache` 表；它有独立的 `cache-migrations` 迁移目录。反馈库继续使用 `migrations` 目录，两边的迁移不会混用。部署时先分别迁移，再发布 Worker。

每日定时任务分别清理两个数据库，一边失败不会阻止另一边清理。不提供 `LYRICS_CACHE_DB` 时关闭服务端歌词缓存，反馈库不会被用作替代缓存。

查不到歌词时不写入空结果（不做负缓存）。

## 缓存键为什么只有 trackId

歌词内容只取决于曲目本身。`accessToken`、`App-Platform` 这些请求头影响的是上游能不能返回结果，不影响返回后的内容，所以不进键。

代价是：Spotify 官方源按 `market=from_token` 取歌词，理论上地区之间可能不同。实际歌词文本没有地区差异，这个偏差可以接受。如果哪天发现地区串味，把 market 拼进键即可。

## 观测

`diagnostics.cache` 记 `hit` / `miss`，随请求日志一起进 `lyric_requests`。Analytics Engine 里这个值写在 `blobs[5]`（第六位），`GET /stats` 的 `metrics.cache` 分区按它分组统计。

历史数据这一位是空字符串，看板里显示为空属正常。

## 验证

```bash
cd Server
npm test
npx tsc --noEmit
```

`test/cache.test.ts` 用真实 D1（miniflare），覆盖：过期驱逐、审核命中即删、损坏行自愈、缺 provider 不写、以及「第二次请求不再调用 service」的路由级断言。

## 部署

你已创建的 D1 数据库名称为 `lyrics-cache`，在 `Server/wrangler.toml` 中对应：

```toml
[[d1_databases]]
binding = "LYRICS_CACHE_DB"
database_name = "lyrics-cache"
database_id = "填入 lyrics-cache 的 UUID"
migrations_dir = "cache-migrations"
```

直接使用 Wrangler 时，先填写该 UUID，再执行：

```bash
cd Server
npx wrangler d1 migrations apply LYRICS_CACHE_DB --remote
npx wrangler deploy
```

现有 GitHub Actions 调用 `node Tasks/Deploy.mjs`，会使用 `LYRICS_CACHE_DATABASE_ID`（可选的 GitHub Actions secret），或按名称 `lyrics-cache` 查询对应 UUID。原来的 `FEEDBACK_DATABASE_ID` 继续用于反馈库。Cloudflare API token 需要有这两个数据库的 D1 管理权限。

部署脚本将分别对 `FEEDBACK_DB`、`LYRICS_CACHE_DB` 执行各自迁移。

如果旧版本曾把 `lyrics_cache` 表建在反馈库，旧表不会自动搬迁或删除。新库从空缓存开始积累；旧缓存无需迁移。
