import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyState,deriveData} from '../lib/creator-engine.mjs';

const video=(changes={})=>({videoId:'7000000000000000001',productId:'P1',creatorId:'creator',postDate:'2026-06-15',reportMonth:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',itemsSold:10,views:100,url:'https://www.tiktok.com/@creator/video/7000000000000000001',...changes});
const baseline=(records)=>({id:'history',active:true,cutoffDate:'2026-09-30',records});

test('June publications count independently of October sales and sample records',()=>{
 const state=createEmptyState();state.creators=[{creatorId:'creator'}];state.videos=[video()];
 const june=deriveData(state,{month:'2026-06'}),october=deriveData(state,{month:'2026-10'}),all=deriveData(state);
 assert.equal(june.stats.videoCount,1);assert.equal(june.stats.itemsSold,0);assert.equal(june.stats.views,null);assert.equal(june.stats.historicalViewsReference,100);assert.equal(june.stats.sampleCount,0);
 assert.equal(june.creators[0].videoCount,1);assert.equal(june.creators[0].cooperationCount,0);
 assert.equal(june.promotions[0].videoCount,1);assert.equal(june.promotions[0].itemsSold,0);assert.equal(june.promotions[0].month,'2026-06');
 assert.ok(june.months.includes('2026-06'));assert.equal(october.stats.videoCount,0);assert.equal(october.stats.itemsSold,10);assert.equal(october.stats.views,100);
 assert.equal(october.stats.promotionVideoCount,0);assert.equal(october.stats.promotionItemsSold,null);assert.equal(all.stats.videoCount,1);assert.equal(all.stats.itemsSold,10);
});

test('historical baseline supplies publication dates without inventing historical monthly sales',()=>{
 const state=createEmptyState();state.videoBaselines=[baseline([video({itemsSold:500})])];state.videoReportArchives=[{id:'old',records:[video({reportMonth:'2026-09',periodStart:'2026-09-01',periodEnd:'2026-09-30',itemsSold:40})]}];
 const june=deriveData(state,{month:'2026-06'}),september=deriveData(state,{month:'2026-09'}),all=deriveData(state);
 assert.equal(june.stats.videoCount,1);assert.equal(june.stats.itemsSold,0);assert.equal(june.promotions[0].videoCount,1);
 assert.equal(september.stats.videoCount,0);assert.equal(september.stats.itemsSold,40);assert.equal(all.stats.itemsSold,500);assert.equal(all.stats.videoCount,1);
});

test('repeated reports and multiple PID rows count one video globally and once per PID',()=>{
 const state=createEmptyState();state.creators=[{creatorId:'creator'}];state.videos=[video(),video({productId:'P2',itemsSold:20}),video({reportMonth:'2026-11',periodStart:'2026-11-01',periodEnd:'2026-11-30',itemsSold:5})];
 const june=deriveData(state,{month:'2026-06'}),all=deriveData(state);
 assert.equal(june.stats.videoCount,1);assert.equal(june.creators[0].videoCount,1);assert.deepEqual(june.promotions.map(row=>[row.productId,row.videoCount]).sort(),[['P1',1],['P2',1]]);
 assert.equal(all.stats.videoCount,1);assert.equal(all.stats.itemsSold,35);assert.equal(all.stats.views,200);assert.equal(all.stats.historicalViewsReference,100);
});

test('active pending and archived publication records count without adding sales or creating managed creators',()=>{
 const state=createEmptyState();state.pendingVideoImports=[{id:'pending',status:'period_unconfirmed',records:[video({itemsSold:999})]},{id:'dismissed',status:'dismissed',records:[video({videoId:'discarded'})]},{id:'rejected',status:'rejected',records:[video({videoId:'rejected'})]},{id:'inactive',active:false,status:'period_unconfirmed',records:[video({videoId:'inactive'})]}];state.videoReportArchives=[{id:'archive',records:[video({videoId:'archived',itemsSold:888})]}];
 const all=deriveData(state),june=deriveData(state,{month:'2026-06'});
 assert.equal(all.stats.videoCount,2);assert.equal(june.stats.videoCount,2);assert.equal(all.stats.itemsSold,0);assert.equal(all.stats.views,100);assert.equal(all.stats.historicalViewsReference,200);assert.equal(all.creators.length,0);
 assert.equal(june.promotions[0].videoCount,2);assert.equal(june.promotions[0].itemsSold,0);
});

test('missing or invalid publication dates stay in all-month counts and are never inferred from sales or samples',()=>{
 const state=createEmptyState();state.creators=[{creatorId:'creator'}];state.videos=[video({postDate:''}),video({videoId:'invalid-date',postDate:'2026-02-30'})];state.samples=[{creatorId:'creator',productId:'P1',orderId:'O1',date:'2026-10-01',quantity:1,videoLinks:['https://www.tiktok.com/@creator/video/7000000000000000009']}];
 const all=deriveData(state),october=deriveData(state,{month:'2026-10'});
 assert.equal(all.stats.videoCount,2);assert.equal(all.stats.undatedVideoCount,2);assert.equal(october.stats.videoCount,0);assert.equal(october.stats.undatedVideoCount,2);assert.equal(october.stats.itemsSold,20);
 assert.equal(all.creators[0].videoCount,2);assert.equal(all.creators[0].allVideoCount,3);assert.equal(all.stats.matchedSamples,1);
});

test('unresolved PID and creator do not hide a dated publication from the global count',()=>{
 const state=createEmptyState();state.videos=[video({productId:'',creatorId:'',excludedFromMetrics:true,videoId:'',url:'https://www.tiktok.com/@unknown/video/7000000000000000008'})];
 const june=deriveData(state,{month:'2026-06'});assert.equal(june.stats.videoCount,1);assert.equal(june.stats.itemsSold,0);assert.equal(june.creators.length,0);assert.equal(june.promotions.length,0);assert.equal(june.publicationVideos[0].videoId,'7000000000000000008');
});

test('conflicting snapshots choose one explicit date deterministically and retain known dates across blank rows',()=>{
 const state=createEmptyState();state.videos=[video({postDate:'2026-07-12'}),video({productId:'P2',postDate:'2026-07-09'}),video({productId:'P3',postDate:''})];state.videoBaselines=[baseline([video({postDate:'2026-06-15'})])];
 const all=deriveData(state);assert.equal(all.stats.videoCount,1);assert.equal(all.stats.undatedVideoCount,0);assert.ok(all.allPublicationVideos.every(row=>row.postDate==='2026-07-09'));assert.equal(all.issues.filter(issue=>issue.type==='conflictingVideoPostDate').length,1);
 assert.equal(deriveData(state,{month:'2026-06'}).stats.videoCount,0);assert.equal(deriveData(state,{month:'2026-07'}).stats.videoCount,1);
 const reversed={...state,videos:[...state.videos].reverse()};assert.deepEqual(deriveData(reversed).allPublicationVideos,all.allPublicationVideos);
 state.videos=state.videos.map(row=>({...row,postDate:''}));assert.equal(deriveData(state,{month:'2026-06'}).stats.videoCount,1);
});
