import { randomUUID } from 'node:crypto';
export const CHUNK_BYTES = 512 * 1024;
export const MAX_TRANSFER_BYTES = 26 * 1024 * 1024;
export const BATCH_CHUNKS = 3;
export class TransferError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
// Transfer records are temporary, account-bound and never exposed as public files.
export function createTransferService({ db, readVisible, save, now = Date.now }) {
  const seconds = () => Math.floor(now() / 1000);
  const checkAdmin = user => { if (user.role !== 'admin') throw new TransferError('此操作需要管理员权限。', 403); };
  async function cleanup() {
    await db.batch([
      db.prepare('DELETE FROM transfer_chunks WHERE transfer_id IN (SELECT id FROM transfer_jobs WHERE expires_at <= ?)').bind(seconds()),
      db.prepare('DELETE FROM transfer_jobs WHERE expires_at <= ?').bind(seconds()),
    ]);
  }
  async function job(user, id, direction) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new TransferError('传输不存在。', 404);
    const row = await db.prepare('SELECT * FROM transfer_jobs WHERE id = ? AND owner = ? AND owner_role = ? AND expires_at > ?').bind(id, user.username, user.role, seconds()).first();
    if (!row || (direction && row.direction !== direction)) throw new TransferError('传输已过期，请刷新后重试。', 404);
    return row;
  }
  async function begin(user, input) {
    if (!['upload', 'download'].includes(input.direction)) throw new TransferError('传输类型不正确。');
    if (input.direction === 'upload') checkAdmin(user);
    await cleanup();
    let data, byteLength, chunkCount;
    if (input.direction === 'download') {
      data = Buffer.from(JSON.stringify(await readVisible(user)), 'utf8');
      byteLength = data.length; chunkCount = Math.ceil(byteLength / CHUNK_BYTES);
    } else {
      byteLength = input.bytes; chunkCount = input.chunks;
      if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new TransferError('数据版本不正确。');
    }
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_TRANSFER_BYTES || chunkCount !== Math.ceil(byteLength / CHUNK_BYTES)) throw new TransferError('传输大小不正确。', 413);
    const id = randomUUID();
    const inserted = await db.prepare("INSERT INTO transfer_jobs (id,owner,owner_role,direction,chunk_count,byte_length,expected_revision,reason,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM transfer_jobs WHERE owner = ? AND expires_at > ? AND status <> 'done') < 6")
      .bind(id, user.username, user.role, input.direction, chunkCount, byteLength, input.revision ?? null, String(input.reason || '更新工作台').slice(0,250), seconds()+1800, user.username, seconds()).run();
    if (inserted.meta.changes !== 1) throw new TransferError('正在进行的传输较多，请稍后重试。', 429);
    try {
      if (data) for (let i=0; i<chunkCount; i+=BATCH_CHUNKS) {
        const statements = [];
        for (let j=i; j<Math.min(i+BATCH_CHUNKS,chunkCount); j++) statements.push(db.prepare('INSERT INTO transfer_chunks VALUES (?,?,?)').bind(id,j,data.subarray(j*CHUNK_BYTES,(j+1)*CHUNK_BYTES).toString('base64')));
        await db.batch(statements);
      }
    } catch (error) { await remove(user,id); throw error; }
    return { id, chunks:chunkCount, bytes:byteLength, chunkBytes:CHUNK_BYTES, batchChunks:BATCH_CHUNKS };
  }
  async function download(user, id, start) {
    const row = await job(user,id,'download');
    if (!Number.isSafeInteger(start) || start<0 || start>=row.chunk_count) throw new TransferError('分片编号不正确。');
    const { results } = await db.prepare('SELECT chunk_index,content FROM transfer_chunks WHERE transfer_id=? AND chunk_index>=? ORDER BY chunk_index LIMIT ?').bind(id,start,BATCH_CHUNKS).all();
    if (results.length !== Math.min(BATCH_CHUNKS,row.chunk_count-start) || results.some((r,i)=>r.chunk_index!==start+i)) throw new TransferError('传输分片不完整，请重新读取。',503);
    return { chunks:results.map(r=>r.content) };
  }
  async function upload(user,id,start,chunks) {
    checkAdmin(user); const row=await job(user,id,'upload');
    if(row.status!=='open')throw new TransferError('本次传输已进入保存阶段。',409);
    if(!Number.isSafeInteger(start)||start<0||!Array.isArray(chunks)||!chunks.length||chunks.length>BATCH_CHUNKS||start+chunks.length>row.chunk_count)throw new TransferError('分片数量不正确。');
    const statements=chunks.map((content,i)=>{
      const expected=Math.min(CHUNK_BYTES,row.byte_length-(start+i)*CHUNK_BYTES);
      if(typeof content!=='string'||content.length!==Math.ceil(expected/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(content)||Buffer.from(content,'base64').length!==expected||Buffer.from(content,'base64').toString('base64')!==content)throw new TransferError('分片内容不正确。');
      return db.prepare("INSERT INTO transfer_chunks (transfer_id,chunk_index,content) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM transfer_jobs WHERE id=? AND status='open' AND expires_at>?) ON CONFLICT(transfer_id,chunk_index) DO UPDATE SET content=excluded.content")
        .bind(id,start+i,content,id,seconds());
    });
    const results=await db.batch(statements);
    if(results.some(r=>r.meta.changes!==1))throw new TransferError('本次传输已结束。',409);
    return { uploaded:chunks.length };
  }
  async function commit(user,id) {
    checkAdmin(user);const row=await job(user,id,'upload');
    if(row.status==='done')return JSON.parse(row.result);
    const locked=await db.prepare("UPDATE transfer_jobs SET status='saving' WHERE id=? AND status='open'").bind(id).run();
    if(locked.meta.changes!==1)throw new TransferError('正在保存，请稍后刷新确认。',409);
    try {
      const parts=[];
      for(let i=0;i<row.chunk_count;i+=BATCH_CHUNKS){
        const {results}=await db.prepare('SELECT chunk_index,content FROM transfer_chunks WHERE transfer_id=? AND chunk_index>=? ORDER BY chunk_index LIMIT ?').bind(id,i,BATCH_CHUNKS).all();
        if(results.length!==Math.min(BATCH_CHUNKS,row.chunk_count-i)||results.some((r,n)=>r.chunk_index!==i+n))throw new TransferError('分片上传不完整，本次未保存。');
        parts.push(...results.map(r=>Buffer.from(r.content,'base64')));
      }
      const bytes=Buffer.concat(parts);if(bytes.length!==row.byte_length)throw new TransferError('上传大小不一致。');
      let state;try{state=JSON.parse(bytes.toString('utf8'))}catch{throw new TransferError('上传内容格式不正确。')}
      const result=await save(state,row.expected_revision,row.reason);
      // The business snapshot is already committed. Never claim it was undone
      // if recording the transfer receipt is interrupted.
      try{await db.batch([db.prepare("UPDATE transfer_jobs SET status='done',result=? WHERE id=?").bind(JSON.stringify(result),id),db.prepare('DELETE FROM transfer_chunks WHERE transfer_id=?').bind(id)]);}catch{}
      return result;
    }catch(error){await db.prepare("UPDATE transfer_jobs SET status='open' WHERE id=? AND status='saving'").bind(id).run();throw error;}
  }
  async function remove(user,id){await job(user,id);await db.batch([db.prepare('DELETE FROM transfer_chunks WHERE transfer_id=?').bind(id),db.prepare('DELETE FROM transfer_jobs WHERE id=?').bind(id)]);return {ok:true};}
  return {begin,download,upload,commit,remove};
}
