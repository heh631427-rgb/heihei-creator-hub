// Every request/response stays below 3 MiB, including poorly compressible data.
const CHUNK_BYTES = 512 * 1024;
const GROUP = 3;
function call(path:string,method='GET',body?:unknown) {
  return fetch(path,{method,credentials:'same-origin',cache:'no-store',...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
}
function encode(data:Uint8Array) {
  let text='';for(let i=0;i<data.length;i+=32768)text+=String.fromCharCode(...data.subarray(i,i+32768));
  return btoa(text);
}
function decode(data:string) { const s=atob(data),out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out; }
export async function loadWorkbench():Promise<Response> {
  const opened=await call('/api/transfers','POST',{direction:'download'});
  if(!opened.ok)return opened;
  const meta=await opened.json(), path='/api/transfers/'+meta.id;
  try {
    const result=new Uint8Array(meta.bytes);let offset=0;
    for(let start=0;start<meta.chunks;start+=GROUP) {
      const response=await call(path+'?start='+start);if(!response.ok)return response;
      const body=await response.json();
      for(const chunk of body.chunks){const bytes=decode(chunk);result.set(bytes,offset);offset+=bytes.length;}
    }
    if(offset!==meta.bytes)throw new Error('数据读取不完整，请重新刷新。');
    return new Response(result,{headers:{'Content-Type':'application/json'}});
  } finally { await call(path,'DELETE',{}).catch(()=>{}); }
}
export async function saveWorkbench(state:unknown,revision:number,reason:string):Promise<Response> {
  const bytes=new TextEncoder().encode(JSON.stringify(state)),chunks=Math.ceil(bytes.length/CHUNK_BYTES);
  const opened=await call('/api/transfers','POST',{direction:'upload',bytes:bytes.length,chunks,revision,reason});
  if(!opened.ok)return opened;
  const meta=await opened.json(),path='/api/transfers/'+meta.id;
  let committed=false;
  try {
    for(let start=0;start<chunks;start+=GROUP){
      const parts=[];for(let i=start;i<Math.min(start+GROUP,chunks);i++)parts.push(encode(bytes.subarray(i*CHUNK_BYTES,(i+1)*CHUNK_BYTES)));
      const response=await call(path,'PUT',{start,chunks:parts});if(!response.ok)return response;
    }
    // Once commit is sent, retain the receipt on network failure. Refresh to
    // resolve uncertain completion instead of overwriting a newer revision.
    committed=true;
    return await call(path+'/commit','POST',{});
  } finally { if(!committed)await call(path,'DELETE',{}).catch(()=>{}); }
}
