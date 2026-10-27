# 服务端歌词缓存

在加上这层之前，`/lyrics/:id` 每次调用都会向最多 7 个上游并发抓取。同一首歌被第二个用户播放时，整条链路照原样重跑一遍：search、候选匹配、解密、转换。

缓存把「一首歌的结果」在 Worker 侧留住，命中时整条上游链路被短路。

## 分层

一个 Spotify track 一行，质量越高活得越久。

| 类型 | TTL | 依据 |
| --- | --- | --- |
| Syllable | 30 天 | 来自官方曲库（QQ QRC / 酷狗 KRC / 网易云 YRC / Musixmatch RichSync），基本不随专辑改版变化 |
| Line | 14 天 | 来自 Spotify、Apple Music 等平台，重发专辑或换地区版本时会变 |
| Static | 3 天 | 社区投稿（Genius、LRCLIB），错字与换行修正频繁 |

TTL 定义在 `Server/src/cache.ts` 的 `ttlByType`。改这里即可，没有别处依赖。

## 三条正确性约束

**审核优先于缓存。** 表里额外存了 `provider` 和 `lyrics_type` 两列。读缓存时先过一遍 `isSourceBlocked`：如果管理员在 `/admin` 拉黑了这个来源，命中视为 miss，并把整行删掉。少了这一步，一条在拉黑之前写下的旧行会变成绕过审核的后门。

**运行时字段不入库。** `RequestId`、`RetrievedAt`、`LyricsHash` 描述的是单次响应，`strip()` 在写入前剥掉。命中时由路由层重新生成，所以 `RequestId` 每次不同、`LyricsHash` 保持稳定（`hashLyrics` 本来就只哈希内容）。

**存储故障不影响主链路。** 读失败 → `catch` 成 miss；写失败 → `waitUntil` 里吞掉。D1 挂掉时插件退化成加缓存之前的行为，不会更差。

## 为什么不用 KV，也不做负缓存

KV 免费额度是 100k 读 / **1k 写**每天，写额度对「每首新歌写一次」的量级完全不够。D1 的 100k 写每天有足够余量，而且 `FEEDBACK_DB` 已经绑好了，不引入新资源。

负缓存（查不到也存一条）理论上收益最大——长尾歌曲反复落空最浪费上游配额。但它的写入量随请求量线性增长，正好是 D1 写额度最吃紧的部分。如果确实要做，应该走 Cache API 或独立 KV，不要塞进这张表。

## 缓存键为什么只有 trackId

歌词内容只取决于曲目本身。`accessToken`、`App-Platform` 这些请求头影响的是上游能不能返回结果，不影响返回后的内容，所以不进键。

代价是：Spotify 官方源按 `market=from_token` 取歌词，理论上地区之间可能不同。实际歌词文本没有地区差异，这个偏差可以接受。如果哪天发现地区串味，把 market 拼进键即可。

## 观测

`diagnostics.cache` 记 `hit` / `miss`，随请求日志一起进 `lyric_requests`。Analytics Engine 里这个值写在 `blobs[5]`（第六位），`GET /stats` 的 `metrics.cache` 分区按它分组统计。

历史数据这一位是空字符串，看板里显示为空属正常。

## 验证

```bash
cd Server
npm test                 # 290 项，含 14 项缓存用例
npx tsc --noEmit
```

`test/cache.test.ts` 用真实 D1（miniflare），覆盖：过期驱逐、审核命中即删、损坏行自愈、缺 provider 不写、以及「第二次请求不再调用 service」的路由级断言。

## 部署

```bash
cd Server
npx wrangler d1 migrations apply beautiful-lyrics-feedback --remote
npx wrangler deploy
```

`docs/fullscreen-loading-and-statistics.md` 里提到「不需要 D1 数据库迁移」，那句在本变更后已经不成立——上线前先跑上面的迁移。

回滚只需 `git revert` 并重新部署；旧的 `0005` 表留着不影响任何代码路径，`cleanupFeedback` 会继续按 `expires_at` 清它。
