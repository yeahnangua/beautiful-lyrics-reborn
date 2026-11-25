/** Shared by both stages of one origin query; never shared across users. */
export class RequestScheduler {
  private active = 0;
  private total = 0;
  private firstStage = 0;
  private waiting: {signal:AbortSignal; stage:string|undefined; resolve:(release:()=>void)=>void; reject:(reason:unknown)=>void; abort:()=>void}[] = [];
  readonly responses = new Map<string, Response>();
  private responseBytes = 0;
  remember(key:string,response:Response,bytes:number):void {
    if(bytes>512*1024||this.responseBytes+bytes>4*1024*1024||this.responses.has(key))return;
    this.responses.set(key,response.clone());this.responseBytes+=bytes;
  }
  acquire(signal:AbortSignal,stage?:string):Promise<()=>void> {
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const item={signal,stage,resolve,reject,abort:()=>{}};
      item.abort=()=>{this.waiting=this.waiting.filter(waiter=>waiter!==item);reject(signal.reason);this.pump()};
      signal.addEventListener('abort',item.abort,{once:true});
      this.waiting.push(item);this.pump();
    });
  }
  private pump():void {
    while(this.active<5&&this.waiting.length){
      const item=this.waiting.shift()!;item.signal.removeEventListener('abort',item.abort);
      if(item.signal.aborted){item.reject(item.signal.reason);continue}
      if(this.total>=40||item.stage!=='line'&&this.firstStage>=28){item.reject(Error('Upstream request budget exhausted'));continue}
      this.total++;if(item.stage!=='line')this.firstStage++;this.active++;
      let released=false;
      item.resolve(()=>{if(released)return;released=true;this.active--;this.pump()});
    }
  }
}
