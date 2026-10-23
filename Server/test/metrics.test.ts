import { describe, it, expect, vi } from 'vitest';
import { metricsResponse, validateEvents, recordRequestMetrics, statisticsQueries, detailedStatistics } from '../src/metrics';
import type { RequestDiagnostics } from '../src/types';
const batch={schema:1,events:[{kind:'lyrics_load',version:'5.2.3',durationMs:25,source:'prefetch',outcome:'success',lyricsType:'Line'}]};
describe('anonymous metrics',()=>{
 it('validates fixed fields and bounds durations, dimensions and batches',()=>{
  expect(validateEvents(batch)[0]?.source).toBe('prefetch');
  for(const payload of [{...batch,events:[]},{...batch,events:Array(21).fill(batch.events[0])},{...batch,events:[{...batch.events[0],token:'secret'}]},{...batch,events:[{...batch.events[0],durationMs:Infinity}]},{...batch,events:[{...batch.events[0],source:'secret'}]}])expect(()=>validateEvents(payload)).toThrow();
 });
 it('accepts batches without D1, enforces separate limiter and rejects oversized bodies',async()=>{
  const writeDataPoint=vi.fn(),env={METRICS:{writeDataPoint},METRICS_LIMITER:{limit:vi.fn().mockResolvedValue({success:true})}} as any;
  const request=(body=JSON.stringify(batch))=>new Request('https://local/metrics',{method:'POST',headers:{'Content-Type':'application/json'},body});
  expect((await metricsResponse(request(),env)).status).toBe(204);expect(writeDataPoint).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(writeDataPoint.mock.calls)).not.toMatch(/token|Spotify|track/);
  env.METRICS_LIMITER.limit.mockResolvedValue({success:false});expect((await metricsResponse(request(),env)).status).toBe(429);
  env.METRICS_LIMITER.limit.mockResolvedValue({success:true});expect((await metricsResponse(request('x'.repeat(16385)),env)).status).toBe(413);
  expect((await metricsResponse(request('invalid'),env)).status).toBe(400);
  expect((await metricsResponse(request(),{})).status).toBe(503);
 });
 it('records cancelled/blocked separately and adopts only explicitly selected attempt',()=>{
  const writeDataPoint=vi.fn(),record:RequestDiagnostics={id:'secret',track:{id:'secret',name:'secret',artists:['secret']},startedAt:'date',durationMs:100,outcome:'success',attempts:[
   {provider:'qq music',stage:'syllable',startedAt:'date',durationMs:20,outcome:'cancelled',retries:0,upstream:[]},
   {provider:'kugou',stage:'syllable',startedAt:'date',durationMs:30,outcome:'blocked',retries:0,upstream:[]},
   {provider:'spotify',stage:'line',startedAt:'date',durationMs:40,outcome:'success',selected:true,lyricsType:'Line',retries:1,upstream:[]},
  ]};
  recordRequestMetrics({METRICS:{writeDataPoint} as any},record,{Type:'Line',Content:[],StartTime:0,EndTime:1});
  expect(writeDataPoint.mock.calls).toHaveLength(4);expect(writeDataPoint.mock.calls[3]?.[0].doubles[2]).toBe(1);
  expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain('secret');
 });
 it('queries counts and latencies using sample weights and tolerates unconfigured data',async()=>{
  const queries=statisticsQueries(30);expect(queries.server).toContain('sum(_sample_interval)');expect(queries.latency).toContain('quantileExactWeighted(0.95)');
  expect(queries.providerLatency).toContain("blob7 IN ('success','none','failed','timeout')");
  expect(await detailedStatistics({},30)).toMatchObject({available:false});
 });
});
