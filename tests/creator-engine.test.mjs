import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createEmptyState,defaultSettings,deriveData,gradeCreator,mergeImport,normalizeRows,guessMappings,normalizeCreator,parseNumber,parseMonth,parseSalesPeriod,classifyOrder,videoIdsFromLinks,findDuplicateVideoImport} from '../lib/creator-engine.mjs';

const video=(changes={})=>({videoId:'7685709492532563222',productId:'1729625085229963289',creatorId:'creator',reportMonth:'2026-09',periodStart:'2026-09-01',periodEnd:'2026-09-30',postDate:'2026-09-15',itemsSold:12,views:100,url:'https://www.tiktok.com/@creator/video/7685709492532563222',...changes});
test('grade boundaries and repeat collaboration use stated priority',()=>{
 assert.equal(gradeCreator(9,5).level,1);assert.equal(gradeCreator(10,2).level,2);assert.equal(gradeCreator(10,1).level,1);
 assert.equal(gradeCreator(11,2).level,3);assert.equal(gradeCreator(19,2).level,3);assert.equal(gradeCreator(20,2).level,4);
 assert.equal(gradeCreator(50,2).level,4);assert.equal(gradeCreator(51,2).level,5);assert.equal(gradeCreator(59,1).level,1);assert.equal(gradeCreator(60,1).level,5);
 const settings=structuredClone(defaultSettings);settings.rules[0].minSold=70;assert.equal(gradeCreator(60,1,settings).level,1);
});
test('repeated import updates existing period metrics without adding sales',()=>{
 let s=mergeImport(createEmptyState(),'videos',[video()]).state;
 let r=mergeImport(s,'videos',[video({itemsSold:18,views:150})]);assert.equal(r.summary.updated,1);assert.equal(r.state.videos.length,1);
 assert.equal(deriveData(r.state).stats.itemsSold,18);assert.equal(deriveData(r.state).stats.views,150);
 let repeat=mergeImport(r.state,'videos',[video({itemsSold:18,views:150})]);assert.equal(repeat.summary.unchanged,1);assert.equal(repeat.state.videos.length,1);
});
test('new nonoverlapping monthly snapshot adds same video performance once',()=>{
 let s=mergeImport(createEmptyState(),'videos',[video(),video({reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',itemsSold:3,views:40})]).state;
 assert.equal(deriveData(s).stats.itemsSold,15);assert.equal(deriveData(s).stats.videoCount,1);assert.equal(deriveData(s).stats.views,140);assert.equal(deriveData(s).stats.historicalViewsReference,100);
 assert.equal(deriveData(s,{month:'2026-10'}).stats.itemsSold,3);
});
test('overlapping video periods block until explicit replacement',()=>{
 let s=mergeImport(createEmptyState(),'videos',[video()]).state;const incoming=video({periodStart:'2026-09-01',periodEnd:'2026-10-15',itemsSold:20});
 assert.throws(()=>mergeImport(s,'videos',[incoming]),e=>e.code==='OVERLAPPING_PERIOD');
 const r=mergeImport(s,'videos',[incoming],{replaceOverlapping:true});assert.equal(r.state.videos.length,1);assert.equal(deriveData(r.state).stats.itemsSold,20);
});
test('product table deletions do not erase retained SKU mappings; updates replace same SKU ID',()=>{
 let s=mergeImport(createEmptyState(),'products',[{skuId:'001',sku:'A',productId:'P1'},{skuId:'002',sku:'B',productId:'P2'}]).state;
 s=mergeImport(s,'products',[{skuId:'001',sku:'A',productId:'P3'}]).state;assert.equal(s.productMappings.length,2);assert.equal(s.productMappings.find(r=>r.skuId==='001').productId,'P3');
});
test('Seller SKU ambiguity is never resolved to an arbitrary PID',()=>{
 const s=createEmptyState();s.productMappings=[{sku:'A',skuId:'1',productId:'P1'},{sku:'A',skuId:'2',productId:'P2'}];
 s.samples=[{orderId:'O1',sku:'A',creatorId:'creator',date:'2026-09-01'},{orderId:'O2',sku:'A',skuId:'2',creatorId:'creator',date:'2026-09-01'}];
 const d=deriveData(s);assert.equal(d.samples[0].productId,'');assert.equal(d.samples[0].productMatch,'ambiguous');assert.equal(d.samples[1].productId,'P2');
});
test('manual notes survive blank imports and protected notes survive nonblank imports',()=>{
 let s=createEmptyState();s.creators=[{creatorId:'creator',notes:'手工备注',style:'实拍演示',_manual:{notes:true}}];
 s=mergeImport(s,'creators',[{creatorId:'creator',notes:'外部备注',style:''}]).state;assert.equal(s.creators[0].notes,'手工备注');assert.equal(s.creators[0].style,'实拍演示');
});
test('string IDs preserve every digit and unsafe numeric IDs are not silently accepted',()=>{
 const heads=['Order ID','SKU ID','Seller SKU','Buyer Username','Created Time'];const map=guessMappings(heads,'orders');
 let r=normalizeRows('orders',[['576959319755823270','1729711098132731929','AU8036-6','@Creator','09/30/2026 5:18:03 PM']],map,{sheetName:'发样订单'});
 assert.equal(r.records[0].orderId,'576959319755823270');assert.equal(r.records[0].skuId,'1729711098132731929');assert.equal(r.records[0].creatorId,'creator');assert.equal(r.records[0].buyerUsername,'creator');assert.equal(r.records[0].createdAt,'2026-09-30');
 r=normalizeRows('orders',[[576959319755823270,'1729711098132731929','AU8036-6','creator','09/30/2026']],map,{});assert.equal(r.records.length,0);assert.equal(r.rejected,1);assert.ok(r.warnings.length);
});
test('order and manual sample join exactly on order+platform SKU and preserve contact notes',()=>{
 const s=createEmptyState();s.samples=[{orderId:'O1',skuId:'S1',creatorId:'creator',date:'2026-09-01',notes:'已联系',quantity:1}];s.orders=[{orderId:'O1',skuId:'S1',creatorId:'creator',createdAt:'2026-09-01',sourceType:'sample_orders',quantity:1,trackingId:'T1',substatus:'Delivered'}];const d=deriveData(s);
 assert.equal(d.samples.length,1);assert.equal(d.samples[0].notes,'已联系');assert.equal(d.samples[0].trackingId,'T1');assert.equal(d.stats.sampleQuantity,1);
});
test('cancelled samples remain visible but leave effective totals and collaboration count',()=>{
 const s=createEmptyState();s.samples=[{orderId:'O1',skuId:'S1',creatorId:'creator',date:'2026-09-01',received:'缺货取消',quantity:1},{orderId:'O2',skuId:'S2',creatorId:'creator',date:'2026-09-01',received:'是',quantity:1}];s.settings.cooperationBasis='orders';const d=deriveData(s);
 assert.equal(d.samples.length,2);assert.equal(d.stats.sampleCount,1);assert.equal(d.stats.sampleQuantity,1);assert.equal(d.creators[0].cooperationCount,1);
});
test('creator+PID and nearest preceding date produce candidates, including unresolved ties, never confirmation',()=>{
 const s=createEmptyState();s.samples=[{id:'S1',orderId:'O1',skuId:'A',productId:'1729625085229963289',creatorId:'creator',date:'2026-09-01'},{id:'S2',orderId:'O2',skuId:'B',productId:'OTHER',creatorId:'creator',date:'2026-09-01'}];s.videos=[video()];let d=deriveData(s);assert.equal(d.samples.find(r=>r.id==='S1').candidateVideoCount,1);assert.equal(d.samples.find(r=>r.id==='S1').matchedVideoCount,0);assert.deepEqual(d.samples.find(r=>r.id==='S1').videoLinks,[]);assert.equal(d.samples.find(r=>r.id==='S2').candidateVideoCount,0);
 s.samples.push({id:'S3',orderId:'O3',skuId:'C',productId:'1729625085229963289',creatorId:'creator',date:'2026-09-01'});d=deriveData(s);assert.equal(d.samples.reduce((n,r)=>n+r.matchedVideoCount,0),0);assert.equal(d.samples.reduce((n,r)=>n+r.candidateVideoCount,0),2);assert.ok(d.issues.some(i=>i.type==='ambiguousVideo'));
});
test('same video across multiple PIDs does not duplicate report views and cooperation uses sample quantities',()=>{
 const s=createEmptyState();s.samples=[{creatorId:'creator',orderId:'O1',sku:'A',quantity:2}];s.videos=[video(),video({productId:'P2',itemsSold:4,views:100})];const d=deriveData(s);assert.equal(d.stats.itemsSold,16);assert.equal(d.stats.views,100);assert.equal(d.stats.videoCount,1);assert.equal(d.creators[0].cooperationCount,2);assert.equal(d.creators[0].views,null);
});
test('preferences enrich managed creators without turning unrelated reference accounts into collaborators',()=>{
 const s=createEmptyState();s.creators=[{creatorId:'creator',style:'产品实拍'}];s.preferences=[{creatorId:'creator',tendency:'家清'},{creatorId:'reference_only',tendency:'美妆'}];const d=deriveData(s);assert.equal(d.creators.length,1);assert.equal(d.creators[0].tendency,'家清');assert.equal(d.stats.preferenceCount,2);
});
test('historical unknown-period sales do not add to current Video Analysis metrics',()=>{
 const s=createEmptyState();s.creators=[{creatorId:'creator',historicalItemsSold:824}];s.videos=[video()];const d=deriveData(s);assert.equal(d.creators[0].itemsSold,12);assert.equal(d.creators[0].historicalItemsSold,824);assert.equal(d.stats.itemsSold,12);
});
test('sample export and reimport keep historical quantities separate from computed video sales',()=>{
 const s=createEmptyState();s.samples=[{orderId:'O1',skuId:'S1',productId:'1729625085229963289',creatorId:'creator',date:'2026-09-01',historicalItemsSold:73,quantity:1,notes:'原记录',videoLinks:[video().url]}];s.videos=[video()];
 const r=deriveData(s).samples[0];const headers=['日期','达人ID','Order ID','样品ID','Product ID','卖出个数','关联视频出单量','后续合作沟通'];
 const mapping=guessMappings(headers,'samples');assert.equal(mapping.historicalItemsSold,'5');
 const imported=normalizeRows('samples',[[r.date,r.creatorId,r.orderId,r.skuId,r.productId,r.historicalItemsSold,r.itemsSold,r.notes]],mapping);
 const merged=mergeImport(s,'samples',imported.records).state;assert.equal(merged.samples[0].historicalItemsSold,73);assert.equal(deriveData(merged).samples[0].itemsSold,12);
 const computedOnly=guessMappings(['达人ID','Order ID','样品ID','关联视频出单量'],'samples');assert.equal(computedOnly.historicalItemsSold,'');
 const partial=normalizeRows('samples',[['creator','O1','S1',0]],computedOnly);assert.equal(mergeImport(s,'samples',partial.records).state.samples[0].historicalItemsSold,73);
});
test('creator export roundtrip preserves historical references while cooperation willingness can update',()=>{
 const s=createEmptyState();s.creators=[{creatorId:'creator',historicalItemsSold:824,willingness:'待确认',notes:'旧备注'}];s.videos=[video()];
 const c=deriveData(s).creators[0];const headers=['达人ID','历史累计出单(参考)','已导入视频累计出单量','合作意愿','备注'];const mapping=guessMappings(headers,'creators');
 assert.equal(mapping.historicalItemsSold,'1');assert.equal(mapping.willingness,'3');
 const imported=normalizeRows('creators',[[c.creatorId,c.historicalItemsSold,c.itemsSold,'愿意合作','新备注']],mapping);const merged=mergeImport(s,'creators',imported.records).state;
 assert.equal(merged.creators[0].historicalItemsSold,824);assert.equal(merged.creators[0].willingness,'愿意合作');assert.equal(merged.creators[0].notes,'新备注');assert.equal(deriveData(merged).creators[0].itemsSold,12);
 assert.equal(guessMappings(['达人ID','已导入视频累计出单量'],'creators').historicalItemsSold,'');
});
test('sample link columns preserve third and additional links without duplicating URLs',()=>{
 const urls=[1,2,3,4].map(n=>`https://www.tiktok.com/@creator/video/700000000000000000${n}`);const headers=['达人ID','Order ID','样品ID','视频链接','视频链接2','视频链接3','全部视频链接'];
 const imported=normalizeRows('samples',[['creator','O1','S1',urls[0],urls[1],urls[2],urls.join('\n')]],guessMappings(headers,'samples'));
 assert.deepEqual(imported.records[0].videoLinks,urls);assert.equal(imported.records[0].videoIds.length,4);
 const s=createEmptyState();s.samples=[{orderId:'O1',skuId:'S1',creatorId:'creator',videoLinks:urls.slice(0,2)}];const merged=mergeImport(s,'samples',imported.records).state;
 assert.deepEqual(merged.samples[0].videoLinks,urls);assert.equal(merged.samples.length,1);
});
test('reimported willingness and links respect manual protection until overwrite is explicitly selected',()=>{
 const urls=[1,2,3].map(n=>`https://www.tiktok.com/@creator/video/700000000000000000${n}`);const s=createEmptyState();s.samples=[{orderId:'O1',skuId:'S1',creatorId:'creator',videoLinks:[urls[0]],_manual:{videoLinks:true}}];s.creators=[{creatorId:'creator',willingness:'暂不合作',_manual:{willingness:true}}];
 const samples=normalizeRows('samples',[['creator','O1','S1',urls[2]]],guessMappings(['达人ID','Order ID','样品ID','视频链接3'],'samples')).records;
 const creators=normalizeRows('creators',[['creator','愿意合作']],guessMappings(['达人ID','合作意愿'],'creators')).records;
 assert.deepEqual(mergeImport(s,'samples',samples).state.samples[0].videoLinks,[urls[0]]);assert.equal(mergeImport(s,'creators',creators).state.creators[0].willingness,'暂不合作');
 assert.deepEqual(mergeImport(s,'samples',samples,{overwriteManual:true}).state.samples[0].videoLinks,[urls[2]]);assert.equal(mergeImport(s,'creators',creators,{overwriteManual:true}).state.creators[0].willingness,'愿意合作');
});
test('protected manual video links also protect the IDs used for explicit sample matching',()=>{
 const keptUrl='https://www.tiktok.com/@creator/video/7000000000000000001',incomingUrl=video().url;
 const s=createEmptyState();s.samples=[{orderId:'O1',skuId:'S1',productId:video().productId,creatorId:'creator',date:'2026-09-01',videoLinks:[keptUrl],videoIds:videoIdsFromLinks(keptUrl),_manual:{videoLinks:true}}];s.videos=[video({postDate:''})];
 const rows=normalizeRows('samples',[['creator','O1','S1',incomingUrl]],guessMappings(['达人ID','Order ID','样品ID','视频链接3'],'samples')).records;
 const preserved=mergeImport(s,'samples',rows).state;assert.deepEqual(preserved.samples[0].videoIds,videoIdsFromLinks(keptUrl));assert.equal(deriveData(preserved).samples[0].matchedVideoCount,0);
 const overwritten=mergeImport(s,'samples',rows,{overwriteManual:true}).state;assert.deepEqual(overwritten.samples[0].videoIds,videoIdsFromLinks(incomingUrl));assert.equal(deriveData(overwritten).samples[0].matchedVideoCount,1);
 assert.deepEqual(videoIdsFromLinks([keptUrl,keptUrl,'invalid','https://www.example.com/']),['7000000000000000001']);
});
test('column omission uses a unique existing order+SKU or period+video key without duplicating metrics',()=>{
 let s=createEmptyState();s.samples=[{orderId:'O1',skuId:'S1',sku:'A',creatorId:'creator',date:'2026-09-01'}];
 s=mergeImport(s,'samples',[{orderId:'O1',sku:'A',creatorId:'creator',notes:'新备注'}]).state;assert.equal(s.samples.length,1);assert.equal(s.samples[0].skuId,'S1');
 s.videos=[video()];const {productId,...incomplete}=video({itemsSold:19});s=mergeImport(s,'videos',[incomplete]).state;assert.equal(s.videos.length,1);assert.equal(s.videos[0].productId,productId);assert.equal(deriveData(s).stats.itemsSold,19);
 const newVideo={...incomplete,videoId:'999999',itemsSold:500};s=mergeImport(s,'videos',[newVideo]).state;assert.equal(deriveData(s).stats.itemsSold,19);assert.ok(deriveData(s).issues.some(i=>i.type==='missingVideoProduct'));
});
test('promotion templates accept SKU系列 and month sales labels but reject formula footnotes',()=>{
 assert.equal(parseMonth('Video_Analysis_Video_List_20260901-20260930.xlsx'),'2026-09');
 const heads=['SKU系列','7月出单情况Items sold','备注'];const map=guessMappings(heads,'promotions');assert.equal(map.sku,'0');assert.equal(map.itemsSold,'1');
 const r=normalizeRows('promotions',[['AU8026系列',12,'保留'],['T-112',0,'有效SKU'],['公式说明（计算方法）：',null,null],['C列 9月发样数量 = SUMIF()',null,null]],map,{month:'2026-07'});
 assert.equal(r.records.length,2);assert.equal(r.records[0].sku,'AU8026');assert.equal(r.records[0].originalSku,'AU8026系列');assert.equal(r.records[0].itemsSold,12);
});
test('existing descriptive video notes enrich style but follow-up status does not fabricate a style',()=>{
 const s=createEmptyState();s.samples=[{orderId:'O1',sku:'A',creatorId:'creator',date:'2026-09-01',videoNotes:'讲解认真，画质清晰'},{orderId:'O2',sku:'B',creatorId:'other',date:'2026-09-01',videoNotes:'二次催促'}];const d=deriveData(s);assert.equal(d.creators.find(c=>c.creatorId==='creator').style,'讲解认真，画质清晰');assert.equal(d.creators.find(c=>c.creatorId==='other').style,'');
});
test('locale amounts and handles normalize without losing symbols in SKUs',()=>{assert.equal(parseNumber('1.531,41 €'),1531.41);assert.equal(parseNumber('1,531.41 EUR'),1531.41);assert.equal(normalizeCreator('https://www.tiktok.com/@Creator.Example/video/123'),'creator.example');const r=normalizeRows('products',[['P','S','T-112'],['P2','S2','8871']],{productId:'0',skuId:'1',sku:'2'});assert.equal(r.records.length,2);assert.equal(r.records[1].sku,'8871');});
test('order classification permits blank types by default while preserving a saved opt-out',()=>{assert.equal(classifyOrder({orderType:'Normal'}).included,false);assert.equal(classifyOrder({orderType:'Sample',substatus:'Cancelled'}).included,false);assert.equal(classifyOrder({orderType:'',sourceType:'all_orders'}).included,true);assert.equal(classifyOrder({orderType:'',sourceType:'sample_orders'}).included,true);assert.equal(classifyOrder({orderType:'',sourceType:'all_orders'},{orderFilter:{allowBlankType:false}}).included,false);});
test('automatic date format uses column evidence and invalid dates produce review warnings',()=>{const map={orderId:'0',sku:'1',createdAt:'2'};const r=normalizeRows('orders',[['O1','A','09/30/2026'],['O2','A','09/10/2026'],['O3','A','2026-13-01']],map,{dateFormat:'auto'});assert.equal(r.records[0].createdAt,'2026-09-30');assert.equal(r.records[1].createdAt,'2026-09-10');assert.equal(r.records[2].createdAt,'');assert.ok(r.warnings.some(x=>x.includes('无法识别日期')));});
test('cross-month report stays in whole-period totals without pretending all sales belong to one month',()=>{const s=createEmptyState();s.videos=[video({periodStart:'2026-09-15',periodEnd:'2026-10-15'})];assert.equal(deriveData(s).stats.itemsSold,12);assert.equal(deriveData(s,{month:'2026-09'}).stats.itemsSold,0);assert.ok(deriveData(s).issues.some(i=>i.type==='crossMonthPeriod'));});
test('unresolved historical promotion SKU remains visible with notes and historical metrics',()=>{const s=createEmptyState();s.promotions=[{month:'2026-07',sku:'UNMAPPED',sampleQuantity:3,itemsSold:5,notes:'需要补货'}];const d=deriveData(s,{month:'2026-07'});assert.equal(d.promotions.length,1);assert.equal(d.promotions[0].sku,'UNMAPPED');assert.equal(d.promotions[0].notes,'需要补货');assert.equal(d.promotions[0].historicalItemsSold,5);assert.ok(d.issues.some(i=>i.type==='missingPromotionProduct'));});

test('sample quantity is the cooperation count even with legacy settings, zero quantity, refunds and duplicate orders',()=>{
 const s=createEmptyState();s.settings.cooperationBasis='videos';s.samples=[{orderId:'O1',skuId:'S1',creatorId:'creator',quantity:2},{orderId:'O2',skuId:'S2',creatorId:'creator'},{orderId:'O3',skuId:'S3',creatorId:'creator',quantity:0},{orderId:'O4',skuId:'S4',creatorId:'creator',quantity:8,received:'已退款'}];s.orders=[{orderId:'O1',skuId:'S1',creatorId:'creator',quantity:2,sourceType:'sample_orders'}];s.videos=[video({itemsSold:20})];
 const d=deriveData(s),c=d.creators[0];assert.equal(c.cooperationCount,3);assert.equal(c.sampleQuantity,3);assert.equal(c.level,4);assert.equal(d.stats.sampleQuantity,3);assert.equal(d.samples.length,4);assert.equal(d.settings.cooperationBasis,'sampleQuantity');
});
test('roster follows sample history plus preserved managed profiles, never video or preference leads',()=>{
 const s=createEmptyState();s.samples=[{creatorId:'sample_creator',sku:'A',quantity:1},{creatorId:'cancelled_creator',sku:'B',quantity:1,received:'已取消'}];s.creators=[{creatorId:'legacy_profile',notes:'保留人工档案',historicalItemsSold:600}];s.settings.useHistoricalFallback=true;s.videos=[video({creatorId:'video_only',itemsSold:10})];s.preferences=[{creatorId:'reference_only',latestViews:999},{creatorId:'sample_creator',tendency:'家清'}];
 const d=deriveData(s);assert.deepEqual(d.creators.map(c=>c.creatorId).sort(),['cancelled_creator','legacy_profile','sample_creator']);assert.equal(d.stats.creatorCount,3);assert.equal(d.creators.find(c=>c.creatorId==='legacy_profile').notes,'保留人工档案');assert.ok(d.creators.every(c=>c.level===1));assert.equal(d.creators.find(c=>c.creatorId==='cancelled_creator').cooperationCount,0);
});
test('creator lifetime sales add 500 then 10, while reimporting either period is idempotent',()=>{
 let s=createEmptyState();s.samples=[{creatorId:'creator',sku:'A',quantity:2}];const sept=video({itemsSold:500}),oct=video({reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',itemsSold:10});
 s=mergeImport(s,'videos',[sept]).state;s=mergeImport(s,'videos',[oct]).state;s=mergeImport(s,'videos',[sept,oct]).state;
 assert.equal(s.videos.length,2);assert.equal(deriveData(s).creators[0].lifetimeItemsSold,510);assert.equal(deriveData(s,{month:'2026-10'}).creators[0].itemsSold,10);assert.equal(deriveData(s,{month:'2026-10'}).creators[0].lifetimeItemsSold,510);
});
test('no-sample creators join only above the editable confirmed sales threshold with a labeled default cooperation',()=>{
 const s=createEmptyState();s.videos=[video({creatorId:'ten',videoId:'10',itemsSold:10}),video({creatorId:'eleven',videoId:'11',itemsSold:6}),video({creatorId:'eleven',videoId:'11',reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',itemsSold:5}),video({creatorId:'large',videoId:'101',itemsSold:101})];
 let d=deriveData(s);assert.deepEqual(d.creators.map(c=>c.creatorId).sort(),['eleven','large']);const c=d.creators.find(c=>c.creatorId==='eleven');assert.equal(c.rosterSource,'salesThreshold');assert.equal(c.cooperationCount,1);assert.equal(c.sampleCount,0);assert.equal(c.sampleQuantity,0);assert.equal(c.selfPurchaseQuantitySource,'default');assert.equal(c.level,1);assert.match(c.admissionReason,/暂无收样记录/);
 s.settings.videoOnlyCreatorMinSold=100;d=deriveData(s);assert.deepEqual(d.creators.map(c=>c.creatorId),['large']);s.creators=[{creatorId:'eleven',notes:'人工维护'}];d=deriveData(s);assert.deepEqual(d.creators.map(c=>c.creatorId).sort(),['eleven','large']);assert.equal(d.creators.find(c=>c.creatorId==='eleven').rosterSource,'historicalProfile');
});
test('latest preference views replace rather than add, preserve zero, and survive imports without a views column',()=>{
 let s=createEmptyState();s.samples=[{creatorId:'creator',sku:'A'}];s.videos=[video({views:5000})];
 const heads=['达人ID','带货倾向','播放量','播放量更新日期'],map=guessMappings(heads,'preferences');assert.equal(map.latestViews,'2');
 let r=normalizeRows('preferences',[['creator','家清',120,'2026-09-30']],map,{sourceName:'西班牙倾向9月.xlsx',at:'2026-09-30T10:00:00Z'});s=mergeImport(s,'preferences',r.records).state;assert.equal(deriveData(s).creators[0].views,120);
 r=normalizeRows('preferences',[['creator','家居',0,'2026-10-31']],map,{sourceName:'西班牙倾向10月.xlsx',at:'2026-10-31T10:00:00Z'});s=mergeImport(s,'preferences',r.records).state;let c=deriveData(s).creators[0];assert.equal(c.views,0);assert.equal(c.viewsAsOf,'2026-10-31');assert.equal(c.viewsSource,'西班牙倾向10月.xlsx');
 s=mergeImport(s,'preferences',[{creatorId:'creator',tendency:'宠物',sourceFile:'无播放量.xlsx'}]).state;c=deriveData(s).creators[0];assert.equal(c.views,0);assert.equal(c.viewsAsOf,'2026-10-31');assert.equal(c.viewsSource,'西班牙倾向10月.xlsx');assert.equal(c.tendency,'宠物');
 s=mergeImport(s,'preferences',[{creatorId:'creator',latestViews:999,latestViewsAsOf:'2026-08-31'}]).state;assert.equal(deriveData(s).creators[0].views,0);
 const missing=createEmptyState();missing.samples=[{creatorId:'creator',sku:'A'}];missing.creators=[{creatorId:'creator',views:999,latestViews:888}];missing.preferences=[{creatorId:'creator',tendency:'家居'}];missing.videos=[video({views:5000})];assert.equal(deriveData(missing).creators[0].views,null);
});
test('product contribution identifies main sampled PID and counts only single videos strictly above ten units',()=>{
 const s=createEmptyState();s.samples=[{creatorId:'creator',orderId:'O1',sku:'A',productId:'P1',quantity:2,date:'2026-09-01'}];s.productMappings=[{productId:'P1',sku:'A',productName:'清洁样品'},{productId:'P2',sku:'B',productName:'其他商品'}];
 s.videos=[video({videoId:'v1',productId:'P1',itemsSold:8}),video({videoId:'v1',productId:'P1',reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',itemsSold:3}),video({videoId:'v2',productId:'P1',itemsSold:10}),video({videoId:'v3',productId:'P2',itemsSold:5})];
 const c=deriveData(s).creators[0];assert.equal(c.lifetimeItemsSold,26);assert.equal(c.topProduct.productId,'P1');assert.equal(c.topProduct.itemsSold,21);assert.equal(c.topProduct.salesShare,21/26);assert.equal(c.topProduct.sampleLinked,true);assert.equal(c.topProduct.sampleQuantity,2);assert.equal(c.topProduct.goodVideoCount,1);assert.equal(c.topProduct.topVideoItemsSold,11);assert.equal(c.successfulSampleVideoCount,1);assert.equal(c.productContributions.find(p=>p.productId==='P2').sampleLinked,false);
});
test('pending periods suggest receipt links without confirming them or adding sales, grades or creators',()=>{
 const s=createEmptyState();s.samples=[{creatorId:'creator',orderId:'O1',sku:'A',productId:video().productId,date:'2026-09-01',quantity:2}];s.pendingVideoImports=[{id:'pending',status:'pending',records:[video({itemsSold:500,periodStart:'',periodEnd:'',reportMonth:''}),video({creatorId:'video_only',videoId:'999',itemsSold:999})]}];
 const d=deriveData(s);assert.equal(d.samples[0].matchedVideoCount,0);assert.equal(d.samples[0].pendingVideoCount,0);assert.equal(d.samples[0].candidateVideoCount,1);assert.deepEqual(d.samples[0].candidateVideoLinks,[video().url]);assert.deepEqual(d.samples[0].videoLinks,[]);assert.equal(d.samples[0].itemsSold,0);assert.equal(d.stats.itemsSold,0);assert.equal(d.creators[0].lifetimeItemsSold,0);assert.equal(d.creators[0].level,1);assert.equal(d.creators[0].views,null);assert.equal(d.creators.length,1);assert.equal(d.creators[0].topProduct,null);
 s.samples[0].videoLinks=[video().url];assert.equal(deriveData(s).samples[0].pendingVideoCount,1);s.pendingVideoImports[0].status='confirmed';assert.equal(deriveData(s).samples[0].pendingVideoCount,0);
});
test('video report month must be explicitly selected, including malformed date filenames',()=>{
 const headers=['Video ID','Creator','Product ID','Post date','Items sold'];const rows=[['123','creator','P1','2026-09-01',12]],map=guessMappings(headers,'videos');
 for(const sourceName of ['Video_Analysis_Video_List_202501001-260931.xlsx','Video_Analysis_Video_List_20260901-20260930.xlsx']){const r=normalizeRows('videos',rows,map,{sourceName});assert.equal(r.records.length,0);assert.equal(r.rejected,1);}
 assert.equal(normalizeRows('videos',rows,map,{month:'2026-09'}).records[0].periodStart,'2026-09-01');assert.throws(()=>mergeImport(createEmptyState(),'videos',[video({reportMonth:'',periodStart:'',periodEnd:''})]),e=>e.code==='MISSING_VIDEO_PERIOD');
});
test('partial period replacement cannot erase uncovered historical sales',()=>{
 const s=createEmptyState();s.videos=[video({periodStart:'2025-10-01',periodEnd:'2026-09-30',reportMonth:'',itemsSold:9181})];
 assert.throws(()=>mergeImport(s,'videos',[video({itemsSold:1789})],{replaceOverlapping:true}),e=>e.code==='PARTIAL_PERIOD_REPLACEMENT');assert.equal(s.videos[0].itemsSold,9181);
});
test('archived monthly reports provide labeled monthly references but never inflate cumulative baseline sales',()=>{
 const s=createEmptyState();s.samples=[{creatorId:'creator',orderId:'O1',sku:'A',productId:video().productId,date:'2026-09-01',quantity:2}];s.videos=[video({periodStart:'2025-10-01',periodEnd:'2026-09-30',reportMonth:'',itemsSold:510})];s.videoReportArchives=[{id:'old',archivedAt:'2026-10-01',records:[video({itemsSold:400})]},{id:'new',archivedAt:'2026-10-29',records:[video({itemsSold:500})]}];
 for(const archive of s.videoReportArchives)Object.assign(archive,{promotionReportPurpose:'publication',promotionReportMonth:'2026-09',periodStart:'2026-09-01',periodEnd:'2026-09-30'});
 const all=deriveData(s),sept=deriveData(s,{month:'2026-09'});assert.equal(all.stats.itemsSold,510);assert.equal(all.creators[0].lifetimeItemsSold,510);assert.equal(sept.stats.itemsSold,500);assert.equal(sept.creators[0].lifetimeItemsSold,510);assert.equal(sept.promotions[0].itemsSold,500);assert.match(sept.promotions[0].videoMetricSource,/发布视频报表/);assert.match(sept.stats.videoMetricSource,/已归档/);
 s.videos=[video({itemsSold:600})];assert.equal(deriveData(s,{month:'2026-09'}).stats.itemsSold,600);
});

test('self-purchased quantity is an editable fallback and never inflates actual sample totals',()=>{
 const s=createEmptyState();s.creators=[{creatorId:'creator'}];s.videos=[video({itemsSold:20})];
 let c=deriveData(s).creators[0];assert.equal(c.cooperationCount,1);assert.equal(c.selfPurchasedSampleQuantity,1);assert.equal(c.estimatedSelfPurchaseQuantity,1);assert.equal(c.manualSelfPurchasedSampleQuantity,null);assert.match(c.cooperationSource,/默认估计/);assert.equal(c.sampleQuantity,0);
 s.creators[0].selfPurchasedSampleQuantity=2;c=deriveData(s).creators[0];assert.equal(c.cooperationCount,2);assert.equal(c.estimatedSelfPurchaseQuantity,0);assert.equal(c.manualSelfPurchasedSampleQuantity,2);assert.equal(c.selfPurchaseQuantitySource,'manual');assert.equal(c.level,4);
 s.creators[0].selfPurchasedSampleQuantity=0;c=deriveData(s).creators[0];assert.equal(c.cooperationCount,0);assert.equal(c.selfPurchaseQuantitySource,'manual');assert.equal(c.level,1);
 s.creators[0].selfPurchasedSampleQuantity=null;c=deriveData(s).creators[0];assert.equal(c.cooperationCount,1);assert.equal(c.manualSelfPurchasedSampleQuantity,null);
 assert.equal(deriveData(s).stats.sampleQuantity,0);
});

test('receipt history supersedes self-purchase fallback without adding the two quantities',()=>{
 const s=createEmptyState();s.creators=[{creatorId:'creator',selfPurchasedSampleQuantity:3,selfPurchaseNotes:'已确认买了三件'}];s.videos=[video({itemsSold:40})];
 s.samples=[{creatorId:'creator',orderId:'O1',sku:'A',quantity:2}];let c=deriveData(s).creators[0];assert.equal(c.cooperationCount,2);assert.equal(c.recordedSampleQuantity,2);assert.equal(c.selfPurchasedSampleQuantity,0);assert.equal(c.manualSelfPurchasedSampleQuantity,3);assert.equal(c.selfPurchaseFallbackActive,false);assert.equal(c.selfPurchaseNotes,'已确认买了三件');assert.match(c.cooperationSource,/有效收样/);
 s.samples[0].received='已取消';c=deriveData(s).creators[0];assert.equal(c.cooperationCount,0);assert.equal(c.selfPurchaseFallbackActive,false);assert.equal(c.sampleRecordCount,1);
 s.samples[0].received='';s.samples[0].quantity=0;c=deriveData(s).creators[0];assert.equal(c.cooperationCount,0);assert.equal(c.sampleQuantity,0);
});

test('default self-purchase quantity applies only to qualified managed creators without receipt history',()=>{
 const s=createEmptyState();s.settings.selfPurchaseDefaultQuantity=2;s.creators=[{creatorId:'creator'},{creatorId:'quiet'},{creatorId:'explicit',selfPurchasedSampleQuantity:3}];s.videos=[video({itemsSold:20}),video({creatorId:'below',videoId:'below',itemsSold:10})];
 let d=deriveData(s);assert.equal(d.creators.find(c=>c.creatorId==='creator').cooperationCount,2);assert.equal(d.creators.find(c=>c.creatorId==='quiet').cooperationCount,0);assert.equal(d.creators.find(c=>c.creatorId==='explicit').cooperationCount,3);assert.ok(!d.creators.some(c=>c.creatorId==='below'));
 s.settings.selfPurchaseDefaultQuantity=0;assert.equal(deriveData(s).creators.find(c=>c.creatorId==='creator').cooperationCount,0);
});

test('self-purchase import maps only the manual value, preserves zero and rejects fractional or negative quantities',()=>{
 const heads=['达人ID','自购样品数量（手工）','推定自购样品数量','自购样品备注'],mapping=guessMappings(heads,'creators');assert.equal(mapping.selfPurchasedSampleQuantity,'1');
 const r=normalizeRows('creators',[['creator',0,1,'明确零件'],['fractional',1.5,2,'错误'],['negative',-1,2,'错误'],['blank','',1,'默认']],mapping);assert.equal(r.records[0].selfPurchasedSampleQuantity,0);assert.equal(r.records[0].selfPurchaseNotes,'明确零件');assert.ok(!Object.hasOwn(r.records[1],'selfPurchasedSampleQuantity'));assert.ok(!Object.hasOwn(r.records[2],'selfPurchasedSampleQuantity'));assert.ok(!Object.hasOwn(r.records[3],'selfPurchasedSampleQuantity'));assert.equal(r.warnings.length,2);
 let s=createEmptyState();s.creators=[{creatorId:'creator',selfPurchasedSampleQuantity:2,_manual:{selfPurchasedSampleQuantity:true}}];s=mergeImport(s,'creators',[r.records[0]]).state;assert.equal(s.creators[0].selfPurchasedSampleQuantity,2);s=mergeImport(s,'creators',[r.records[0]],{overwriteManual:true}).state;assert.equal(s.creators[0].selfPurchasedSampleQuantity,0);
});

const baseline=(records=[video({itemsSold:9181})],changes={})=>({id:'history',fileName:'history.xlsx',sheetName:'Sheet 1',sourceHash:'history-file',cutoffDate:'2026-09-30',records,...changes});
test('historical baseline without an invented start adds October increments and keeps September as archived reference',()=>{
 const s=createEmptyState();s.videoBaselines=[baseline()];s.videoReportArchives=[{id:'sept',records:[video({itemsSold:1789})]}];s.samples=[{creatorId:'creator',orderId:'O1',sku:'A',productId:video().productId,date:'2026-09-01',quantity:2,videoLinks:[video().url]}];
 let d=deriveData(s);assert.equal(d.stats.itemsSold,9181);assert.equal(d.creators[0].lifetimeItemsSold,9181);assert.equal(d.videos[0].reportKind,'historicalBaseline');assert.equal(d.videos[0].periodStart,'');assert.equal(d.creators[0].topProduct.itemsSold,9181);assert.equal(d.samples[0].itemsSold,9181);assert.ok(!d.months.includes('1900-01'));
 assert.equal(deriveData(s,{month:'2026-09'}).stats.itemsSold,1789);assert.match(deriveData(s,{month:'2026-09'}).stats.videoMetricSource,/已归档/);
 const oct=video({reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',itemsSold:10});const next=mergeImport(s,'videos',[oct],{sourceHash:'oct-file',sheetName:'Sheet 1'}).state;
 d=deriveData(next);assert.equal(d.stats.itemsSold,9191);assert.equal(d.creators[0].lifetimeItemsSold,9191);assert.equal(deriveData(next,{month:'2026-10'}).stats.itemsSold,10);assert.equal(next.videoBaselines[0].records[0].itemsSold,9181);
});

test('ordinary period imports cannot overlap a historical baseline cutoff',()=>{
 const s=createEmptyState();s.videoBaselines=[baseline()];assert.throws(()=>mergeImport(s,'videos',[video()],{replaceOverlapping:true}),e=>e.code==='BASELINE_PERIOD_OVERLAP');assert.throws(()=>mergeImport(s,'videos',[video({periodStart:'2026-09-30',periodEnd:'2026-10-01'})]),e=>e.code==='BASELINE_PERIOD_OVERLAP');assert.equal(deriveData(s).stats.itemsSold,9181);
});

test('identical uploaded bytes are skipped even if an old file is relabeled as a future month',()=>{
 let s=createEmptyState();s.videoBaselines=[baseline()];const oct=video({reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',itemsSold:9181});
 let result=mergeImport(s,'videos',[oct],{sourceHash:'history-file',sheetName:'Sheet 1',month:'2026-10'});assert.equal(result.summary.duplicateFile,true);assert.equal(result.summary.unchanged,1);assert.equal(result.state.videos.length,0);assert.equal(result.state.imports.length,0);assert.equal(deriveData(result.state).stats.itemsSold,9181);
 s=mergeImport(s,'videos',[{...oct,itemsSold:10}],{sourceHash:'oct-file',sheetName:'Sheet 1',month:'2026-10',mappingSignature:'mapping-1'}).state;
 result=mergeImport(s,'videos',[{...oct,periodStart:'2026-11-01',periodEnd:'2026-11-30',reportMonth:'2026-11',itemsSold:10}],{sourceHash:'oct-file',sheetName:'Sheet 1',month:'2026-11',mappingSignature:'mapping-2'});assert.equal(result.summary.duplicateFile,true);assert.equal(deriveData(result.state).stats.itemsSold,9191);
});

test('same-file different worksheets and same-period mapping corrections are not falsely skipped',()=>{
 const rows=[video({itemsSold:10})];let s=mergeImport(createEmptyState(),'videos',rows,{sourceHash:'workbook',sheetName:'A',month:'2026-09',mappingSignature:'one'}).state;
 let r=mergeImport(s,'videos',[video({videoId:'second',itemsSold:5})],{sourceHash:'workbook',sheetName:'B',month:'2026-09',mappingSignature:'one'});assert.equal(r.summary.duplicateFile,undefined);assert.equal(deriveData(r.state).stats.itemsSold,15);
 r=mergeImport(s,'videos',[video({itemsSold:20})],{sourceHash:'workbook',sheetName:'A',month:'2026-09',mappingSignature:'two'});assert.equal(r.summary.duplicateFile,undefined);assert.equal(deriveData(r.state).stats.itemsSold,20);assert.equal(s.videos[0].itemsSold,10);
 r=mergeImport(s,'videos',[video({reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31'})],{sourceHash:'workbook',sheetName:'A',month:'2026-09',rangeStart:'2026-09-01',rangeEnd:'2026-09-30',mappingSignature:'two'});assert.equal(r.summary.duplicateFile,true);assert.equal(deriveData(r.state).stats.itemsSold,10);
});

test('different overlapping periods inside one import are rejected before their metrics can be added',()=>{
 const s=createEmptyState();assert.throws(()=>mergeImport(s,'videos',[video(),video({periodStart:'2026-09-15',periodEnd:'2026-10-15',reportMonth:'',itemsSold:20})]),error=>error.code==='OVERLAPPING_INCOMING_PERIODS');assert.equal(s.videos.length,0);
});

test('same publication date and equal sales in genuine different report periods both contribute',()=>{
 let s=createEmptyState();s.videoBaselines=[baseline([video({itemsSold:10})])];s.creators=[{creatorId:'creator'}];
 const oct=video({reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',itemsSold:10});s=mergeImport(s,'videos',[oct],{sourceHash:'new-oct-bytes',sheetName:'Sheet 1'}).state;assert.equal(deriveData(s).creators[0].lifetimeItemsSold,20);
 const again=mergeImport(s,'videos',[oct],{sourceHash:'new-oct-bytes',sheetName:'Sheet 1'});assert.equal(again.summary.duplicateFile,true);assert.equal(deriveData(again.state).creators[0].lifetimeItemsSold,20);
});

test('duplicate search ignores unconfirmed staged files but recognizes a completed source without its raw rows',()=>{
 const s=createEmptyState();s.pendingVideoImports=[{id:'pending',status:'period_unconfirmed',sha256:'upload',sheetName:'Sheet 1',records:[video()]}];assert.equal(findDuplicateVideoImport(s,{sourceHash:'upload',sheetName:'Sheet 1'}),null);
 s.pendingVideoImports[0].status='confirmed';s.pendingVideoImports[0].records=[];assert.equal(findDuplicateVideoImport(s,{sourceHash:'upload',sheetName:'Sheet 1'}).id,'pending');assert.equal(findDuplicateVideoImport(s,{sourceHash:'upload',sheetName:'Sheet 2'}),null);
});

test('sales period parser requires an explicit year for month-only entries and validates calendar boundaries',()=>{
 assert.deepEqual(parseSalesPeriod('10月',{reportYear:2026}),{periodStart:'2026-10-01',periodEnd:'2026-10-31',reportMonth:'2026-10'});
 assert.equal(parseSalesPeriod('10月',{reportYear:2027}).periodStart,'2027-10-01');assert.equal(parseSalesPeriod('10月'),null);assert.equal(parseSalesPeriod('10月',{reportYear:'26'}),null);
 assert.deepEqual(parseSalesPeriod('2026年10月'),parseSalesPeriod('2026-10'));assert.equal(parseSalesPeriod('2024-02').periodEnd,'2024-02-29');assert.equal(parseSalesPeriod('2026-02').periodEnd,'2026-02-28');assert.equal(parseSalesPeriod('13月',{reportYear:2026}),null);assert.equal(parseSalesPeriod('2026-02-30'),null);assert.equal(parseSalesPeriod('2026-00'),null);
});

test('sales periods accept concrete days, Excel dates and explicit ranges without guessing a historical start',()=>{
 assert.deepEqual(parseSalesPeriod('2026-10-12'),{periodStart:'2026-10-12',periodEnd:'2026-10-12',reportMonth:'2026-10'});
 const serial=(Date.UTC(2026,9,12)-Date.UTC(1899,11,30))/86400000;assert.deepEqual(parseSalesPeriod(serial),parseSalesPeriod('2026-10-12'));assert.deepEqual(parseSalesPeriod(String(serial)),parseSalesPeriod('2026-10-12'));
 assert.deepEqual(parseSalesPeriod('2026-10-01 至 2026-11-30'),{periodStart:'2026-10-01',periodEnd:'2026-11-30',reportMonth:''});assert.deepEqual(parseSalesPeriod('2026-10-01 - 2026-10-31'),parseSalesPeriod('2026-10'));assert.equal(parseSalesPeriod('2026-11-30 至 2026-10-01'),null);
});

test('mapped 出单日期 overrides file month and publication date; identical videos in October and November sum to 510',()=>{
 const headers=['Video ID','Product ID','Creator','Post date','出单日期','Items sold'],mapping=guessMappings(headers,'videos');assert.equal(mapping.salesDate,'4');assert.equal(mapping.postDate,'3');
 const normalized=normalizeRows('videos',[['v1','P1','creator','2025-01-02','10月',500],['v1','P1','creator','2025-01-02','11月',10]],mapping,{reportYear:2026,month:'2026-09',rangeStart:'2026-09-01',rangeEnd:'2026-09-30'});assert.equal(normalized.rejected,0);assert.equal(normalized.records[0].periodStart,'2026-10-01');assert.equal(normalized.records[1].periodStart,'2026-11-01');assert.equal(normalized.records[0].postDate,'2025-01-02');
 let s=mergeImport(createEmptyState(),'videos',normalized.records,{month:'2026-09',rangeStart:'2026-09-01',rangeEnd:'2026-09-30'}).state;assert.equal(deriveData(s).creators[0].lifetimeItemsSold,510);assert.equal(deriveData(s,{month:'2026-10'}).stats.itemsSold,500);assert.equal(deriveData(s,{month:'2026-11'}).stats.itemsSold,10);assert.equal(s.imports[0].month,'');assert.equal(s.imports[0].rangeStart,'');assert.equal(s.imports[0].periods.length,2);
 s=mergeImport(s,'videos',normalized.records).state;assert.equal(deriveData(s).stats.itemsSold,510);assert.equal(s.videos.length,2);
});

test('invalid supplied sales dates are rejected instead of silently inheriting the file month',()=>{
 const mapping=guessMappings(['Video ID','Product ID','Creator','Post date','出单日期','Items sold'],'videos'),context={month:'2026-09',rangeStart:'2026-09-01',rangeEnd:'2026-09-30',reportYear:2026};
 const rejected=normalizeRows('videos',[['bad','P1','creator','2026-10-01','13月',5],['bad2','P1','creator','2026-10-01','2026-02-30',6]],mapping,context);assert.equal(rejected.records.length,0);assert.equal(rejected.rejected,2);assert.ok(rejected.warnings.every(w=>w.includes('出单日期')));
 const missingYear=normalizeRows('videos',[['v1','P1','creator','2026-10-01','10月',5]],mapping,{month:'2026-09'});assert.equal(missingYear.records.length,0);assert.equal(missingYear.rejected,1);
 const noSalesDate=normalizeRows('videos',[['v1','P1','creator','2026-10-01','',5]],mapping,{});assert.equal(noSalesDate.records.length,0);assert.ok(noSalesDate.warnings.some(w=>w.includes('缺少视频统计周期')));
 const explicitFallback=normalizeRows('videos',[['v1','P1','creator','2026-10-01','',5]],mapping,context);assert.equal(explicitFallback.records[0].periodStart,'2026-09-01');
});

test('a single sales-date period is stored in import provenance instead of stale file-level September choices',()=>{
 const mapping=guessMappings(['Video ID','Product ID','Creator','出单日期','Items sold'],'videos');const records=normalizeRows('videos',[['v1','P1','creator','10月',10]],mapping,{reportYear:2026,month:'2026-09'}).records;
 const context={month:'2026-09',rangeStart:'2026-09-01',rangeEnd:'2026-09-30',sourceHash:'dated-upload',sheetName:'Sheet 1',mappingSignature:'first'};const first=mergeImport(createEmptyState(),'videos',records,context);assert.equal(first.state.imports[0].month,'2026-10');assert.equal(first.state.imports[0].rangeStart,'2026-10-01');assert.equal(first.state.imports[0].rangeEnd,'2026-10-31');
 const correction=mergeImport(first.state,'videos',[{...records[0],itemsSold:12}],{...context,mappingSignature:'corrected'});assert.equal(correction.summary.duplicateFile,undefined);assert.equal(deriveData(correction.state).stats.itemsSold,12);
});

test('mapped month-only statistics columns also use the visible report year; daily sales remain separate',()=>{
 let mapping=guessMappings(['Video ID','Product ID','Creator','统计月份','Items sold'],'videos');let normalized=normalizeRows('videos',[['v1','P1','creator','10月',12]],mapping,{reportYear:'2027'});assert.equal(normalized.records[0].periodStart,'2027-10-01');
 mapping=guessMappings(['Video ID','Product ID','Creator','出单日期','Items sold'],'videos');normalized=normalizeRows('videos',[['v1','P1','creator','2026-10-01',5],['v1','P1','creator','2026-10-02',7]],mapping,{});const s=mergeImport(createEmptyState(),'videos',normalized.records).state;assert.equal(s.videos.length,2);assert.equal(deriveData(s,{month:'2026-10'}).stats.itemsSold,12);
});

const seedPath='/workspace/scratch/1a1faba85f0d/analysis_data/seed.json';
if(fs.existsSync(seedPath))test('actual September source keeps sales and published-video counts while period playback includes older videos',()=>{const s=JSON.parse(fs.readFileSync(seedPath,'utf8'));const d=deriveData(s,{month:'2026-09'});assert.equal(d.stats.videoCount,781);assert.equal(deriveData(s).stats.videoCount,797);assert.equal(d.videos.length,797);assert.equal(d.stats.itemsSold,1789);assert.equal(d.stats.views,8342185);assert.equal(d.stats.historicalViewsReference,8332807);assert.equal(d.stats.gmv,18250.22);assert.ok(d.creators.length<1500);assert.equal(s.promotions.length,112);assert.ok(d.allSamples.length>=1944);});
