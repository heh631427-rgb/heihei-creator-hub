/** Pure data transformations for the SPSIL creator workbench. No network or browser state. */
import { deriveVideoViews, summarizeVideoViews, parseVideoViewCount, preserveReplacedVideoViews } from './video-views.mjs';
import { deriveMonthlyPublicationPerformance, summarizePublicationPerformance } from './monthly-promotion.mjs';
export const typeLabels = { orders: 'All Orders / 发样订单', samples: '收样记录', products: 'SKU / PID 对照表', videos: 'Video Analysis', creators: '达人分层管理', preferences: '达人带货倾向', promotions: '月度推广记录' };
const F=(key,label,aliases=[],kind='text',required=false)=>({key,label,aliases,kind,required});
const creatorField=()=>F('creatorId','达人 ID',['Creator','Creator name','Creator ID','达人ID','达人账号','TikTok ID','Username','Creator Handle'],'creator');
const orderField=()=>F('orderId','订单 ID',['Order ID','订单号','订单ID'],'id');
const skuField=()=>F('sku','商家 SKU',['Seller SKU','SKU Name','样品SKU','SKU','SKU系列'],'text');
const skuIdField=()=>F('skuId','平台 SKU ID',['SKU ID','样品ID','平台SKU'],'id');
const pidField=()=>F('productId','产品 PID',['Product ID','PID','产品ID','商品ID'],'id');
const quantityField=()=>F('quantity','发样数量',['Quantity','发样数量','样品数量','数量'],'number');
const contactFields=[F('creatorName','达人姓名',['达人名字','Recipient','收件人']),F('phone','电话 / WhatsApp',['Phone #','Phone','电话/wasp','联系电话']),F('email','邮箱',['Email']),F('postcode','邮编',['Zipcode','Postal Code','邮编']),F('region','自治区',['Autonomous Community','地址 Autonomous Community','自治区']),F('province','省',['Province']),F('city','城市',['City']),F('street','街道',['Street Name']),F('house','门牌',['House Name or Number'])];
export const fieldSchemas={
 orders:[orderField(),skuIdField(),skuField(),pidField(),F('creatorId','达人账号（Buyer Username）',['Buyer Username','买家账号','买家用户名','Creator name','Creator ID','Creator','达人ID','Recipient Creator ID'],'creator'),F('buyerUsername','Buyer Username 来源账号',['Buyer Username','买家账号','买家用户名'],'creator'),F('attributedCreatorId','销售归因达人（仅来源）',['Creator Handle'],'creator'),F('productName','商品名称',['Product Name','产品名称']),F('variation','规格',['Variation']),quantityField(),F('orderType','订单类型',['Normal or Pre-order','订单类型']),F('status','订单状态',['Order Status','订单状态']),F('substatus','订单子状态',['Order Substatus','订单子状态']),F('cancelReturnType','退款 / 取消类型',['Cancelation/Return Type','Cancellation/Return Type','退款类型']),F('createdAt','下单日期',['Created Time','Order Date','日期'],'date'),F('shippedAt','发货日期',['Shipped Time','发货日期'],'date'),F('deliveredAt','签收日期',['Delivered Time','签收日期'],'date'),F('trackingId','物流单号',['Tracking ID','Tracking Number','物流单号'],'id'),F('carrier','物流商',['Shipping Provider Name','Carrier']),F('orderAmount','订单支付金额',['Order Amount','Paid Amount'],'number'),F('refundAmount','退款金额',['Order Refund Amount'],'number'),...contactFields,F('notes','备注',['Seller Note','备注'])],
 samples:[F('manualRecordId','手工记录 ID',['手工记录ID','Manual record ID'],'id'),F('date','发样日期',['日期','发样日期','Sample Date'],'date'),creatorField(),orderField(),skuIdField(),skuField(),pidField(),F('productName','商品名称',['Product Name','产品名称']),quantityField(),...contactFields,F('logisticsUpdated','是否更新物流',['是否更新物流']),F('received','是否收到样品',['是否收到样品','Received','收样状态']),F('contacted','是否联系申样',['是否联系申样']),F('videoUpdateDate','更新视频日期',['更新视频日期'],'date'),F('videoNotes','视频备注',['视频备注']),F('style','视频特点 / 风格',['视频特点/风格','视频风格']),F('historicalItemsSold','历史表卖出个数',['卖出个数','历史卖出个数','历史累计出单(参考)','Items sold'],'number'),F('notes','后续合作沟通 / 备注',['后续合作沟通','备注','Notes']),F('url','视频链接 1',['视频链接','Video link','Video URL'],'url'),F('url2','视频链接 2',['视频链接2','Video link 2'],'url'),F('url3','视频链接 3',['视频链接3','Video link 3'],'url'),F('videoLinks','全部视频链接',['全部视频链接','已确认视频链接','全部已确认视频链接','All video links'],'url'),F('adCode1','广告码 1',['ad code1','ad code']),F('adCode2','广告码 2',['ad code2'])],
 products:[pidField(),skuIdField(),skuField(),F('productName','商品名称',['Product Name','产品名称','商品名称'])],
 videos:[F('videoId','视频 ID',['Video ID','视频ID'],'id'),F('url','视频链接',['Video link','Video URL','视频链接'],'url'),creatorField(),pidField(),skuIdField(),skuField(),F('title','视频标题',['Video title','标题']),F('postDate','视频发布日期',['Post date','发布日期'],'date'),F('itemsSold','带货件数',['Video-attributed items sold','Items sold','卖出个数','视频出单量'],'number'),F('orders','归因订单数',['Video-attributed orders','Orders'],'number'),F('gmv','归因 GMV',['Affiliate video-attributed GMV','GMV (€)','GMV'],'number'),F('views','期间播放量',['Video views','Views','播放量','视频观看次数','视频播放量'],'number'),F('viewsPeriodStart','播放统计开始',['Views Period Start','播放统计开始日期','播放统计开始'],'date'),F('viewsPeriodEnd','播放统计结束',['Views Period End','播放统计结束日期','播放统计结束'],'date'),F('likes','点赞',['Likes'],'number'),F('comments','评论',['Comments'],'number'),F('shares','分享',['Shares'],'number'),F('impressions','商品曝光',['Video product impressions'],'number'),F('clicks','商品点击',['Video product clicks'],'number'),F('refunds','退款金额',['Refunds'],'number'),F('itemsRefunded','退款件数',['Items refunded'],'number'),F('completionRate','完播率',['Completion rate'],'number'),F('ctr','点击率',['CTR'],'number'),F('commission','预估佣金',['Est. commission'],'number'),F('salesDate','出单日期',['出单日期','出单月份','销售日期','Sales date','统计日期'],'text'),F('reportMonth','统计月份',['统计月份','Report Month','月份'],'month'),F('periodStart','统计开始',['Period Start','统计开始'],'date'),F('periodEnd','统计结束',['Period End','统计结束'],'date'),F('style','视频风格',['视频特点/风格','Style']),F('tendency','带货倾向',['带货倾向','Preferences'])],
 creators:[creatorField(),F('historicalItemsSold','历史 Items sold',['Items sold','求和items sold','卖出个数','历史累计出单(参考)','历史累计销量'],'number'),F('historicalGmv','历史 GMV',['GMV (€)','GMV'],'number'),F('historicalPriority','原优先级',['优先级','等级','达人等级']),F('style','视频特点 / 风格',['视频特点/风格','视频风格','Style']),F('historicalAverageViews','历史平均播放量',['平均播放量','Average views'],'number'),F('willingness','配合意愿度',['配合意愿度','配合愿意度','合作意愿','合作意愿度','合作配合意愿','Willingness']),F('selfPurchasedSampleQuantity','自购样品数量（手工）',['自购样品数量','自购样品数量(手工)','手工自购样品数量','Self purchased sample quantity'],'number'),F('selfPurchaseNotes','自购样品备注',['自购样品备注','自购依据','Self purchase notes']),F('notes','备注',['备注','Notes']),F('tendency','带货倾向',['带货倾向','Preferences'])],
 preferences:[creatorField(),F('tendency','带货倾向',['带货倾向','偏好品类','Preferences']),F('style','视频特点 / 风格',['视频特点/风格','视频风格']),F('latestViews','达人视频均播放量',['播放量','Views','Video views','最新播放量','当前播放量','达人视频均播放量','视频均播放量','平均播放量','Avg video views','Average video views'],'number'),F('latestViewsAsOf','播放量更新日期',['播放量更新日期','播放量统计日期','统计日期','Updated date'],'date'),F('notes','备注',['备注','Notes'])],
 promotions:[pidField(),skuField(),F('month','月份',['月份','Month'],'month'),F('sampleQuantity','历史发样数量',['发样数量','月发样数量','Sample quantity'],'number'),F('itemsSold','历史视频带货件数',['视频出单情况Items sold','Items sold','月视频出单情况Items sold'],'number'),F('url','爆款视频链接',['是否有爆款视频','视频链接','爆款视频'],'url'),F('sellingCreators','出单达人',['出单达人ID','出单达人','Selling creators'],'list'),F('notes','推广备注',['备注','Notes'])]
};
export const defaultSettings={
 rules:[
  {id:'excellent-volume',level:5,label:'优秀达人',minSold:60,maxSold:null,minCollaborations:0,enabled:true},
  {id:'excellent-repeat',level:5,label:'优秀达人',minSold:51,maxSold:null,minCollaborations:2,enabled:true},
  {id:'repeat-20',level:4,label:'可合作达人',minSold:20,maxSold:50,minCollaborations:2,enabled:true},
  {id:'repeat-11',level:3,label:'成长达人',minSold:11,maxSold:19,minCollaborations:2,enabled:true},
  {id:'repeat-10',level:2,label:'继续观察',minSold:10,maxSold:10,minCollaborations:2,enabled:true},
  {id:'under-10',level:1,label:'待培育',minSold:0,maxSold:9,minCollaborations:0,enabled:true}
 ],
 cooperationBasis:'sampleQuantity',creatorViewsSource:'preferences',useHistoricalFallback:false,
 orderFilter:{mode:'exclude_normal',excludeNormal:true,excludeRefunded:true,excludeCancelled:true,allowBlankFromSampleSheet:true,allowBlankType:true},
 representativeSkus:{},viralMinSold:5,successfulSampleMinSold:10,videoOnlyCreatorMinSold:10,selfPurchaseDefaultQuantity:1,
 willingnessOptions:['未沟通','高','低','随性'],defaultWillingness:'未沟通',monthlyPromotionPublicationStart:'2026-09'
};
/** Old workspaces have no willingness settings. Reading defaults never rewrites profiles. */
export function getWillingnessConfig(stateOrSettings={}){
 const settings=stateOrSettings&&typeof stateOrSettings==='object'&&!Array.isArray(stateOrSettings)?(stateOrSettings.settings||stateOrSettings):{};
 const configured=Array.isArray(settings.willingnessOptions)?settings.willingnessOptions:defaultSettings.willingnessOptions;
 const options=[...new Set(configured.filter(value=>typeof value==='string').map(value=>value.trim()).filter(Boolean))];
 if(!options.length)options.push(...defaultSettings.willingnessOptions);
 const requested=typeof settings.defaultWillingness==='string'?settings.defaultWillingness.trim():'';
 const defaultValue=options.includes(requested)?requested:options.includes(defaultSettings.defaultWillingness)?defaultSettings.defaultWillingness:options[0];
 return {options,defaultValue};
}
export function createEmptyState(){return {schemaVersion:1,samples:[],orders:[],productMappings:[],videos:[],videoBaselines:[],pendingVideoImports:[],videoReportArchives:[],videoViewMaxima:[],creators:[],preferences:[],promotions:[],imports:[],settings:structuredClone(defaultSettings)};}
export function stableKey(...parts){return parts.map(x=>encodeURIComponent(String(x??'').trim())).join('|');}
export function normalizeCreator(value){let s=cleanText(value);const match=s.match(/(?:tiktok\.com\/)?@([^/?\s#]+)/i);if(match)s=match[1];return s.replace(/^@/,'').replace(/\s+/g,'').toLowerCase();}
function cleanText(value){if(value===null||value===undefined)return '';let s=String(value).trim().replace(/^'/,'');return /^(#N\/A|#VALUE!|#REF!|#DIV\/0!|nan|undefined|null)$/i.test(s)?'':s;}
/** A compound product cell is evidence to review, never a synthetic PID or a
 * license to allocate all of a video's sales to one of its linked products. */
export function normalizeVideoProduct(input){
 const row={...input},source=input.productId||input.rawProductIds,values=Array.isArray(source)?source:[source];
 const tokens=[...new Set(values.flatMap(value=>cleanText(value).split(/[,，;；|\n\r]+/)).map(cleanText).filter(Boolean))];
 if(tokens.length>1){
  row.sourceProductId=input.sourceProductId??input.productId??tokens.join(',');row.rawProductIds=tokens;row.productId='';row.productMatch='ambiguous';row.productReviewRequired=true;
  if(row.skuId)row.sourceSkuId=row.skuId;if(row.sku)row.sourceSku=row.sku;row.skuId='';row.sku='';
 }else row.productId=tokens[0]||'';
 row.excludedFromMetrics=!row.productId;
 return row;
}
function normalizedHeader(value){return cleanText(value).toLowerCase().replace(/[\s_\-\/()（）#€:：.]/g,'');}
export function parseNumber(value){
 if(typeof value==='number')return Number.isFinite(value)?value:0;
 let s=cleanText(value);if(!s)return 0;const neg=/^\(.*\)$/.test(s);s=s.replace(/[^\d,.+\-]/g,'');
 if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
 else if(s.includes(',')){s=/^[+-]?\d{1,3}(,\d{3})+$/.test(s)?s.replace(/,/g,''):s.replace(',','.');}
 else if(/^[+-]?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
 const n=Number(s);return Number.isFinite(n)?(neg?-Math.abs(n):n):0;
}
function optionalNumber(value){if(value===null||value===undefined||cleanText(value)===''||!/[0-9]/.test(String(value)))return null;return typeof value==='number'&&!Number.isFinite(value)?null:Math.max(0,parseNumber(value));}
function videoGmvAmount(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 const candidate=cleanText(value).replace(/(?:EUR|USD|GBP|€|£|\$)/gi,'').replace(/\s+/g,'');
 if(!/^\(?[+-]?(?:\d[\d.,]*|\.\d+)\)?$/.test(candidate))return null;
 const amount=parseNumber(candidate);return Number.isFinite(amount)?amount:null;
}
function creatorGmvSummary(rows){
 const eligible=rows.filter(row=>{if(row.reportKind==='historicalBaseline')return true;if(row.reportPurpose==='publication'||row.publicationOnly||row.pendingPeriod)return false;const period=videoPeriod(row);return !!parseDate(period.start)&&!!parseDate(period.end)&&period.start<=period.end;});
 const values=eligible.map(row=>videoGmvAmount(row.gmv)).filter(value=>value!==null);
 // Each export amount is monetary: aggregate integer cents rather than adding
 // binary fractions repeatedly, and retain the distinction between missing and 0.
 const cents=values.reduce((total,value)=>total+Math.round((value+Math.sign(value)*Number.EPSILON*Math.max(1,Math.abs(value)))*100),0);
 const cutoff=eligible.filter(row=>row.reportKind==='historicalBaseline').map(row=>row.baselineCutoff).filter(Boolean).sort().at(-1)||'';
 return {lifetimeGmv:values.length?cents/100:null,gmvAvailable:values.length>0,gmvCoverageStatus:!values.length?'unavailable':values.length<eligible.length?'partial':'complete',gmvRecordCount:values.length,gmvMissingRecords:eligible.length-values.length,gmvSource:values.length?`Affiliate video-attributed GMV；${cutoff?`历史底表截至 ${cutoff} + `:''}出单视频报表已确认销售期间累计`:'暂无已提供 GMV 的历史底表或已确认销售期间记录'};
}
function optionalQuantity(value){if(value===null||value===undefined||cleanText(value)===''||!/[0-9]/.test(String(value)))return null;const number=parseNumber(value);return Number.isSafeInteger(number)&&number>=0?number:null;}
function viewSnapshot(record,context={}){
 const value=optionalNumber(record.latestViews);if(value===null)return {};
 const at=context.importedAt||context.at||record.latestViewsUpdatedAt||new Date().toISOString();
 return {latestViews:value,latestViewsAsOf:record.latestViewsAsOf||parseDate(at),latestViewsUpdatedAt:at,latestViewsSource:record.latestViewsSource||record.sourceFile||context.sourceName||context.fileName||'西班牙达人带货倾向'};
}
export function parseDate(value,dateFormat='mdy'){
 if(value instanceof Date)return Number.isNaN(+value)?'':value.toISOString().slice(0,10);
 if(typeof value==='number'&&value>20000&&value<100000)return new Date(Date.UTC(1899,11,30)+Math.round(value*86400000)).toISOString().slice(0,10);
 let s=cleanText(value);if(!s)return '';let m=s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
 if(m)return validDate(+m[1],+m[2],+m[3]);
 m=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);if(m){let a=+m[1],b=+m[2];const dmy=a>12?true:b>12?false:dateFormat==='dmy';return validDate(+m[3],dmy?b:a,dmy?a:b);}
 return '';
}
function validDate(y,m,d){const z=new Date(Date.UTC(y,m-1,d));return z.getUTCFullYear()===y&&z.getUTCMonth()===m-1&&z.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:'';}
export function parseMonth(value){const s=cleanText(value),compact=s.match(/(20\d{2})(0[1-9]|1[0-2])(?:[0-3]\d)/);if(compact)return `${compact[1]}-${compact[2]}`;const m=s.match(/(20\d{2})[./\-年]?(\d{1,2})(?:月|\b|[-/])/);return m&&+m[2]>0&&+m[2]<=12?`${m[1]}-${m[2].padStart(2,'0')}`:'';}
function monthBounds(month){if(!/^\d{4}-\d{2}$/.test(month))return {start:'',end:''};const [y,m]=month.split('-').map(Number);return {start:`${month}-01`,end:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};}
/** Sales periods describe when the sales happened, independently of video post
 * dates. Month-only entries require an explicitly supplied year from the UI. */
export function parseSalesPeriod(value,context={}){
 const period=(start,end)=>start&&end&&start<=end?{periodStart:start,periodEnd:end,reportMonth:start.slice(0,7)===end.slice(0,7)?start.slice(0,7):''}:null;
 if(value instanceof Date){const date=parseDate(value);return period(date,date);}
 if(typeof value==='number'||/^\d{5}(?:\.\d+)?$/.test(cleanText(value))){const number=Number(value);if(number>20000&&number<100000){const date=parseDate(number);return period(date,date);}return null;}
 const text=cleanText(value).replace(/\s+/g,' ').trim();if(!text)return null;
 const range=text.match(/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:至|到|~|～|—|–|\s-\s)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})$/);
 if(range)return period(parseDate(range[1]),parseDate(range[2]));
 if(/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(text)){const date=parseDate(text);return period(date,date);}
 let month=text.match(/^(\d{4})[-/.年](\d{1,2})月?$/),year,number;
 if(month){year=Number(month[1]);number=Number(month[2]);}
 else {month=text.match(/^(\d{1,2})月$/);if(!month||!/^\d{4}$/.test(String(context.reportYear??'')))return null;year=Number(context.reportYear);number=Number(month[1]);}
 if(year<1000||year>9999||number<1||number>12)return null;
 const key=`${year}-${String(number).padStart(2,'0')}`,bounds=monthBounds(key);return period(bounds.start,bounds.end);
}
function extractUrls(value){const values=Array.isArray(value)?value:[value];const out=[];for(const v of values){const found=cleanText(v).match(/https?:\/\/[^\s<>"，；]+/g)||[];for(const u of found){try{const parsed=new URL(u);if(/^https?:$/.test(parsed.protocol))out.push(u.replace(/[),;。]+$/,''));}catch{}}}return [...new Set(out)];}
function videoIdFromUrl(url){return cleanText(url).match(/\/video\/(\d+)/)?.[1]||'';}
export function videoIdsFromLinks(value){return [...new Set(extractUrls(value).map(videoIdFromUrl).filter(Boolean))];}
function idString(value,key,warnings,row){const s=cleanText(value);if(!s)return '';if((typeof value==='number'&&!Number.isSafeInteger(value))||/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(s)){warnings.push(`第 ${row} 行 ${key} 使用了不精确的数字 / 科学计数法，已留空；请将原始 ID 列设为文本。`);return '';}return s.replace(/^(\d+)\.0+$/,'$1');}
export function detectType(headers,sheetName=''){
 const name=normalizedHeader(sheetName);const hs=headers.map(normalizedHeader);const has=x=>hs.includes(normalizedHeader(x));
 if(/videoanalysis|视频出单|sheet1视频链接/.test(name)||has('Video ID'))return 'videos';
 if(/带货倾向/.test(name)&&!has('Items sold'))return 'preferences';
 if(/分层管理/.test(name)||(has('Creator')&&has('视频特点/风格')))return 'creators';
 if(/收样/.test(name)||has('是否收到样品'))return 'samples';
 if(/推广20/.test(name)||hs.some(x=>/月发样数量/.test(x)))return 'promotions';
 if(has('Order Substatus')||has('Normal or Pre-order')||/allorders|发样订单/.test(name))return 'orders';
 if((has('Product ID')&&has('SKU ID'))||/产品id|pid表/.test(name))return 'products';
 if(has('达人ID')&&has('带货倾向'))return 'preferences';
 return 'samples';
}
export function guessMappings(headers,type){
 const hs=headers.map(normalizedHeader),used=new Set(),mapping={};
 for(const field of fieldSchemas[type]||[]){const candidates=[field.label,field.key,...field.aliases,...(type==='orders'&&field.key==='creatorId'?['达人账号']:[])].map(normalizedHeader);let index=hs.findIndex((h,i)=>h&&candidates.includes(h)&&!used.has(i));
  if(index<0&&type==='promotions'&&['sampleQuantity','itemsSold'].includes(field.key))index=hs.findIndex((h,i)=>!used.has(i)&&(field.key==='sampleQuantity'?/月发样数量/.test(h):/月(?:视频)?出单情况itemssold/.test(h)));
  mapping[field.key]=index<0?'':String(index);if(index>=0)used.add(index);
 }
 // This workspace's All Orders export identifies the sample recipient in
 // Buyer Username. Preserve the source and identity even when they share a column.
 if(type==='orders'){
  const buyers=hs.map((header,index)=>isBuyerUsernameHeader(header)?index:-1).filter(index=>index>=0);
  if(buyers.length===1)mapping.creatorId=mapping.buyerUsername=String(buyers[0]);
  else if(buyers.length>1)mapping.creatorId=mapping.buyerUsername='';
 }
 return mapping;
}
export function normalizeRows(type,rows,mapping,context={}){
 const records=[],warnings=[];let rejected=0;const schema=fieldSchemas[type]||[];
 const dateFormats={};for(const f of schema.filter(f=>f.kind==='date')){const col=mapping[f.key];if(col===''||col===undefined)continue;let mdy=0,dmy=0;for(const raw of rows){const values=Array.isArray(raw)?raw:raw.values||[];const m=cleanText(values[Number(col)]).match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{4}/);if(m){if(+m[1]>12&&+m[2]<=12)dmy++;if(+m[2]>12&&+m[1]<=12)mdy++;}}dateFormats[f.key]=context.dateFormat&&context.dateFormat!=='auto'?context.dateFormat:dmy>mdy?'dmy':'mdy';if(mdy&&dmy)warnings.push(`${f.label} 列同时出现日/月和月/日格式，日期需复核。`);if(context.dateFormat==='dmy'&&mdy&&!dmy)warnings.push(`${f.label} 列存在月/日格式证据，建议将日期格式设为“自动”或“月/日/年”。`);}
 for(let ri=0;ri<rows.length;ri++){
  const input=Array.isArray(rows[ri])?rows[ri]:(rows[ri].values||[]);if(!input.some(v=>cleanText(v)))continue;const rowNo=(context.headerRow??0)+ri+2;
  const rec={sourceFile:context.sourceName||context.fileName||'',sourceSheet:context.sheetName||'',sourceRow:rowNo};let meaningful=false;
  for(const f of schema){const col=mapping[f.key];if(col===''||col===undefined||col===null||Number(col)<0)continue;const val=input[Number(col)];if(cleanText(val)==='')continue;meaningful=true;
   if(type==='videos'&&f.key==='views'){const value=parseVideoViewCount(val);if(value===null){warnings.push(`第 ${rowNo} 行播放量不是有效的非负数，未当作 0 计入。`);continue;}rec.views=value;continue;}
   if(type==='videos'&&f.key==='gmv'){const value=videoGmvAmount(val);if(value===null){warnings.push(`第 ${rowNo} 行 Affiliate video-attributed GMV 不是有效金额，保留为未提供，未当作 0。`);continue;}rec.gmv=value;continue;}
   rec[f.key]=f.kind==='id'?idString(val,f.label,warnings,rowNo):f.kind==='number'?parseNumber(val):f.kind==='date'?parseDate(val,dateFormats[f.key]):f.kind==='creator'?normalizeCreator(val):f.kind==='month'?parseMonth(val):f.kind==='list'?cleanText(val).split(/[\n,，;；]+/).map(normalizeCreator).filter(Boolean):cleanText(val);
   if(f.kind==='date'&&!rec[f.key]&&!/^[-—\s]+$/.test(cleanText(val)))warnings.push(`第 ${rowNo} 行「${f.label}」无法识别日期，记录保留，但该日期不会计入月度统计。`);
  }
  if(!meaningful)continue;
  if(type==='orders'){
   const creatorColumn=mapping.creatorId,hasCreatorColumn=creatorColumn!==''&&creatorColumn!==undefined&&creatorColumn!==null;
   const columnName=hasCreatorColumn?cleanText(context.headers?.[Number(creatorColumn)]):'';
   const buyerColumn=hasCreatorColumn&&((mapping.buyerUsername!==''&&mapping.buyerUsername!==undefined&&String(creatorColumn)===String(mapping.buyerUsername))||isBuyerUsernameHeader(columnName));
   const buyerPosition=buyerColumn?creatorColumn:mapping.buyerUsername;
   if(buyerPosition!==''&&buyerPosition!==undefined&&buyerPosition!==null){const raw=cleanText(input[Number(buyerPosition)]);if(raw)rec.buyerUsernameRaw=raw;rec.buyerUsername=normalizeCreator(raw);}
   const attributionColumn=normalizedHeader(columnName)==='creatorhandle';
   if(attributionColumn&&rec.creatorId&&!rec.attributedCreatorId)rec.attributedCreatorId=normalizeCreator(rec.creatorId);
   if(buyerColumn||!Object.hasOwn(mapping,'creatorId')&&rec.buyerUsername){
    rec.creatorId=normalizeCreator(rec.buyerUsername||rec.creatorId);rec.creatorMappingSource='buyer-username';rec.creatorMappingColumn=buyerColumn?(columnName||'Buyer Username'):'Buyer Username';rec.creatorMappingRole='buyer';
   }else if(hasCreatorColumn){
    rec.creatorId=normalizeCreator(rec.creatorId);rec.creatorMappingSource='explicit-column';rec.creatorMappingColumn=columnName||String(creatorColumn);rec.creatorMappingRole='recipient';
   }else{
    rec.creatorId='';rec.creatorMappingSource=attributionColumn?'attribution-column':Object.hasOwn(mapping,'creatorId')?'explicit-unmapped':'unavailable';rec.creatorMappingColumn=columnName;rec.creatorMappingRole=attributionColumn?'attribution':'unavailable';
   }
   rec.creatorHandle=rec.creatorId;rec.date=rec.createdAt||'';
   rec.sourceType=(context.sampleSource||/发样订单|sample orders/i.test(context.sheetName||''))?'sample_orders':'all_orders';
   if(!validOrderRow(rec)){rejected++;continue;}
   if(!rec.orderType&&rec.sourceType!=='sample_orders')warnings.push(`第 ${rowNo} 行订单类型为空，将按当前“允许空订单类型”设置筛选；取消、退款和 Normal 仍按各自规则处理。`);
  }else if(type==='samples'){
   rec.creatorId=normalizeCreator(rec.creatorId);rec.videoLinks=[...new Set([...extractUrls(rec.url),...extractUrls(rec.url2),...extractUrls(rec.url3),...extractUrls(rec.videoLinks)])];rec.videoIds=videoIdsFromLinks(rec.videoLinks);delete rec.url;delete rec.url2;delete rec.url3;
   if(!rec.orderId&&!rec.creatorId){rejected++;continue;}if(!rec.skuId&&!rec.sku&&!rec.productId){rejected++;continue;}
  }else if(type==='products'){
   if(!rec.productId||(!rec.skuId&&!rec.sku)){rejected++;continue;}
  }else if(type==='videos'){
   rec.videoId=rec.videoId||videoIdFromUrl(rec.url);rec.creatorId=normalizeCreator(rec.creatorId||rec.url);
   if(!rec.videoId||!/^[A-Za-z0-9_-]+$/.test(rec.videoId)){rejected++;continue;}
   Object.assign(rec,normalizeVideoProduct(rec));
   if(rec.productReviewRequired)warnings.push(`第 ${rowNo} 行包含多个 Product ID，已保留原值等待核对；没有创建拼接 PID，也没有分摊销量。`);
   if(context.reportPurpose==='publication'){
    // A publication-filtered file describes which videos were posted. Its sales
    // cells remain observations, never another monthly sales contribution.
    rec.reportPurpose='publication';rec.publicationOnly=true;rec.pendingPeriod=false;
    rec.unconfirmedSourcePeriod=Object.fromEntries(['salesDate','reportMonth','periodStart','periodEnd'].filter(key=>cleanText(rec[key])).map(key=>[key,rec[key]]));
    rec.periodStart='';rec.periodEnd='';rec.reportMonth='';rec.salesDate='';
   }else{
    // A mapped sales date takes precedence over file-level choices. Never infer a
    // missing year from publication dates or from the execution clock.
    const rawSalesDate=mapping.salesDate!==''&&mapping.salesDate!==undefined&&mapping.salesDate!==null?input[Number(mapping.salesDate)]:undefined;
    const rawMonth=mapping.reportMonth!==''&&mapping.reportMonth!==undefined&&mapping.reportMonth!==null?input[Number(mapping.reportMonth)]:undefined;
    const hasSalesDate=cleanText(rawSalesDate)!=='',hasMonth=cleanText(rawMonth)!=='',rowPeriod=hasSalesDate?parseSalesPeriod(rawSalesDate,context):hasMonth?parseSalesPeriod(rawMonth,context):null;
    if((hasSalesDate||hasMonth)&&!rowPeriod){rejected++;warnings.push(`第 ${rowNo} 行「${hasSalesDate?'出单日期':'统计月份'}」无效；如填写“10月”，请明确选择统计年份。未使用视频发布日期或文件月份替代。`);continue;}
    if(hasSalesDate){Object.assign(rec,rowPeriod);}
    else {const bounds=monthBounds(parseMonth(context.month));rec.periodStart=rec.periodStart||rowPeriod?.periodStart||parseDate(context.rangeStart)||bounds.start;rec.periodEnd=rec.periodEnd||rowPeriod?.periodEnd||parseDate(context.rangeEnd)||bounds.end;rec.reportMonth=rec.periodStart&&rec.periodEnd&&rec.periodStart.slice(0,7)===rec.periodEnd.slice(0,7)?rec.periodStart.slice(0,7):'';}
    if(!rec.periodStart||!rec.periodEnd){if(context.allowUnconfirmedPeriod){rec.periodStart='';rec.periodEnd='';rec.reportMonth='';rec.pendingPeriod=true;warnings.push('未确认销售周期的视频仅暂存为发布事实和候选链接，不计入销量累计。');}else{rejected++;warnings.push(`第 ${rowNo} 行缺少视频统计周期，请选择统计月份。`);continue;}}
    if(rec.periodStart>rec.periodEnd){rejected++;warnings.push(`第 ${rowNo} 行统计结束日期早于开始日期。`);continue;}
    if(rec.periodStart.slice(0,7)!==rec.periodEnd.slice(0,7)){rec.reportMonth='';warnings.push('本次视频统计跨越多个月份，将保留周期总量，不会把完整总量归入其中一个月。需要月报时请分别导出每个月的数据。');}
    if(context.reportPurpose==='sales')rec.reportPurpose='sales';
   }
   if(context.reportPurpose!=='publication'&&context.viewsKind)rec.viewsKind=context.viewsKind;
   if(context.reportPurpose!=='publication'&&(context.viewsPeriodStart||context.viewsPeriodEnd)){rec.viewsPeriodStart=parseDate(context.viewsPeriodStart);rec.viewsPeriodEnd=parseDate(context.viewsPeriodEnd);rec.viewsKind='period';}
   if(rec.viewsPeriodStart||rec.viewsPeriodEnd){if(rec.viewsPeriodStart&&rec.viewsPeriodEnd&&rec.viewsPeriodStart<=rec.viewsPeriodEnd)rec.viewsKind='period';else{rec.viewsKind='unconfirmed';warnings.push(`第 ${rowNo} 行播放统计期间不完整或顺序错误，播放量未加入确认累计。`);}}
   if(!rec.productId)warnings.push(`第 ${rowNo} 行缺少 Product ID，视频保留但不会自动匹配收样。`);
   if(!rec.url&&rec.creatorId)rec.url=`https://www.tiktok.com/@${rec.creatorId}/video/${rec.videoId}`;
  }else if(type==='creators'||type==='preferences'){
   rec.creatorId=normalizeCreator(rec.creatorId);if(!rec.creatorId){rejected++;continue;}
   if(type==='creators'&&Object.hasOwn(rec,'selfPurchasedSampleQuantity')){
    const rawQuantity=input[Number(mapping.selfPurchasedSampleQuantity)],quantity=optionalQuantity(rawQuantity);
    if(quantity===null){delete rec.selfPurchasedSampleQuantity;warnings.push(`第 ${rowNo} 行自购样品数量需为非负整数，已保留原值或默认设置。`);}else rec.selfPurchasedSampleQuantity=quantity;
   }
   if(type==='preferences'){
    const rawViews=mapping.latestViews!==''&&mapping.latestViews!==undefined&&mapping.latestViews!==null?input[Number(mapping.latestViews)]:undefined;
    if(optionalNumber(rawViews)===null){delete rec.latestViews;delete rec.latestViewsAsOf;}
    else Object.assign(rec,viewSnapshot(rec,context));
   }
  }else if(type==='promotions'){
   rec.month=rec.month||parseMonth(context.month)||parseMonth(context.sheetName||'');rec.videoLinks=extractUrls(rec.url);delete rec.url;rec.historicalSnapshot=true;
   if(!rec.productId&&/^(公式说明|说明\s*[:：]|[A-Z]列\s|=)/i.test(rec.sku||'')){rejected++;continue;}
   if(rec.sku){rec.originalSku=rec.sku;rec.sku=rec.sku.replace(/系列\s*$/,'').trim();}
   if(!rec.productId&&!rec.sku){rejected++;continue;}if(!rec.month){rejected++;warnings.push(`第 ${rowNo} 行推广记录缺少月份。`);continue;}
  }
  if(['orders','samples'].includes(type)){rec.quantitySource=rec.quantity===undefined?'default':'provided';if(rec.quantity===undefined)rec.quantity=1;}
  rec.id=recordKey(type,rec);records.push(rec);
 }
 return {records,warnings:[...new Set(warnings)].slice(0,200),rejected};
}
function videoPeriod(r){if(r.reportKind==='historicalBaseline')return {start:'',end:r.baselineCutoff||r.periodEnd||''};const month=r.reportMonth||r.snapshotPeriod||r.month||'';const b=monthBounds(month);return {start:r.periodStart||r.rangeStart||b.start,end:r.periodEnd||r.rangeEnd||b.end};}
function manualSampleRecordId(r){const explicit=cleanText(r.manualRecordId);if(explicit)return explicit;return /^manual-/.test(cleanText(r.id))&&/手动|手工|manual/i.test(`${r.source||''} ${r.sourceType||''}`)?cleanText(r.id):'';}
function validOrderRow(r){const id=cleanText(r.orderId);return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)&&!/^(?:order.?id|unique.?order|platform|说明|公式)/i.test(id)&&!!(cleanText(r.skuId)||cleanText(r.sku)||cleanText(r.productId));}
function recordKey(type,r){
 if(type==='products')return stableKey('sku',r.skuId||`seller:${r.sku}`,r.skuId?'':r.productId);
 if(type==='videos'){const p=videoPeriod(r);return r.reportKind==='historicalBaseline'?stableKey('historicalBaseline',r.baselineId||p.end,r.videoId||videoIdFromUrl(r.url),r.productId||'unmapped'):stableKey(p.start,p.end,r.videoId||videoIdFromUrl(r.url),r.productId||'unmapped');}
 if(type==='creators'||type==='preferences')return normalizeCreator(r.creatorId||r.creator);
 if(type==='promotions')return stableKey(r.month,r.sku?`sku:${r.sku.replace(/系列\s*$/,'').trim()}`:r.productId);
 if(type==='samples'&&!r.orderId&&manualSampleRecordId(r))return stableKey('manual-record',manualSampleRecordId(r));
 return r.orderId?stableKey(r.orderId,r.skuId||r.sku||r.productId||'unknown'):stableKey('manual',normalizeCreator(r.creatorId),r.date,r.skuId||r.sku||r.productId);
}
function mergeNonBlank(old,incoming,context={}){
 const next={...old};const manual=new Set([...(old.manualFields||[]),...Object.keys(old._manual||{}).filter(k=>old._manual[k])]);
 for(const [key,value]of Object.entries(incoming)){if(value===undefined||value===null||value==='')continue;if(Array.isArray(value)&&value.length===0)continue;if((manual.has(key)||(key==='videoIds'&&manual.has('videoLinks')))&&!context.overwriteManual)continue;next[key]=value;}
 if(Array.isArray(old.manualFields)||Array.isArray(incoming.manualFields))next.manualFields=[...new Set([...(Array.isArray(old.manualFields)?old.manualFields:[]),...(Array.isArray(incoming.manualFields)?incoming.manualFields:[])])];
 if(old._manual||incoming._manual){next._manual={...old._manual,...incoming._manual};if(!context.overwriteManual)for(const key of Object.keys(old._manual||{}))if(old._manual[key])next._manual[key]=old._manual[key];}return next;
}
const collectionFor={orders:'orders',samples:'samples',products:'productMappings',videos:'videos',creators:'creators',preferences:'preferences',promotions:'promotions'};
function fallbackMatches(type,incoming,existing){
 if(type==='samples'||type==='orders')return incoming.orderId===existing.orderId&&((incoming.sku&&incoming.sku===existing.sku&&(!incoming.skuId||!existing.skuId))||(!incoming.sku&&!incoming.skuId&&incoming.productId&&incoming.productId===existing.productId));
  if(type==='videos'){if(incoming.productReviewRequired||existing.productReviewRequired)return false;const a=videoPeriod(incoming),b=videoPeriod(existing);return incoming.videoId===existing.videoId&&a.start===b.start&&a.end===b.end&&(!incoming.productId||!existing.productId);}
 if(type==='products')return incoming.sku&&incoming.sku===existing.sku&&incoming.productId===existing.productId&&(!incoming.skuId||!existing.skuId);
 if(type==='promotions')return incoming.month===existing.month&&incoming.productId&&incoming.productId===existing.productId&&(!incoming.sku||!existing.sku);
 return false;
}
function fallbackGroup(type,r){if(type==='samples'||type==='orders')return r.orderId||'';if(type==='videos'){const p=videoPeriod(r);return stableKey(p.start,p.end,r.videoId);}if(type==='products')return stableKey(r.sku,r.productId);if(type==='promotions')return stableKey(r.month,r.productId);return '';}
function activeBaselines(state){return (state.videoBaselines||[]).filter(report=>report.active!==false&&!['archived','superseded','dismissed'].includes(report.status));}
function baselineRows(state){return activeBaselines(state).flatMap(report=>(report.records||[]).map(row=>({...row,reportKind:'historicalBaseline',baselineId:report.id||report.cutoffDate,baselineCutoff:report.cutoffDate,periodStart:'',periodEnd:report.cutoffDate,reportMonth:'',sourceFile:row.sourceFile||report.fileName||'',sourceSheet:row.sourceSheet||report.sheetName||''})));}
/** Retain the former per-video maximum only as an explicit historical report
 * reference. Confirmed period totals are derived separately in video-views.mjs. */
function isPublicationOnly(report){return report.reportPurpose==='publication'||report.status==='publication_only'||report.publicationOnly===true;}
function videoViewSources(state,includePending=true){
 const rows=[...(Array.isArray(state.videoViewMaxima)?state.videoViewMaxima:[]),...(state.videos||[])];
 for(const report of activeBaselines(state))rows.push(...(report.records||[]),...(report.sourceDuplicateRows||[]));
 for(const report of state.videoReportArchives||[])if(!['dismissed','rejected','deleted'].includes(report.status))rows.push(...(report.records||[]),...(report.sourceDuplicateRows||[]));
 for(const report of state.pendingVideoImports||[])if((includePending||isPublicationOnly(report))&&report.active!==false&&!['confirmed','dismissed','archived','activated','rejected','deleted'].includes(report.status))rows.push(...(report.records||[]),...(report.sourceDuplicateRows||[]));
 return rows;
}
function collectVideoViewMaxima(rows,context={},previous=new Map()){
 const maxima=new Map(previous);for(const row of rows){
  if(!row||typeof row!=='object')continue;
  const videoId=cleanText(row.videoId)||videoIdFromUrl(row.url),views=optionalNumber(row.views);if(!videoId||views===null)continue;
  if(maxima.has(videoId)&&maxima.get(videoId).views>=views)continue;
  const entry={videoId,views};
  for(const key of ['sourceFile','sourceSheet','sourceRow','recordedAt']){const value=row[key]??(key==='sourceFile'?(context.sourceName||context.fileName):key==='sourceSheet'?context.sheetName:key==='recordedAt'?context.at:undefined);if(value!==undefined&&value!==null&&value!=='')entry[key]=value;}
  maxima.set(videoId,entry);
 }return maxima;
}
export function retainVideoViewMaxima(state,acceptedRows=[],context={}){
 const existing=collectVideoViewMaxima(videoViewSources(state,false));
 return {...state,videoViewMaxima:[...collectVideoViewMaxima(acceptedRows,context,existing).values()].sort((a,b)=>a.videoId.localeCompare(b.videoId))};
}
/** Whole-file replay detection is scoped to the worksheet. A different reporting
 * month must never turn the same uploaded bytes into another sales contribution. */
export function findDuplicateVideoImport(state,context={}){
 const sourceHash=cleanText(context.sourceHash||context.sha256);if(!sourceHash)return null;
 const sheetName=cleanText(context.sheetName||context.sourceSheet),targetBounds=videoPeriod({...context,reportMonth:context.month||context.reportMonth||''});
 const sources=[...(state.imports||[]).filter(r=>r.type==='videos'&&!['period_unconfirmed','pending','dismissed'].includes(r.status)),...activeBaselines(state).map(r=>({...r,type:'historicalBaseline'})),...(state.pendingVideoImports||[]).filter(r=>['confirmed','activated'].includes(r.status))];
 for(const source of sources){
  if(cleanText(source.sourceHash||source.sha256)!==sourceHash)continue;
  const sourceSheet=cleanText(source.sheetName||source.sourceSheet||source.records?.[0]?.sourceSheet);if(sourceSheet!==sheetName)continue;
  if(source.mappingSignature&&context.mappingSignature&&source.mappingSignature!==context.mappingSignature){
   const previousBounds=videoPeriod({...source,periodStart:source.periodStart||source.rangeStart||source.confirmedPeriodStart,periodEnd:source.periodEnd||source.rangeEnd||source.confirmedPeriodEnd,reportMonth:source.month||source.reportMonth||''});
   // An intentional mapping correction may replace the same interval, but cannot
   // relabel an old file as a new month to defeat replay protection.
   if(targetBounds.start&&targetBounds.end&&targetBounds.start===previousBounds.start&&targetBounds.end===previousBounds.end)continue;
  }
  return {id:source.id||'',fileName:source.fileName||source.sourceFile||'',sheetName:sourceSheet,type:source.type||'videos',sourceHash};
 }
 return null;
}
export function mergeImport(inputState,type,records,context={}){
 const state={...createEmptyState(),...inputState};state.settings={...structuredClone(defaultSettings),...(inputState.settings||{}),cooperationBasis:'sampleQuantity',creatorViewsSource:'preferences'};const collection=collectionFor[type];if(!collection)throw new Error('未知导入类型');
 let old=state[collection]||[],actualVideoPeriods=[];const acceptedVideoRows=[],warnings=[...(context.warnings||[])];const summary={added:0,updated:0,unchanged:0,rejected:context.rejected||0,warnings};
 if(type==='videos'){
  if(context.reportPurpose==='publication'||records.some(isPublicationOnly)){const err=new Error('发布视频报表只更新发布记录、播放量和候选链接，请选择发布视频导入方式；不能直接计入销量。');err.code='PUBLICATION_REPORT_NOT_SALES';throw err;}
  records=records.map(input=>{const row=normalizeVideoProduct(input),views=parseVideoViewCount(row.views);if(views===null)delete row.views;else row.views=views;row.viewsKind=row.viewsKind||context.viewsKind||'period';if(context.viewsPeriodStart||context.viewsPeriodEnd){row.viewsPeriodStart=parseDate(context.viewsPeriodStart);row.viewsPeriodEnd=parseDate(context.viewsPeriodEnd);row.viewsKind=row.viewsPeriodStart&&row.viewsPeriodEnd&&row.viewsPeriodStart<=row.viewsPeriodEnd?'period':'unconfirmed';}return row;});
  const incomingPeriods=[...new Map(records.map(r=>{const p=videoPeriod(r);return[`${p.start}/${p.end}`,p];})).values()];
  actualVideoPeriods=incomingPeriods;
  const onlyPeriod=incomingPeriods.length===1?incomingPeriods[0]:null,duplicate=findDuplicateVideoImport(state,{...context,periodStart:onlyPeriod?.start||'',periodEnd:onlyPeriod?.end||'',rangeStart:onlyPeriod?.start||'',rangeEnd:onlyPeriod?.end||'',month:'',reportMonth:''});
  if(duplicate){summary.unchanged=records.length;summary.duplicateFile=true;summary.duplicateSourceHash=duplicate.sourceHash;summary.duplicateOf=duplicate;warnings.push(`这份文件的「${duplicate.sheetName||'当前工作表'}」已导入，已跳过重复文件；不会再次累计销量。`);return {state,summary};}
  if(incomingPeriods.some(p=>!parseDate(p.start)||!parseDate(p.end)||p.start>p.end)){const err=new Error('视频销量需要明确且有效的统计起止日期；待确认期间的视频只能用于链接匹配。');err.code='MISSING_VIDEO_PERIOD';throw err;}
  if(incomingPeriods.some((period,i)=>incomingPeriods.slice(i+1).some(other=>period.start<=other.end&&period.end>=other.start))){const err=new Error('同一份导入包含互相重叠的不同统计周期，请先核对周期，避免把相同日期的销量重复累计。');err.code='OVERLAPPING_INCOMING_PERIODS';throw err;}
  const coveredBaselines=activeBaselines(state).filter(b=>b.cutoffDate&&incomingPeriods.some(p=>p.start<=b.cutoffDate));
  if(coveredBaselines.length){const err=new Error(`本次周期已包含在截至 ${coveredBaselines.map(b=>b.cutoffDate).join('、')} 的历史底表内。请导入截止日期之后的新周期；旧数据重复上传不会再次累计。`);err.code='BASELINE_PERIOD_OVERLAP';err.baselineIds=coveredBaselines.map(b=>b.id);throw err;}
  const overlaps=new Set();for(const r of old){const p=videoPeriod(r);if(incomingPeriods.some(n=>p.start&&p.end&&n.start<=p.end&&n.end>=p.start&&(n.start!==p.start||n.end!==p.end)))overlaps.add(`${p.start}/${p.end}`);}
  if(overlaps.size&&!context.replaceOverlapping){const err=new Error(`新视频统计周期与已有周期重叠：${[...overlaps].join('、')}。请改选相同周期，或明确选择替换重叠周期后导入。`);err.code='OVERLAPPING_PERIOD';err.periods=[...overlaps];throw err;}
  const partial=[...overlaps].filter(period=>{const [start,end]=period.split('/');return!incomingPeriods.some(n=>n.start<=start&&n.end>=end);});
  if(partial.length){const err=new Error(`新报告未完整覆盖已有统计周期：${partial.join('、')}。不能用其中一个月替换整段累计数据，请提供完整替代区间或不重叠的新周期。`);err.code='PARTIAL_PERIOD_REPLACEMENT';err.periods=partial;throw err;}
  if(overlaps.size){old=old.filter(r=>{const p=videoPeriod(r);return!overlaps.has(`${p.start}/${p.end}`);});warnings.push(`已用新数据替换 ${overlaps.size} 个重叠统计周期，避免重复累计。`);}
  if(context.replacePeriod){const exact=new Set(incomingPeriods.map(p=>`${p.start}/${p.end}`));old=old.filter(r=>{const p=videoPeriod(r);return!exact.has(`${p.start}/${p.end}`);});warnings.push('已按完整周期快照替换视频数据；缺失行按当前快照处理。');}
 }
 const map=new Map();for(const r of old){const k=recordKey(type,r);map.set(k,map.has(k)?mergeNonBlank(map.get(k),r):r);}const fallbackIndex=new Map();function indexRow(key,row){const group=fallbackGroup(type,row);if(!group)return;if(!fallbackIndex.has(group))fallbackIndex.set(group,new Set());fallbackIndex.get(group).add(key);}for(const [key,row]of map)indexRow(key,row);
 for(const input of records){let record={...input,...(type==='preferences'?viewSnapshot(input,context):{})},k=recordKey(type,record);if(type==='preferences'&&optionalNumber(input.latestViews)===null){for(const key of ['latestViews','latestViewsAsOf','latestViewsUpdatedAt','latestViewsSource'])delete record[key];}if(!k){summary.rejected++;continue;}let oldKey=k,existing=map.get(k);
  if(type==='samples'&&!existing&&manualSampleRecordId(record)){const manualId=manualSampleRecordId(record),matches=[...map].filter(([,row])=>manualSampleRecordId(row)===manualId);if(matches.length===1)[oldKey,existing]=matches[0];}
  if(!existing){const candidates=[...(fallbackIndex.get(fallbackGroup(type,record))||[])].map(key=>[key,map.get(key)]).filter(([,r])=>r&&fallbackMatches(type,record,r));if(candidates.length>1){summary.rejected++;warnings.push(`记录 ${record.orderId||record.videoId||record.sku||k} 缺少精确匹配键，找到多个候选，已跳过以免重复计数。`);continue;}if(candidates.length===1){[oldKey,existing]=candidates[0];record={...record,skuId:record.skuId||existing.skuId,sku:record.sku||existing.sku,productId:record.productId||existing.productId};k=recordKey(type,record);}}
  if(type==='videos'){record.reportPurpose='sales';record.publicationOnly=false;record.pendingPeriod=false;record.excludedFromMetrics=!record.productId;if(record.viewsKind==='period'&&!record.viewsPeriodStart&&!record.viewsPeriodEnd&&(existing?.viewsPeriodStart||existing?.viewsPeriodEnd)){record.viewsPeriodStart=record.periodStart;record.viewsPeriodEnd=record.periodEnd;}acceptedVideoRows.push(record);if(!record.productId)warnings.push(`视频 ${record.videoId} 缺少 PID，已保留为待核对记录，暂不计入带货统计。`);}
  if(type==='preferences'&&existing?.latestViewsAsOf&&record.latestViewsAsOf&&record.latestViewsAsOf<existing.latestViewsAsOf){for(const key of ['latestViews','latestViewsAsOf','latestViewsUpdatedAt','latestViewsSource'])delete record[key];}
  if(existing&&['orders','samples'].includes(type)&&record.quantitySource==='default'){delete record.quantity;delete record.quantitySource;}
  // A newly automatic Buyer Username mapping does not erase an older explicit
  // recipient choice. The source Buyer value still updates for conflict review.
  if(type==='orders'&&existing&&!context.overwriteManual&&record.creatorMappingSource==='buyer-username'&&hasExplicitOrderRecipient(existing)){
   for(const key of ['creatorId','creatorHandle','creatorMappingSource','creatorMappingRole','creatorMappingColumn'])record[key]=existing[key]??'';
  }
  if(existing){const next=mergeNonBlank(existing,record,context);next.id=existing.id||next.id||k;const keys=Object.keys(record).filter(x=>!['sourceFile','sourceSheet','sourceRow','id'].includes(x));const changed=keys.some(x=>JSON.stringify(existing[x])!==JSON.stringify(next[x]));if(changed||oldKey!==k){summary.updated++;if(oldKey!==k)map.delete(oldKey);map.set(k,next);indexRow(k,next);}else summary.unchanged++;}else{map.set(k,record);indexRow(k,record);summary.added++;}}
 const actualVideoPeriod=actualVideoPeriods.length===1?actualVideoPeriods[0]:null;
 if(type==='videos')state.videoViewMaxima=retainVideoViewMaxima(inputState,acceptedVideoRows,context).videoViewMaxima;
 state[collection]=[...map.values()];state.imports=[...(state.imports||[]),{id:context.importId||stableKey(Date.now(),type,state.imports?.length||0),type,fileName:context.sourceName||context.fileName||'',sheetName:context.sheetName||'',month:type==='videos'?(actualVideoPeriod&&actualVideoPeriod.start.slice(0,7)===actualVideoPeriod.end.slice(0,7)?actualVideoPeriod.start.slice(0,7):''):context.month||'',rangeStart:type==='videos'?actualVideoPeriod?.start||'':context.rangeStart||'',rangeEnd:type==='videos'?actualVideoPeriod?.end||'':context.rangeEnd||'',periods:actualVideoPeriods,...(type==='videos'?{reportPurpose:'sales'}:{}),...(type==='orders'?{orderMonths:unique(records.filter(validOrderRow).map(row=>dateOfSample(row).slice(0,7))).filter(mon=>/^\d{4}-\d{2}$/.test(mon)),completeOrderSource:context.completeOrderSource!==false}:{}),sourceHash:context.sourceHash||'',mappingSignature:context.mappingSignature||'',at:context.at||new Date().toISOString(),...summary}];
 if(type==='videos'){const viewState=preserveReplacedVideoViews(inputState,state,acceptedVideoRows);if(Object.hasOwn(viewState,'videoViewsArchives'))state.videoViewsArchives=viewState.videoViewsArchives;}
 return {state,summary};
}
function buildProductIndex(mappings){const bySkuId=new Map(),bySku=new Map(),byPid=new Map();for(const r of mappings||[]){if(!r.productId)continue;if(r.skuId){if(!bySkuId.has(r.skuId))bySkuId.set(r.skuId,[]);bySkuId.get(r.skuId).push(r);}if(r.sku){if(!bySku.has(r.sku))bySku.set(r.sku,[]);bySku.get(r.sku).push(r);}if(!byPid.has(r.productId))byPid.set(r.productId,[]);byPid.get(r.productId).push(r);}return {bySkuId,bySku,byPid};}
function resolveProduct(record,index){if(record.productReviewRequired&&!record.productId)return {productId:'',productMatch:'ambiguous'};const derived=['skuId','sku','unmatched','ambiguous','missing'].includes(record.productMatch);if(record.productId&&(!derived||record._manual?.productId||(record.manualFields||[]).includes('productId')))return {productId:record.productId,productMatch:record.productMatch||'provided'};const candidates=(record.skuId&&index.bySkuId.get(record.skuId))||(record.sku&&index.bySku.get(record.sku))||[];const ids=[...new Set(candidates.map(r=>r.productId))];return ids.length===1?{productId:ids[0],productMatch:record.skuId&&index.bySkuId.has(record.skuId)?'skuId':'sku'}:{productId:'',productMatch:ids.length>1?'ambiguous':'unmatched'};}
function settingsOf(state){return {...defaultSettings,...state.settings,cooperationBasis:'sampleQuantity',creatorViewsSource:'preferences',orderFilter:{...defaultSettings.orderFilter,...state.settings?.orderFilter},rules:state.settings?.rules||state.settings?.gradeRules||defaultSettings.rules};}
export function classifyOrder(order,settings=defaultSettings){
 const filter={...defaultSettings.orderFilter,...settings.orderFilter};const type=cleanText(order.orderType).toLowerCase(),status=[order.status,order.substatus,order.cancelReturnType].map(cleanText).join(' ').toLowerCase();
 const cancelled=/cancel|取消|已关闭/.test(status),refunded=/refund|return|退款|退货/.test(status)||parseNumber(order.refundAmount)>0;
 if(filter.mode==='exact_user')return {included:!(type==='normal'&&!cancelled&&!refunded),reason:'按原句条件：排除普通且非退款取消订单'};
 if(filter.excludeCancelled&&cancelled)return {included:false,reason:'取消订单'};
 if(filter.excludeRefunded&&refunded)return {included:false,reason:'退款 / 退货订单'};
 if(filter.excludeNormal&&type==='normal')return {included:false,reason:'Normal 普通订单'};
 if(filter.mode==='sample_only'&&type&&!/sample|样品|free/.test(type))return {included:false,reason:'订单类型未明确标记为样品'};
 if(!type){const trusted=order.sourceType==='sample_orders'||/发样订单|sample orders/i.test(order.sourceSheet||'');if(trusted&&filter.allowBlankFromSampleSheet)return {included:true,reason:'已筛选发样表；原订单类型为空',review:true};if(filter.allowBlankType)return {included:true,reason:'允许空订单类型',review:true};return {included:false,reason:'订单类型为空，待确认',review:true};}
 return {included:true,reason:'符合当前发样筛选规则'};
}
export function gradeCreator(itemsSold,collaborations,settings=defaultSettings){
 const rules=settings.rules||settings.gradeRules||defaultSettings.rules;for(const rule of rules){if(rule.enabled===false)continue;const min=Number(rule.minSold??0),max=rule.maxSold===''||rule.maxSold===null||rule.maxSold===undefined?Infinity:Number(rule.maxSold),minCoop=Number(rule.minCollaborations??rule.minCooperations??0);if(itemsSold>=min&&itemsSold<=max&&collaborations>=minCoop)return {level:Number(rule.level),levelLabel:rule.label||`等级 ${rule.level}`,grade:Number(rule.level),gradeRuleId:rule.id,gradeReason:`${itemsSold} 件 / ${collaborations} 次合作，命中「${rule.label||rule.id}」规则`};}return {level:1,grade:1,levelLabel:'待培育',gradeRuleId:'fallback-l1',gradeReason:'尚未命中其他已启用等级规则，默认归为 L1'};
}
function unique(values){return [...new Set(values.filter(x=>x!==''&&x!==null&&x!==undefined))];}
function sum(items,key){return items.reduce((n,r)=>n+parseNumber(r[key]),0);}
function dateOfSample(r){return parseDate(r.date||r.createdAt)||'';}
function isBuyerUsernameHeader(value){return ['buyerusername','买家账号','买家用户名'].includes(normalizedHeader(value));}
function hasManualOrderRecipient(row){return !!row._manual?.creatorId||(row.manualFields||[]).includes('creatorId');}
function isOrderAttribution(row){return row.creatorMappingRole==='attribution'||row.creatorMappingSource==='attribution-column'||row.creatorMappingRole!=='recipient'&&normalizedHeader(row.creatorMappingColumn)==='creatorhandle';}
function hasExplicitOrderRecipient(row){return hasManualOrderRecipient(row)||row.creatorMappingSource==='explicit-unmapped'||row.creatorMappingSource==='explicit-column'&&!isOrderAttribution(row)&&!isBuyerUsernameHeader(row.creatorMappingColumn)&&row.creatorMappingRole!=='buyer';}
function orderAttribution(row){return normalizeCreator(row.attributedCreatorId||(isOrderAttribution(row)?row.creatorHandle:''));}
function orderCreatorIdentity(row){
 const creatorId=normalizeCreator(row.creatorId||row.creatorHandle),buyer=normalizeCreator(row.buyerUsername),source=cleanText(row.creatorMappingSource);
 let identity;
 if(hasManualOrderRecipient(row)){const manualId=normalizeCreator(row.creatorId);identity={creatorId:manualId,creatorIdentitySource:'manual-column',creatorIdentityConfirmed:!!manualId};}
 else if(source==='explicit-unmapped')identity={creatorId:'',creatorIdentitySource:'explicit-unmapped',creatorIdentityConfirmed:false};
 else if(hasExplicitOrderRecipient(row))identity={creatorId,creatorIdentitySource:'explicit-column',creatorIdentityConfirmed:!!creatorId};
 else if(buyer)identity={creatorId:buyer,creatorIdentitySource:'buyer-username',creatorIdentityConfirmed:true};
 else if(isOrderAttribution(row))identity={creatorId:'',creatorIdentitySource:'sales-attribution',creatorIdentityConfirmed:false};
 else if(['buyer-column','buyer-username','unavailable'].includes(source)||row.creatorMappingRole==='buyer')identity={creatorId:'',creatorIdentitySource:'unavailable',creatorIdentityConfirmed:false};
 else identity={creatorId,creatorIdentitySource:creatorId?'legacy-creator-field':'unavailable',creatorIdentityConfirmed:!!creatorId};
 return {...identity,attributedCreatorId:orderAttribution(row),orderCreatorId:identity.creatorId,creatorIdentityConflict:!!(buyer&&identity.creatorId&&buyer!==identity.creatorId)};
}
/** Persist the user-confirmed Buyer Username identity policy on legacy order
 * rows only. Receipt ledgers, quantities, sales, settings and import history are
 * untouched. Old identity metadata is retained once; repeating this is a no-op. */
export function reconcileOrderBuyerIdentities(inputState,context={}){
 const summary={updated:0,buyerMapped:0,emptyBuyer:0,explicitPreserved:0,attributionPreserved:0};
 const orders=(inputState.orders||[]).map(row=>{
  const buyer=normalizeCreator(row.buyerUsername),identity=orderCreatorIdentity(row);
  if(!buyer){summary.emptyBuyer++;return row;}
  if(identity.creatorIdentitySource!=='buyer-username'){summary.explicitPreserved++;return row;}
  summary.buyerMapped++;
  const attributedCreatorId=orderAttribution(row);
  if(attributedCreatorId)summary.attributionPreserved++;
  const patch={creatorId:buyer,creatorHandle:buyer,creatorMappingSource:'buyer-username',creatorMappingRole:'buyer',creatorMappingColumn:'Buyer Username',...(attributedCreatorId?{attributedCreatorId}:{})};
  if(Object.entries(patch).every(([key,value])=>row[key]===value))return row;
  summary.updated++;
  const creatorMappingPrevious=row.creatorMappingPrevious||Object.fromEntries(['creatorId','creatorHandle','creatorMappingSource','creatorMappingRole','creatorMappingColumn'].map(key=>[key,row[key]??'']));
  return {...row,...patch,creatorMappingPrevious};
 });
 return {state:summary.updated?{...inputState,orders}:inputState,summary};
}
function matchingSampleCandidates(order,candidates){
 if(order.skuId){const exact=candidates.filter(([,row])=>row.skuId&&row.skuId===order.skuId);if(exact.length)return {candidates:exact,source:'order-sku-id'};}
 const compatible=candidates.filter(([,row])=>!(order.skuId&&row.skuId&&order.skuId!==row.skuId));
 if(order.sku){const bySku=compatible.filter(([,row])=>row.sku===order.sku&&!(order.productId&&row.productId&&order.productId!==row.productId));if(bySku.length)return {candidates:bySku,source:'order-sku'};}
 if(order.productId){const byPid=compatible.filter(([,row])=>row.productId===order.productId&&!(order.sku&&row.sku&&order.sku!==row.sku));if(byPid.length)return {candidates:byPid,source:'order-pid'};}
 return {candidates:[],source:''};
}
function orderSourceMonths(state,orders){
 const months=new Set(orders.filter(row=>row.validOrder).map(row=>row.date.slice(0,7)).filter(mon=>/^\d{4}-\d{2}$/.test(mon)));
 for(const item of state.imports||[])if(item.type==='orders'&&item.completeOrderSource!==false)for(const mon of item.orderMonths||[])if(/^\d{4}-\d{2}$/.test(mon))months.add(mon);
 return months;
}
const sampleSourceLabels={orders:'All Orders / 发样订单（Quantity 合计）',ledger:'收样台账（未提供当月订单明细）','historical-promotion':'历史推广表参考',unavailable:'暂无发样来源'};
function sampleProductKey(row){return row.productId||`__sku:${row.sku||row.skuId||row.originalSku||row.id}`;}
// The template repeats the same PID sales beside each SKU, then INDEX/MATCH
// selects one value at PID level. These reference rows are never lifetime sales.
function historicalProductSales(rows){return parseNumber(rows.find(row=>optionalNumber(row.itemsSold)!==null)?.itemsSold);}
function reportMonth(r){if(r.reportKind==='historicalBaseline')return '';const p=videoPeriod(r);if(p.start&&p.end)return p.start.slice(0,7)===p.end.slice(0,7)?p.start.slice(0,7):'';return r.reportMonth||'';}
function aggregateVideos(rows,viewMaxima){
 const byKey=new Map();for(const r of rows){const key=stableKey(r.videoId,r.productId);if(!byKey.has(key))byKey.set(key,{...r,id:key,itemsSold:0,orders:0,gmv:0,views:0,likes:0,comments:0,shares:0,reportMonths:[],sourceRecords:0});const v=byKey.get(key);for(const k of ['itemsSold','orders','gmv','likes','comments','shares'])v[k]+=parseNumber(r[k]);v.views=Math.max(v.views,parseNumber(r.views));v.reportMonths.push(reportMonth(r));v.sourceRecords++;if(!v.postDate&&r.postDate)v.postDate=r.postDate;if(!v.url&&r.url)v.url=r.url;}
 return [...byKey.values()].map(v=>({...v,views:viewMaxima?.get(v.videoId)?.views??v.views,reportMonths:unique(v.reportMonths)}));
}
function uniqueVideoViews(rows){const byVideo=new Map();for(const r of rows){const videoId=cleanText(r.videoId)||videoIdFromUrl(r.url);if(videoId)byVideo.set(videoId,Math.max(byVideo.get(videoId)||0,parseNumber(r.views)));}return [...byVideo.values()].reduce((a,b)=>a+b,0);}
/** Publication inventory is independent of sales eligibility, reporting periods,
 * and sample matching. One canonical publication date per video prevents old
 * snapshots or multiple product rows from counting it in several months. */
function publicationInventory(state,index,issues){
 const sources=[];
 for(const report of state.videoReportArchives||[])if(!['dismissed','rejected','deleted'].includes(report.status))sources.push({rows:report.records||[],priority:1});
 for(const report of state.pendingVideoImports||[])if(report.active!==false&&!['confirmed','dismissed','archived','activated','rejected','deleted'].includes(report.status))sources.push({rows:report.records||[],priority:2});
 sources.push({rows:baselineRows(state),priority:3},{rows:state.videos||[],priority:4});
 const byVideo=new Map();
 for(const source of sources)for(const raw of source.rows){
  const videoId=cleanText(raw.videoId)||videoIdFromUrl(raw.url);if(!videoId)continue;
  const resolved=resolveProduct(raw,index),row={videoId,productId:resolved.productId||'',creatorId:normalizeCreator(raw.creatorId),postDate:parseDate(raw.postDate),url:cleanText(raw.url),sku:resolved.sku||raw.sku||'',productName:resolved.productName||raw.productName||'',priority:source.priority};
  if(!byVideo.has(videoId))byVideo.set(videoId,[]);byVideo.get(videoId).push(row);
 }
 const rows=[];
 for(const [videoId,candidates]of byVideo){
  candidates.sort((a,b)=>b.priority-a.priority||a.postDate.localeCompare(b.postDate)||stableKey(a.creatorId,a.productId,a.url).localeCompare(stableKey(b.creatorId,b.productId,b.url)));
  const dated=candidates.filter(row=>row.postDate),postDate=dated[0]?.postDate||'',dates=unique(dated.map(row=>row.postDate)),creatorId=candidates.find(row=>row.creatorId)?.creatorId||'';
  if(dates.length>1)issues.push({type:'conflictingVideoPostDate',videoId,creatorId,postDate,dates,message:`同一视频存在多个发布日期，按当前视频报表、历史底表、待确认报表、归档的顺序保留 ${postDate}；请核对源文件`});
  const products=unique(candidates.map(row=>row.productId));if(!products.length)products.push('');
  for(const productId of products){const productRows=candidates.filter(row=>row.productId===productId);rows.push({videoId,productId,creatorId,postDate,url:productRows.find(row=>row.url)?.url||candidates.find(row=>row.url)?.url||'',sku:productRows.find(row=>row.sku)?.sku||'',productName:productRows.find(row=>row.productName)?.productName||'',id:stableKey(videoId,productId),publicationSource:'Video Analysis'});}
 }
 return rows;
}
function archivedMonthlySources(state,index){
 const accepted=new Map(),byMonth=new Map();
 // Archives are audit records, never another contribution to lifetime sales. Only the
 // most recently archived snapshot of a non-overlapping monthly period is reusable.
 for(const archive of [...(state.videoReportArchives||[])].reverse()){
  if(['dismissed','rejected','deleted'].includes(archive.status))continue;
  const groups=new Map();for(const raw of archive.records||[]){const r={...raw,creatorId:normalizeCreator(raw.creatorId),...resolveProduct(raw,index)},p=videoPeriod(r),mon=reportMonth(r);if(!mon||!parseDate(p.start)||!parseDate(p.end)||(r.excludedFromMetrics&&!r.productId))continue;const key=stableKey(p.start,p.end);if(!groups.has(key))groups.set(key,{...p,mon,rows:new Map()});r.videoId=r.videoId||videoIdFromUrl(r.url);groups.get(key).rows.set(recordKey('videos',r),{...r,archivedReference:true,archiveId:archive.id||'',archivedAt:archive.archivedAt||''});}
  for(const group of groups.values()){const existing=accepted.get(group.mon)||[];if(existing.some(p=>group.start<=p.end&&group.end>=p.start))continue;existing.push({start:group.start,end:group.end});accepted.set(group.mon,existing);byMonth.set(group.mon,[...(byMonth.get(group.mon)||[]),...group.rows.values()]);}
 }
 return byMonth;
}
/** Report presence is separate from eligible sales: a confirmed zero or a report
 * awaiting PID resolution must not silently borrow historical reference sales. */
function monthlyReportPresence(state){
 const months=new Set(),add=row=>{if(row.reportKind==='historicalBaseline')return;const p=videoPeriod(row),start=parseDate(p.start),end=parseDate(p.end);if(start&&end&&start<=end&&start.slice(0,7)===end.slice(0,7))months.add(start.slice(0,7));};
 for(const row of state.videos||[])add(row);
 for(const archive of state.videoReportArchives||[]){if(['dismissed','rejected','deleted'].includes(archive.status))continue;add(archive);for(const row of archive.records||[])add(row);}
 return months;
}
/** This is a publication cohort reference, never an inferred monthly sale. Only
 * accepted historical baselines supply values; later increments stay separate. */
function historicalPublicationSources(state,index,publications){
 const postDates=new Map(publications.map(row=>[row.videoId,row.postDate])),byVideoProduct=new Map(),byMonth=new Map();
 const cutoffDate=activeBaselines(state).map(report=>parseDate(report.cutoffDate)).filter(Boolean).sort().at(-1)||'';
 for(const raw of baselineRows(state)){
  const videoId=cleanText(raw.videoId)||videoIdFromUrl(raw.url),postDate=postDates.get(videoId)||'',cutoff=parseDate(raw.baselineCutoff),resolved=resolveProduct(raw,index);
  if(!videoId||!resolved.productId||!postDate||!cutoff||postDate>cutoff)continue;
  const row={...raw,...resolved,videoId,creatorId:normalizeCreator(raw.creatorId),postDate},key=stableKey(videoId,resolved.productId),previous=byVideoProduct.get(key);
  if(!previous)byVideoProduct.set(key,row);
  else {const selected=parseNumber(row.itemsSold)>parseNumber(previous.itemsSold)?row:previous,views=[parseVideoViewCount(row.views),parseVideoViewCount(previous.views)].filter(value=>value!==null);byVideoProduct.set(key,{...selected,...(views.length?{views:Math.max(...views)}:{})});}
 }
 for(const row of byVideoProduct.values()){const mon=row.postDate.slice(0,7);if(!byMonth.has(mon))byMonth.set(mon,[]);byMonth.get(mon).push(row);}
 return {cutoffDate,byMonth};
}
function historicalPublicationViews(rows){
 const byVideo=new Map();for(const row of rows){const views=parseVideoViewCount(row.views);if(views!==null)byVideo.set(row.videoId,Math.max(byVideo.get(row.videoId)??0,views));}
 return {value:byVideo.size?[...byVideo.values()].reduce((total,value)=>total+value,0):null,byVideo};
}
function creatorProductContributions(rows,samples,index,settings){
 const groups=new Map();for(const row of rows){const pid=row.productId||'';if(!groups.has(pid))groups.set(pid,[]);groups.get(pid).push(row);}
 const total=sum(rows,'itemsSold'),threshold=parseNumber(settings.successfulSampleMinSold??10);
 return [...groups].map(([productId,productRows])=>{
  const matchedSamples=productId?samples.filter(s=>s.productId===productId):[],mappings=index.byPid.get(productId)||[],entities=aggregateVideos(productRows).sort((a,b)=>b.itemsSold-a.itemsSold||String(a.videoId).localeCompare(String(b.videoId))),top=entities.find(video=>video.itemsSold>0);
  const itemsSold=sum(productRows,'itemsSold');
  return {productId,representativeSku:settings.representativeSkus?.[productId]||matchedSamples.find(s=>s.sku)?.sku||mappings.find(m=>m.sku)?.sku||productRows.find(r=>r.sku)?.sku||'',productName:mappings.find(m=>m.productName)?.productName||matchedSamples.find(s=>s.productName)?.productName||productRows.find(r=>r.productName)?.productName||'',itemsSold,salesShare:total>0?itemsSold/total:0,sampleLinked:matchedSamples.length>0,sampleQuantity:sum(matchedSamples,'quantity'),topVideoId:top?.videoId||'',topVideoUrl:top?.url||'',topVideoItemsSold:top?.itemsSold??null,goodVideoCount:entities.filter(v=>v.itemsSold>threshold).length,videoCount:entities.length,attribution:matchedSamples.length?'sampleProduct':'unmatchedProduct'};
 }).sort((a,b)=>b.itemsSold-a.itemsSold||a.productId.localeCompare(b.productId));
}
export function deriveData(inputState,options={}){
 const state={...createEmptyState(),...inputState},settings=settingsOf(state),index=buildProductIndex(state.productMappings),issues=[];const month=options.month&&options.month!=='all'?options.month:'';
 const resolveViewRecord=raw=>({...raw,creatorId:normalizeCreator(raw.creatorId),...resolveProduct(raw,index)}),viewLedger=deriveVideoViews(state,{resolveRecord:resolveViewRecord}),creatorViewLedger=deriveVideoViews(state,{resolveRecord:resolveViewRecord,sourceScope:'sales',includeHistoricalBaseline:true}),selectedViews=summarizeVideoViews(viewLedger,{month});issues.push(...viewLedger.issues,...creatorViewLedger.issues.filter(issue=>issue.type.startsWith('videoViewsBaseline')));
 const viewMaxima=collectVideoViewMaxima(videoViewSources(state)),allPublicationVideos=publicationInventory(state,index,issues).map(row=>({...row,views:viewMaxima.get(row.videoId)?.views??0})),publicationVideos=month?allPublicationVideos.filter(row=>row.postDate.startsWith(month)):allPublicationVideos;
 const rawVideoMap=new Map();for(const raw of [...baselineRows(state),...(state.videos||[])]){const r={...raw,creatorId:normalizeCreator(raw.creatorId),...resolveProduct(raw,index)};r.videoId=r.videoId||videoIdFromUrl(r.url);rawVideoMap.set(recordKey('videos',r),r);}const allVideoRows=[...rawVideoMap.values()].filter(r=>r.productId||!r.excludedFromMetrics);for(const r of rawVideoMap.values())if(r.excludedFromMetrics&&!r.productId)issues.push({type:'missingVideoProduct',videoId:r.videoId,creatorId:r.creatorId,message:'视频缺少 PID，待补充后再计入带货统计'});
 const archivedByMonth=archivedMonthlySources(state,index),monthlyRows=mon=>{const active=allVideoRows.filter(r=>reportMonth(r)===mon);return active.length?active:archivedByMonth.get(mon)||[];};
 const selectedVideoRows=month?monthlyRows(month):allVideoRows;const allVideoEntities=aggregateVideos(allVideoRows,viewMaxima),videos=aggregateVideos(selectedVideoRows,viewMaxima);
 const pendingLinkMap=new Map();for(const report of state.pendingVideoImports||[]){if(report.active===false||['confirmed','dismissed','archived','activated','rejected','deleted'].includes(report.status))continue;for(const raw of report.records||[]){const publicationOnly=isPublicationOnly(report),r={...raw,creatorId:normalizeCreator(raw.creatorId),...resolveProduct(raw,index),pendingPeriod:!publicationOnly,publicationOnly,reportPurpose:publicationOnly?'publication':raw.reportPurpose||'pending',...(publicationOnly?{observedItemsSold:parseNumber(raw.itemsSold),itemsSold:0}:{})};r.videoId=r.videoId||videoIdFromUrl(r.url);if(r.videoId)pendingLinkMap.set(stableKey(r.videoId,r.productId),r);}}
 const matchingVideos=new Map([...pendingLinkMap,...videos.map(r=>[stableKey(r.videoId,r.productId),r]),...allVideoEntities.map(r=>[stableKey(r.videoId,r.productId),r])]);
 const crossMonthPeriods=unique(allVideoRows.filter(r=>{const p=videoPeriod(r);return p.start&&p.end&&p.start.slice(0,7)!==p.end.slice(0,7);}).map(r=>{const p=videoPeriod(r);return `${p.start} 至 ${p.end}`;}));for(const period of crossMonthPeriods)issues.push({type:'crossMonthPeriod',period,message:'跨月视频报告只计入全部周期汇总；月度推广不会分摊该周期，请分别导出每个月的数据'});
 const sampleMap=new Map();for(const raw of state.samples||[]){const r={...raw,creatorId:normalizeCreator(raw.creatorId),date:dateOfSample(raw),...resolveProduct(raw,index),manualRecordId:manualSampleRecordId(raw),ledgerSource:true};const key=recordKey('samples',r);sampleMap.set(key,sampleMap.has(key)?mergeNonBlank(sampleMap.get(key),r):r);}
 // Buyer Username identifies this workspace's All Orders recipients. Exact
 // receipt matches still preserve the user's established identity and notes.
 const ledgerByOrder=new Map(),ledgerWithoutOrder=[];for(const entry of sampleMap){const [,row]=entry;if(row.orderId){if(!ledgerByOrder.has(row.orderId))ledgerByOrder.set(row.orderId,[]);ledgerByOrder.get(row.orderId).push(entry);}else ledgerWithoutOrder.push(entry);}
 const orderMap=new Map();for(const [i,raw]of (state.orders||[]).entries()){const valid=validOrderRow(raw),key=valid?recordKey('orders',raw):stableKey('invalid-order',i);orderMap.set(key,orderMap.has(key)?mergeNonBlank(orderMap.get(key),raw):raw);}
 const preparedOrders=[...orderMap].map(([key,raw])=>{const r={...raw,...resolveProduct(raw,index),...orderCreatorIdentity(raw),date:parseDate(raw.createdAt)||dateOfSample(raw),quantity:raw.quantity===undefined||raw.quantity===null||raw.quantity===''?1:Math.max(0,parseNumber(raw.quantity)),quantityProvided:optionalNumber(raw.quantity)!==null&&raw.quantitySource!=='default',validOrder:validOrderRow(raw)};return {key,row:r,decision:r.validOrder?classifyOrder(r,settings):{included:false,reason:'缺少有效订单 ID 或产品标识'}};});
 const orderMatches=new Map();
 for(const entry of preparedOrders){const {key,row:r,decision}=entry;if(!r.validOrder){orderMatches.set(key,{candidates:[],source:''});continue;}let match=matchingSampleCandidates(r,ledgerByOrder.get(r.orderId)||[]);
  if(!match.candidates.length&&decision.included&&r.creatorIdentityConfirmed&&r.date){const candidates=ledgerWithoutOrder.filter(([,sample])=>sample.creatorId===r.creatorId&&sample.date===r.date),possible=matchingSampleCandidates(r,candidates);if(possible.candidates.length)match={...match,possibleCandidates:possible.candidates};}
  orderMatches.set(key,match);
 }
 const orderDecisions=[];for(const {key,row:r,decision}of preparedOrders){const match=orderMatches.get(key),ambiguous=match.candidates.length>1,matched=!ambiguous&&match.candidates.length===1?match.candidates[0]:null,existingKey=matched?.[0],existing=existingKey?sampleMap.get(existingKey):null;
  const identity=existing?.creatorId?{creatorId:existing.creatorId,creatorIdentitySource:'sample-ledger',creatorIdentityConfirmed:true}:{creatorId:r.creatorId,creatorIdentitySource:r.creatorIdentitySource,creatorIdentityConfirmed:r.creatorIdentityConfirmed};
  const buyer=normalizeCreator(r.buyerUsername),creatorIdentityConflict=!!(buyer&&identity.creatorId&&buyer!==identity.creatorId);
  const order={...r,...identity,...decision,orderCreatorId:r.creatorId,creatorIdentityConflict,id:r.id||key,matchedSampleId:existing?.id||existingKey||'',possibleSampleIds:(match.possibleCandidates||[]).map(([sampleKey,row])=>row.id||sampleKey),sampleMatchSource:matched?match.source:ambiguous?'ambiguous':match.possibleCandidates?.length?'needs-order-key':'order-only'};orderDecisions.push(order);
  if(decision.included&&creatorIdentityConflict)issues.push({type:'creatorIdentityConflict',id:order.id,orderId:order.orderId,skuId:order.skuId,creatorId:order.creatorId,buyerUsername:buyer,orderCreatorId:r.creatorId,message:existing?'Buyer Username 与已保存的收样达人不一致，已保留原达人，请核对':'Buyer Username 与明确填写的达人不一致，已保留原达人，请核对'});
  if(ambiguous)issues.push({type:'ambiguousSampleOrder',id:order.id,orderId:order.orderId,skuId:order.skuId,creatorId:order.creatorId,message:'订单与收样记录存在多个可能对应，已保留原记录并标记待核对，没有强制合并'});
  if(order.possibleSampleIds.length)issues.push({type:'possibleDuplicateSample',id:order.id,orderId:order.orderId,skuId:order.skuId,creatorId:order.creatorId,message:'同日同款存在未填写订单号的收样记录；仅作为可能重复提示，请补齐订单号确认，未自动合并独立样品'});
  if(!decision.included){if(existing){const cancelledOrRefunded=/取消|退款|退货/.test(decision.reason);sampleMap.set(existingKey,{...existing,orderExcluded:cancelledOrRefunded,orderExclusionReason:cancelledOrRefunded?decision.reason:'',matchedOrderId:order.orderId,orderSource:true});}continue;}
  const fromOrder={...order,id:existing?.id||key,received:/deliver|complete|签收|已完成/i.test(`${r.substatus} ${r.status}`)?'是':'',logisticsUpdated:r.trackingId?'是':'',orderSource:true,ledgerSource:!!existing,classificationReason:decision.reason,classificationReview:decision.review||false,videoLinks:[]};
  const sample=existing?mergeNonBlank(fromOrder,existing):fromOrder;
  if(existing&&r.quantityProvided&&!existing._manual?.quantity&&!(existing.manualFields||[]).includes('quantity'))sample.quantity=r.quantity;
  Object.assign(sample,{...identity,buyerUsername:r.buyerUsername||existing?.buyerUsername||'',attributedCreatorId:r.attributedCreatorId,orderCreatorId:r.creatorId,creatorIdentityConflict,orderSource:true,orderExcluded:false,orderExclusionReason:'',matchedOrderId:order.orderId,sampleMatchSource:order.sampleMatchSource,classificationReason:decision.reason,classificationReview:decision.review||false});
  sampleMap.set(existingKey||key,sample);
 }
 let allSamples=[...sampleMap.values()].map(r=>({...r,id:r.id||recordKey('samples',r),manualRecordId:manualSampleRecordId(r),date:dateOfSample(r),quantity:r.quantity===undefined||r.quantity===null||r.quantity===''?1:Math.max(0,parseNumber(r.quantity)),effective:!r.orderExcluded&&!/cancel|取消|refund|退款|退货/i.test(cleanText(r.received)),videoLinks:extractUrls(r.videoLinks||r.links||r.url),videoIds:unique([...(r.videoIds||[]),...extractUrls(r.videoLinks||r.url).map(videoIdFromUrl)]),matchedVideoIds:[],pendingVideoIds:[],matchedVideoCount:0,candidateVideoLinks:[],candidateVideoIds:[],candidateVideos:[],candidateVideoCount:0,itemsSold:0,views:0}));
 const sampleCandidates=new Map();for(const s of allSamples){if(s.effective&&s.creatorId&&s.productId){const key=stableKey(s.creatorId,s.productId);if(!sampleCandidates.has(key))sampleCandidates.set(key,[]);sampleCandidates.get(key).push(s);}}
 const videoAssignments=new Map();
 for(const v of matchingVideos.values()){const key=stableKey(v.creatorId,v.productId),candidates=sampleCandidates.get(key)||[];const explicitlyLinked=allSamples.filter(s=>s.effective&&s.videoIds.includes(v.videoId)&&(!s.productId||s.productId===v.productId)&&(!s.creatorId||s.creatorId===v.creatorId));let target=null;
  // A report contains no sample order ID. Even a unique creator/PID/date match
  // is a suggestion until the receipt ledger explicitly contains its link.
  for(const sample of explicitlyLinked){sample.matchedVideoIds=unique([...sample.matchedVideoIds,v.videoId]);if(v.pendingPeriod)sample.pendingVideoIds=unique([...sample.pendingVideoIds,v.videoId]);}
  if(explicitlyLinked.length===1)target=explicitlyLinked[0];
  else if(explicitlyLinked.length>1){const groups=unique(explicitlyLinked.map(s=>s.orderId||s.id));if(groups.length===1)target=[...explicitlyLinked].sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];else issues.push({type:'ambiguousVideo',videoId:v.videoId,creatorId:v.creatorId,productId:v.productId,message:'同一视频已填写在多个收样订单，保留确认链接，但不重复分配销量'});}
  else if(v.postDate&&v.creatorId&&v.productId){const dated=candidates.filter(s=>s.date&&s.date<=v.postDate);if(dated.length){const latest=dated.map(s=>s.date).sort().at(-1),recent=dated.filter(s=>s.date===latest);for(const sample of recent){sample.candidateVideoLinks=unique([...sample.candidateVideoLinks,...extractUrls(v.url)]);sample.candidateVideoIds=unique([...sample.candidateVideoIds,v.videoId]);if(!sample.candidateVideos.some(row=>row.videoId===v.videoId))sample.candidateVideos.push({videoId:v.videoId,url:v.url||'',postDate:v.postDate,productId:v.productId,itemsSold:parseNumber(v.itemsSold),pendingPeriod:!!v.pendingPeriod,publicationOnly:!!v.publicationOnly,reportPurpose:v.reportPurpose||'sales'});}if(recent.length>1)issues.push({type:'ambiguousVideo',videoId:v.videoId,creatorId:v.creatorId,productId:v.productId,message:'同一达人同一 PID 在最近发样日有多个记录，候选视频需人工确认属于哪次收样'});}}
  if(target)videoAssignments.set(stableKey(v.videoId,v.productId),target.id);
 }
 const selectedBySample=new Map();for(const v of videos){const sampleId=videoAssignments.get(stableKey(v.videoId,v.productId));if(sampleId){if(!selectedBySample.has(sampleId))selectedBySample.set(sampleId,[]);selectedBySample.get(sampleId).push(v);}}
 allSamples=allSamples.map(s=>{const vs=selectedBySample.get(s.id)||[];const matchStatus=!s.effective?(s.orderExclusionReason||'已取消 / 退款'):!s.creatorId?(s.orderSource?'达人待关联':'待补达人 ID'):s.productMatch==='ambiguous'?'PID 多重匹配':!s.productId?'待匹配 PID':s.pendingVideoIds.length?'已确认视频（销量周期待确认）':s.matchedVideoIds.length?'已确认视频':s.videoLinks.length?'已有确认链接':s.candidateVideoIds.length?'候选视频待确认':'待回传视频';return {...s,matchedVideoCount:s.matchedVideoIds.length,pendingVideoCount:s.pendingVideoIds.length,candidateVideoCount:s.candidateVideoIds.length,links:s.videoLinks,itemsSold:sum(vs,'itemsSold'),views:uniqueVideoViews(s.videoIds.map(videoId=>({videoId,views:viewMaxima.get(cleanText(videoId))?.views??0}))),matchStatus,status:matchStatus};});
 const samples=month?allSamples.filter(s=>s.date.startsWith(month)):allSamples;
 for(const s of allSamples)if(!s.creatorId||!s.productId)issues.push({type:!s.creatorId?'missingCreator':'missingProduct',id:s.id,creatorId:s.creatorId,sku:s.sku,skuId:s.skuId,message:!s.creatorId?(s.orderSource?'All Orders 发样记录缺少有效 Buyer Username 或达人映射，请补充达人 ID':'收样记录缺少达人 ID'):s.productMatch==='ambiguous'?'该 Seller SKU 对应多个 PID，需使用平台 SKU ID 或手工选择':'尚未找到对应 PID'});
 // Keep the established management profiles and all sample-ledger creators. A creator
 // without samples joins automatically only when confirmed sales exceed the editable
 // threshold; preference leads and pending report totals never qualify them.
 const profiles=new Map();for(const r of state.creators||[]){const id=normalizeCreator(r.creatorId);if(id)profiles.set(id,mergeNonBlank(profiles.get(id)||{creatorId:id},r));}
 const sampleRoster=new Set(allSamples.map(s=>s.creatorId).filter(Boolean));for(const id of sampleRoster)if(!profiles.has(id))profiles.set(id,{creatorId:id});
 const salesAdmitted=new Set(),confirmedSales=new Map();for(const r of allVideoRows)if(r.creatorId)confirmedSales.set(r.creatorId,(confirmedSales.get(r.creatorId)||0)+parseNumber(r.itemsSold));for(const [id,sold]of confirmedSales)if(!profiles.has(id)&&sold>Math.max(0,parseNumber(settings.videoOnlyCreatorMinSold??10))){profiles.set(id,{creatorId:id});salesAdmitted.add(id);}
 const viewSnapshots=new Map();
 for(const p of state.preferences||[]){const id=normalizeCreator(p.creatorId);if(!id||!profiles.has(id))continue;profiles.set(id,mergeNonBlank(profiles.get(id),p));const value=optionalNumber(p.latestViews),current=viewSnapshots.get(id),stamp=p.latestViewsAsOf||p.latestViewsUpdatedAt||'';if(value!==null&&(!current||!stamp||!current.stamp||stamp>=current.stamp))viewSnapshots.set(id,{value,stamp,source:p.latestViewsSource||p.sourceFile||'西班牙达人带货倾向',asOf:p.latestViewsAsOf||parseDate(p.latestViewsUpdatedAt)});}
 const sampleByCreator=new Map(),sampleRecordsByCreator=new Map(),videoByCreator=new Map(),selectedByCreator=new Map(),publicationByCreator=new Map(),selectedPublicationsByCreator=new Map();for(const s of allSamples){if(!sampleRecordsByCreator.has(s.creatorId))sampleRecordsByCreator.set(s.creatorId,[]);sampleRecordsByCreator.get(s.creatorId).push(s);if(!s.effective)continue;if(!sampleByCreator.has(s.creatorId))sampleByCreator.set(s.creatorId,[]);sampleByCreator.get(s.creatorId).push(s);}for(const r of allVideoRows){if(!videoByCreator.has(r.creatorId))videoByCreator.set(r.creatorId,[]);videoByCreator.get(r.creatorId).push(r);}for(const r of selectedVideoRows){if(!selectedByCreator.has(r.creatorId))selectedByCreator.set(r.creatorId,[]);selectedByCreator.get(r.creatorId).push(r);}for(const r of allPublicationVideos){if(!publicationByCreator.has(r.creatorId))publicationByCreator.set(r.creatorId,[]);publicationByCreator.get(r.creatorId).push(r);}for(const r of publicationVideos){if(!selectedPublicationsByCreator.has(r.creatorId))selectedPublicationsByCreator.set(r.creatorId,[]);selectedPublicationsByCreator.get(r.creatorId).push(r);}
 const willingnessDefault=getWillingnessConfig(settings).defaultValue;
 const creators=[...profiles.entries()].map(([id,p])=>{
  const ss=sampleByCreator.get(id)||[],allRows=videoByCreator.get(id)||[],rows=selectedByCreator.get(id)||[],knownVideoIds=unique([...(publicationByCreator.get(id)||[]).map(v=>v.videoId),...ss.flatMap(s=>s.videoIds)]),orderIds=unique(ss.map(s=>s.orderId||s.id));
  const recordedSampleQuantity=sum(ss,'quantity'),sampleRecordCount=(sampleRecordsByCreator.get(id)||[]).length,hasData=allRows.length>0,observedSold=sum(allRows,'itemsSold');
  const manualSelfPurchasedSampleQuantity=optionalQuantity(p.selfPurchasedSampleQuantity),eligibleSelfPurchase=observedSold>Math.max(0,parseNumber(settings.videoOnlyCreatorMinSold??10));
  const defaultSelfPurchase=optionalQuantity(settings.selfPurchaseDefaultQuantity)??1,selfPurchaseFallbackActive=sampleRecordCount===0&&(manualSelfPurchasedSampleQuantity!==null||eligibleSelfPurchase);
  const selfPurchasedSampleQuantity=selfPurchaseFallbackActive?(manualSelfPurchasedSampleQuantity??defaultSelfPurchase):0,estimatedSelfPurchaseQuantity=selfPurchaseFallbackActive&&manualSelfPurchasedSampleQuantity===null?defaultSelfPurchase:0;
  const selfPurchaseQuantitySource=selfPurchaseFallbackActive?(manualSelfPurchasedSampleQuantity===null?'default':'manual'):'none',cooperationCount=sampleRecordCount?recordedSampleQuantity:selfPurchasedSampleQuantity;
  const cooperationSource=sampleRecordCount?'有效收样记录':selfPurchaseQuantitySource==='manual'?'自购样品（手工填写）':selfPurchaseQuantitySource==='default'?'自购样品（默认估计）':'暂无收样或自购样品';
  const grade=gradeCreator(observedSold,cooperationCount,settings),snapshot=viewSnapshots.get(id),views=snapshot?.value??null,videoCount=unique((selectedPublicationsByCreator.get(id)||[]).map(v=>v.videoId)).length;
  const creatorViews=summarizeVideoViews(creatorViewLedger,{creatorId:id}),historicalVideoViewsReference=uniqueVideoViews(publicationByCreator.get(id)||[]),creatorGmv=creatorGmvSummary(allRows);
  const observedNotes=[...ss].filter(s=>/讲解|口播|画面|画质|拍摄|节奏|特写|实拍|演示|开箱|拆箱|出镜|字幕|配音|AI图片|AI视频|产品使用/i.test(s.videoNotes||'')).sort((a,b)=>(b.videoUpdateDate||b.date||'').localeCompare(a.videoUpdateDate||a.date||''));const style=p.style||[...ss].reverse().find(s=>s.style)?.style||[...allRows].reverse().find(v=>v.style)?.style||observedNotes[0]?.videoNotes||'';
  const explicitStyle=[...ss.map(s=>({date:s.videoUpdateDate||s.date||'',value:s.style||(/讲解|口播|画面|画质|拍摄|节奏|特写|实拍|演示|开箱|拆箱|出镜|字幕|配音|AI图片|AI视频|产品使用/i.test(s.videoNotes||'')?s.videoNotes:'')})),...allRows.map(v=>({date:v.postDate||'',value:v.style}))].filter(x=>x.value).sort((a,b)=>b.date.localeCompare(a.date))[0]?.value||'';
  const explicitTendency=[...allRows].reverse().find(v=>v.tendency)?.tendency||'',productContributions=creatorProductContributions(allRows,ss,index,settings),topProduct=productContributions.find(p=>p.itemsSold>0)||null;
  const hasStoredWillingness=p.willingness!==undefined&&p.willingness!==null&&String(p.willingness).trim()!=='';
  // Only explicitly retained admission metadata extends a sales-based origin;
  // unrelated historical profiles are not relabeled, and receipt history wins.
  const salesAdmissionOrigin=salesAdmitted.has(id)||p.admissionOrigin==='salesThreshold';
  return {...p,creatorId:id,id,willingness:hasStoredWillingness?p.willingness:willingnessDefault,willingnessSource:hasStoredWillingness?'stored':'default',rosterSource:sampleRoster.has(id)?'sample':salesAdmissionOrigin?'salesThreshold':'historicalProfile',admissionReason:sampleRoster.has(id)?'收样表中的达人':salesAdmissionOrigin?'出单达标纳入，暂无收样记录':'已有达人管理档案',style,styleSource:p.style?'达人管理表 / 手工维护':style?'已导入记录中的人工描述':'',suggestedStyle:explicitStyle,suggestedTendency:explicitTendency,tendency:p.tendency||explicitTendency,preferences:p.tendency||explicitTendency,itemsSold:sum(rows,'itemsSold'),lifetimeItemsSold:observedSold,...creatorGmv,cumulativeVideoViews:creatorViews.value,cumulativeVideoViewsAvailable:creatorViews.available,cumulativeVideoViewsSource:creatorViews.source,cumulativeVideoViewsCoverage:creatorViews.coverage,cumulativeVideoViewsCoverageStatus:creatorViews.status,cumulativeVideoViewsBaseline:creatorViews.baselineValue,cumulativeVideoViewsPeriodTotal:creatorViews.periodValue,cumulativeVideoViewsBaselineCutoff:creatorViews.baselineCutoff,cumulativeVideoViewsBaselineMissingVideoCount:creatorViews.baselineMissingVideoCount,cumulativeVideoViewsBaselineOverlapVideoCount:creatorViews.baselineOverlapVideoCount,historicalVideoViewsReference,views,viewsSource:snapshot?.source||'西班牙达人带货倾向（未提供播放量）',viewsAsOf:snapshot?.asOf||'',avgViews:null,videoCount,allVideoCount:knownVideoIds.length,cooperationCount,collaborationCount:cooperationCount,cooperationSource,recordedSampleQuantity,manualSelfPurchasedSampleQuantity,selfPurchasedSampleQuantity,estimatedSelfPurchaseQuantity,selfPurchaseQuantitySource,selfPurchaseFallbackActive,sampleCount:ss.length,sampleRecordCount,sampleQuantity:recordedSampleQuantity,orderCount:orderIds.length,receivedCount:ss.filter(s=>/是|已收到|received|yes/i.test(s.received||'')).length,lastSampleDate:ss.map(s=>s.date).filter(Boolean).sort().at(-1)||'',lastVideoDate:allRows.map(v=>v.postDate).filter(Boolean).sort().at(-1)||'',productCount:unique(ss.map(s=>s.productId)).length,productContributions,topProduct,successfulSampleVideoCount:productContributions.filter(p=>p.sampleLinked).reduce((n,p)=>n+p.goodVideoCount,0),pendingVideoCount:unique(ss.flatMap(s=>s.pendingVideoIds)).length,metricSource:hasData?(allRows.some(r=>r.reportKind==='historicalBaseline')?'历史底表与已确认周期累计':'Video Analysis 已确认周期累计'):'暂无已确认周期销量；默认 L1',...grade};
 }).sort((a,b)=>b.level-a.level||b.lifetimeItemsSold-a.lifetimeItemsSold||b.sampleCount-a.sampleCount||a.creatorId.localeCompare(b.creatorId));
 const publicationStart=settings.monthlyPromotionPublicationStart||'2026-09',publicationPerformance=deriveMonthlyPublicationPerformance(state,{startMonth:publicationStart,resolveRecord:resolveViewRecord,publicationDates:new Map(allPublicationVideos.map(row=>[row.videoId,row.postDate])),parseDate,parseNumber,parseViews:parseVideoViewCount});issues.push(...publicationPerformance.issues);
 const sampleOrderMonths=orderSourceMonths(state,orderDecisions),months=unique([...allSamples.map(s=>s.date.slice(0,7)),...sampleOrderMonths,...allVideoRows.map(reportMonth),...allPublicationVideos.map(v=>v.postDate.slice(0,7)),...archivedByMonth.keys(),...publicationPerformance.byMonth.keys(),...viewLedger.observations.filter(r=>r.start.slice(0,7)===r.end.slice(0,7)).map(r=>r.start.slice(0,7)),...(state.promotions||[]).map(r=>r.month)]).filter(m=>/^\d{4}-\d{2}$/.test(m)).sort().reverse();
 const promotionMonths=month?[month]:months;const promotions=[],monthlySalesDisplays=new Map(),monthlySampleSources=new Map(),actualReportMonths=monthlyReportPresence(state),historicalPublications=historicalPublicationSources(state,index,allPublicationVideos),monthlyPromotionTotals=new Map();

 for(const mon of promotionMonths){
  const modernPublicationMode=mon>=publicationStart,publicationReport=publicationPerformance.byMonth.get(mon),publicationSummary=summarizePublicationPerformance(publicationReport,{parseNumber,parseViews:parseVideoViewCount});
  const monthSamples=allSamples.filter(s=>s.date.startsWith(mon)),confirmedMonthRows=monthlyRows(mon),monthlyVideos=confirmedMonthRows.filter(r=>r.productId),monthlyPublications=modernPublicationMode?(publicationReport?.rows||[]).filter(v=>v.productId&&v.postDate?.startsWith(mon)):allPublicationVideos.filter(v=>v.productId&&v.postDate.startsWith(mon));
  const monthlyViews=summarizeVideoViews(viewLedger,{month:mon});
  const historicalGroups=new Map(),historicalRows=new Map();
  for(const h of state.promotions||[])if(h.month===mon){const resolved={...h,...resolveProduct(h,index)};historicalRows.set(recordKey('promotions',resolved),resolved);}
  for(const h of historicalRows.values()){const key=h.productId||`__sku:${h.sku||h.originalSku||h.id}`;if(!historicalGroups.has(key))historicalGroups.set(key,[]);historicalGroups.get(key).push(h);}
  // Select one complete source for each month. A full order report with zero
  // qualifying sample rows is authoritative; ledger/history are not added to it.
  const sampleSourceMode=sampleOrderMonths.has(mon)?'orders':monthSamples.length?'ledger':[...historicalRows.values()].some(row=>optionalNumber(row.sampleQuantity)!==null)?'historical-promotion':'unavailable';
  const monthlySamples=sampleSourceMode==='orders'?orderDecisions.filter(row=>row.included&&row.date.startsWith(mon)):sampleSourceMode==='ledger'?monthSamples.filter(row=>row.effective):[],sampleMetricSource=sampleSourceLabels[sampleSourceMode];
  monthlySampleSources.set(mon,{mode:sampleSourceMode,source:sampleMetricSource,rows:monthlySamples,historicalQuantity:sampleSourceMode==='historical-promotion'?sum([...historicalRows.values()],'sampleQuantity'):0});
  const hasActualReport=actualReportMonths.has(mon)||confirmedMonthRows.length>0,hasHistoricalSales=[...historicalRows.values()].some(row=>optionalNumber(row.itemsSold)!==null),canUsePublicationHistory=!!historicalPublications.cutoffDate&&mon<=historicalPublications.cutoffDate.slice(0,7),publicationHistory=canUsePublicationHistory?historicalPublications.byMonth.get(mon)||[]:[];
  const salesDisplayMode=hasActualReport?'confirmed-period':hasHistoricalSales?'historical-promotion':canUsePublicationHistory?'historical-publication':'unavailable',salesDisplayCutoff=salesDisplayMode==='historical-publication'?historicalPublications.cutoffDate:'',salesSource=salesDisplayMode==='confirmed-period'?(confirmedMonthRows.some(row=>row.archivedReference)?'已归档月度报告（已包含在累计基线）':'Video Analysis 已确认周期'):salesDisplayMode==='historical-promotion'?`历史推广表参考（${mon}）`:salesDisplayMode==='historical-publication'?`本月发布视频历史累计表现（截至${salesDisplayCutoff}）`:'暂无已确认月度销量';
  monthlySalesDisplays.set(mon,{itemsSold:salesDisplayMode==='confirmed-period'?sum(confirmedMonthRows,'itemsSold'):salesDisplayMode==='historical-promotion'?[...historicalGroups.values()].reduce((total,rows)=>total+historicalProductSales(rows),0):salesDisplayMode==='historical-publication'?sum(publicationHistory,'itemsSold'):0,mode:salesDisplayMode,source:salesSource,cutoff:salesDisplayCutoff});
  const productKeys=unique([...monthlySamples.map(sampleProductKey),...(modernPublicationMode?(publicationReport?.rows||[]).map(row=>row.productId):monthlyVideos.map(v=>v.productId)),...monthlyPublications.map(v=>v.productId),...(modernPublicationMode?[]:monthlyViews.observations.flatMap(row=>row.productIds)),...historicalGroups.keys()]);
  const monthPromotionRows=[],periodViewsForTotal=new Map(),historicalViewsForTotal=new Map();
  for(const key of productKeys){
   const pid=key.startsWith('__sku:')?'':key,ss=monthlySamples.filter(sample=>sampleProductKey(sample)===key),vs=pid?monthlyVideos.filter(v=>v.productId===pid):[],published=pid?monthlyPublications.filter(v=>v.productId===pid):[],historicalPublished=pid?publicationHistory.filter(v=>v.productId===pid):[],history=historicalGroups.get(key)||[],h=history.at(-1)||{},mappings=index.byPid.get(pid)||[];
   const productViews=pid?summarizeVideoViews(viewLedger,{month:mon,productId:pid}):{value:null,available:false,source:'产品 PID 尚待确认',coverage:'补齐 PID 后才能统计该产品的期间播放量',status:'unconfirmed'};
   const rep=(pid&&settings.representativeSkus?.[pid])||h.sku||ss.find(s=>s.sku)?.sku||mappings.find(p=>p.sku)?.sku||'';
   const historicalQuantity=sum(history,'sampleQuantity'),historicalSold=historicalProductSales(history),confirmedPeriodItemsSold=sum(vs,'itemsSold'),hasProductHistory=history.some(row=>optionalNumber(row.itemsSold)!==null),productPublication=pid?summarizePublicationPerformance(publicationReport,{productId:pid,parseNumber,parseViews:parseVideoViewCount}):{itemsSold:null,views:null,available:false,viewsAvailable:false,rows:[]};
   const rowSalesMode=modernPublicationMode?(publicationReport?.mode||'unavailable'):hasActualReport?'confirmed-period':hasProductHistory?'historical-promotion':canUsePublicationHistory?'historical-publication':'unavailable';
   const historicalPublicationItemsSold=!modernPublicationMode&&rowSalesMode!=='confirmed-period'&&canUsePublicationHistory?sum(historicalPublished,'itemsSold'):null;
   const rowItemsSold=modernPublicationMode?productPublication.itemsSold:rowSalesMode==='confirmed-period'?confirmedPeriodItemsSold:rowSalesMode==='historical-promotion'?historicalSold:rowSalesMode==='historical-publication'?historicalPublicationItemsSold:0;
   const rowSalesAvailable=modernPublicationMode?productPublication.available:rowSalesMode!=='unavailable'&&(rowSalesMode!=='historical-publication'||historicalPublished.length>0);
   const rowSalesSource=modernPublicationMode?(publicationReport?.source||'暂无对应月份的发布视频报表'):rowSalesMode==='historical-promotion'?`历史推广表参考（${mon}，按本 PID 保留明确值）`:rowSalesMode==='historical-publication'?`本月发布视频历史累计表现（截至${historicalPublications.cutoffDate}）`:salesSource;
   const displayVideoRows=modernPublicationMode?productPublication.rows:rowSalesMode==='confirmed-period'?vs:historicalPublished,detailMode=modernPublicationMode?rowSalesMode:rowSalesMode==='confirmed-period'?'confirmed-period':historicalPublished.length?'historical-publication':rowSalesMode;
   const rankedVideoRows=aggregateVideos(displayVideoRows).sort((a,b)=>parseNumber(b.itemsSold)-parseNumber(a.itemsSold)||String(a.videoId).localeCompare(String(b.videoId)));
   const primarySalesVideos=rankedVideoRows.filter(video=>parseNumber(video.itemsSold)>0).map(video=>({videoId:video.videoId,url:video.url||'',itemsSold:parseNumber(video.itemsSold),isViral:parseNumber(video.itemsSold)>=parseNumber(settings.viralMinSold??5)})),sellingVideoCount=modernPublicationMode?(productPublication.available?unique(primarySalesVideos.map(video=>video.videoId)).length:null):['confirmed-period','historical-publication'].includes(detailMode)?unique(primarySalesVideos.map(video=>video.videoId)).length:null;
   const historicalView=historicalPublicationViews(historicalPublished),useHistoricalViews=!modernPublicationMode&&!productViews.available&&historicalView.value!==null;
   const rowViews=modernPublicationMode?productPublication.views:productViews.available?productViews.value:historicalView.value,rowViewsMode=modernPublicationMode?(publicationReport?.mode||'unavailable'):productViews.available?'confirmed-period':useHistoricalViews?'historical-publication':'unavailable';
   const rowViewsSource=modernPublicationMode?(publicationReport?.source||'暂无对应月份的发布视频报表'):useHistoricalViews?`历史发布视频播放参考（截至${historicalPublications.cutoffDate}）`:productViews.source;
   const rowViewsCoverage=modernPublicationMode?(publicationReport?.coverage||'尚无可用发布报表；出单视频报表继续用于达人累计。'):useHistoricalViews?'来自历史底表，按本月发布的视频归组；统计期间不明，不代表当月新增播放。':productViews.coverage;
   if(!modernPublicationMode){if(productViews.available)for(const record of productViews.records||[])periodViewsForTotal.set(stableKey(record.videoId,record.start,record.end),record);else for(const [videoId,value]of historicalView.byVideo)historicalViewsForTotal.set(videoId,Math.max(historicalViewsForTotal.get(videoId)??0,value));}
   const notes=unique(history.map(r=>r.notes)).join('\n');const manualLinks=unique(history.flatMap(r=>extractUrls(r.videoLinks))),manualSellingCreators=unique(history.flatMap(r=>Array.isArray(r.sellingCreators)?r.sellingCreators:[]));
   if(!pid)issues.push({type:'missingPromotionProduct',id:stableKey(mon,key),sku:rep,month:mon,message:history.length?'历史推广记录尚无唯一 PID，已保留原 SKU、参考数值和备注，等待补全映射':'发样明细尚无唯一 PID，已保留该 SKU 的发样数量，等待补全映射'});
   if(unique(history.map(row=>optionalNumber(row.itemsSold)).filter(value=>value!==null)).length>1)issues.push({type:'historicalPromotionSalesConflict',id:stableKey(mon,key),month:mon,productId:pid,sku:rep,message:'同一 PID 的历史推广行填写了不同销量，按模板首个明确值保留一次；各原始行已保留，请核对'});
   const promotionRow={...h,id:stableKey(mon,key),month:mon,productId:pid,productMatch:pid?'matched':h.productMatch||'unmatched',sku:rep,representativeSku:rep,
    productName:mappings.find(p=>p.productName)?.productName||ss.find(s=>s.productName)?.productName||'',
    sampleOrders:unique(ss.map(s=>s.orderId||s.id)).length,sampleQuantity:sampleSourceMode==='historical-promotion'?historicalQuantity:sum(ss,'quantity'),unlinkedSampleOrders:unique(ss.filter(s=>!s.creatorId).map(s=>s.orderId||s.id)).length,
    creatorCount:unique(ss.map(s=>s.creatorId)).length,sampleCreators:unique(ss.map(s=>s.creatorId)).length,
    videoCount:unique(published.map(v=>v.videoId)).length,videoCountSource:modernPublicationMode?'所选发布视频报表中的有效 Post date（视频 ID 去重）':'Video Analysis 发布日期（视频 ID 去重）',publishedVideoLinks:unique(published.map(v=>v.url)),sellingVideoCount,primarySalesVideos,itemsSold:rowItemsSold,salesAvailable:rowSalesAvailable,confirmedPeriodItemsSold,historicalPublicationItemsSold,salesDisplayMode:rowSalesMode,salesDisplayCutoff:rowSalesMode==='historical-publication'?historicalPublications.cutoffDate:'',sellingVideoSourceMode:detailMode,sellingVideoSource:detailMode==='historical-publication'?`历史发布视频表现参考（截至${historicalPublications.cutoffDate}）`:rowSalesSource,views:rowViews,viewsAvailable:rowViews!==null,viewsDisplayMode:rowViewsMode,viewsSource:rowViewsSource,viewsCoverage:rowViewsCoverage,viewsCoverageStatus:modernPublicationMode?(publicationReport?.status||'unavailable'):useHistoricalViews?'historical_reference':productViews.status,historicalViewsReference:historicalView.value,
    videoLinks:unique([...displayVideoRows.filter(v=>parseNumber(v.itemsSold)>0).map(v=>v.url),...(modernPublicationMode?[]:manualLinks)]),
    sellingCreators:rowSalesMode==='historical-promotion'&&manualSellingCreators.length?manualSellingCreators:unique(displayVideoRows.filter(v=>parseNumber(v.itemsSold)>0).map(v=>v.creatorId)),
    viralVideoLinks:unique([...rankedVideoRows.filter(v=>parseNumber(v.itemsSold)>=parseNumber(settings.viralMinSold??5)).map(v=>v.url),...(modernPublicationMode?[]:manualLinks)]),manualVideoLinks:manualLinks,
    historicalSampleQuantity:history.length?historicalQuantity:null,historicalItemsSold:history.length?historicalSold:null,historicalRows:history,historicalSkuCount:history.length,
    sampleMetricSource,sampleSourceMode,videoMetricSource:rowSalesSource,notes
   };promotions.push(promotionRow);monthPromotionRows.push(promotionRow);
  }
  const salesModes=unique(monthPromotionRows.filter(row=>row.salesAvailable).map(row=>row.salesDisplayMode)),viewModes=unique(monthPromotionRows.filter(row=>row.viewsAvailable).map(row=>row.viewsDisplayMode)),periodVideoIds=new Set([...periodViewsForTotal.values()].map(row=>row.videoId));
  const referenceViews=[...historicalViewsForTotal].filter(([videoId])=>!periodVideoIds.has(videoId)).reduce((total,[,value])=>total+value,0),periodViewValue=[...periodViewsForTotal.values()].reduce((total,row)=>total+row.views,0);
  const promotionViews=modernPublicationMode?publicationSummary.views:periodViewsForTotal.size||historicalViewsForTotal.size?periodViewValue+referenceViews:null;
  monthlyPromotionTotals.set(mon,{itemsSold:modernPublicationMode?publicationSummary.itemsSold:monthPromotionRows.some(row=>row.salesAvailable)?sum(monthPromotionRows.filter(row=>row.salesAvailable),'itemsSold'):null,salesMode:modernPublicationMode?(publicationReport?.mode||'unavailable'):salesModes.length>1?'mixed-historical':salesModes[0]||'unavailable',salesSource:modernPublicationMode?(publicationReport?.source||'暂无对应月份的发布视频报表'):salesModes.length>1?'按 PID 保留历史推广明确值，缺项用历史发布视频参考补充':monthPromotionRows.find(row=>row.salesAvailable)?.videoMetricSource||'暂无可用出单数据',cutoff:salesModes.includes('historical-publication')?historicalPublications.cutoffDate:'',videoCount:modernPublicationMode?publicationSummary.videoCount:unique(monthlyPublications.map(row=>row.videoId)).length,missingPostDateCount:modernPublicationMode?publicationSummary.missingPostDateCount:0,views:promotionViews,viewsMode:modernPublicationMode?(publicationReport?.mode||'unavailable'):viewModes.length>1?'mixed-reference':viewModes[0]||'unavailable',viewsSource:modernPublicationMode?(publicationReport?.source||'暂无对应月份的发布视频报表'):viewModes.length>1?'按 PID 采用已确认期间，缺项使用历史播放参考':monthPromotionRows.find(row=>row.viewsAvailable)?.viewsSource||'暂无可用播放数据',viewsCoverage:modernPublicationMode?(publicationReport?.coverage||'未使用出单视频报表替代月度发布报表。'):viewModes.includes('historical-publication')?'包含按发布月份归组的历史播放参考；统计期间不明，不等于本月新增播放。':monthlyViews.coverage,viewsStatus:modernPublicationMode?(publicationReport?.status||'unavailable'):viewModes.includes('historical-publication')?'historical_reference':monthlyViews.status});
 }

 promotions.sort((a,b)=>b.month.localeCompare(a.month)||b.itemsSold-a.itemsSold||b.sampleQuantity-a.sampleQuantity);
 for(const o of orderDecisions)if(o.included&&parseNumber(o.orderAmount)>0)issues.push({type:'paidSampleOrder',id:o.id,creatorId:o.creatorId,orderId:o.orderId,message:'已筛选发样表存在非零支付金额，请复核是否样品订单'});
 const activeCreators=creators.filter(c=>c.sampleCount||c.allVideoCount),effectiveSamples=samples.filter(s=>s.effective);const stats={sampleCount:effectiveSamples.length,sampleRecordCount:samples.length,cancelledSamples:samples.length-effectiveSamples.length,sampleOrders:unique(effectiveSamples.map(s=>s.orderId||s.id)).length,sampleQuantity:sum(effectiveSamples,'quantity'),receivedCount:effectiveSamples.filter(s=>/是|已收到|received|yes/i.test(s.received||'')).length,matchedSamples:effectiveSamples.filter(s=>s.videoLinks.length).length,pendingSamples:effectiveSamples.filter(s=>!s.videoLinks.length).length,creatorCount:creators.length,activeCreatorCount:activeCreators.length,allCreators:creators.length,preferenceCount:unique((state.preferences||[]).map(p=>normalizeCreator(p.creatorId))).length,excellentCreators:activeCreators.filter(c=>c.level===5).length,videoCount:unique(publicationVideos.map(v=>v.videoId)).length,undatedVideoCount:unique(allPublicationVideos.filter(v=>!v.postDate).map(v=>v.videoId)).length,videoCountSource:'Video Analysis 发布日期（视频 ID 去重）',itemsSold:sum(selectedVideoRows,'itemsSold'),views:selectedViews.value,viewsAvailable:selectedViews.available,viewsSource:selectedViews.source,viewsCoverage:selectedViews.coverage,viewsCoverageStatus:selectedViews.status,viewsPeriodRanges:selectedViews.periods,unconfirmedViewsReportCount:selectedViews.unconfirmedReportCount,viewsOverlapVideoCount:selectedViews.overlapVideoCount,crossMonthViewsVideoCount:selectedViews.crossMonthVideoCount,historicalViewsReference:uniqueVideoViews(publicationVideos),videoMetricSource:selectedVideoRows.some(r=>r.archivedReference)?'已归档月度报告（已包含在累计基线）':'Video Analysis 已确认周期',gmv:Math.round(sum(selectedVideoRows,'gmv')*100)/100,productCount:unique(promotions.map(p=>p.productId)).length,unmatchedProducts:allSamples.filter(s=>s.effective&&!s.productId).length,reviewCount:issues.length,excludedOrders:orderDecisions.filter(r=>!r.included).length,classifiedSampleOrders:orderDecisions.filter(r=>r.included).length};
 const salesDisplay=month?monthlySalesDisplays.get(month):{itemsSold:stats.itemsSold,mode:'confirmed-total',source:activeBaselines(state).length?'历史底表与已确认周期累计':'Video Analysis 已确认周期累计',cutoff:''};
 Object.assign(stats,{displayItemsSold:salesDisplay.itemsSold,displaySalesMode:salesDisplay.mode,displaySalesSource:salesDisplay.source,displaySalesCutoff:salesDisplay.cutoff});
 const promotionTotals=[...monthlyPromotionTotals.values()],promotionSalesModes=unique(promotionTotals.filter(row=>row.itemsSold!==null).map(row=>row.salesMode)),promotionViewModes=unique(promotionTotals.filter(row=>row.views!==null).map(row=>row.viewsMode)),chosenPromotion=month?monthlyPromotionTotals.get(month):null;
 Object.assign(stats,{promotionItemsSold:chosenPromotion?chosenPromotion.itemsSold:promotionTotals.some(row=>row.itemsSold!==null)?sum(promotionTotals,'itemsSold'):null,promotionSalesMode:chosenPromotion?chosenPromotion.salesMode:promotionSalesModes.length>1?'mixed-historical':promotionSalesModes[0]||'unavailable',promotionSalesSource:chosenPromotion?chosenPromotion.salesSource:'各月份推广显示值合计，包含历史与待确认参考；不用于达人累计。',promotionSalesCutoff:chosenPromotion?chosenPromotion.cutoff:historicalPublications.cutoffDate,promotionVideoCount:chosenPromotion?chosenPromotion.videoCount:sum(promotionTotals,'videoCount'),promotionMissingPostDateCount:chosenPromotion?chosenPromotion.missingPostDateCount:sum(promotionTotals,'missingPostDateCount'),promotionViews:chosenPromotion?chosenPromotion.views:promotionTotals.some(row=>row.views!==null)?sum(promotionTotals,'views'):null,promotionViewsAvailable:chosenPromotion?chosenPromotion.views!==null:promotionTotals.some(row=>row.views!==null),promotionViewsMode:chosenPromotion?chosenPromotion.viewsMode:promotionViewModes.length>1?'mixed-reference':promotionViewModes[0]||'unavailable',promotionViewsSource:chosenPromotion?chosenPromotion.viewsSource:'各月份推广播放显示值合计，包含历史与待确认参考；不是已确认累计播放。',promotionViewsCoverage:chosenPromotion?chosenPromotion.viewsCoverage:'每月按本月所采用的来源计算；历史与跨月报表不冒充当月实际播放。',promotionViewsCoverageStatus:chosenPromotion?chosenPromotion.viewsStatus:promotionViewModes.some(mode=>mode!=='publication-period'&&mode!=='confirmed-period')?'mixed_reference':'confirmed'});
 const chosenSampleSources=[...monthlySampleSources.values()],undatedSamples=month?[]:allSamples.filter(row=>row.effective&&!row.date),promotionSampleRows=[...chosenSampleSources.flatMap(source=>source.rows),...undatedSamples];
 const sourceModes=unique([...chosenSampleSources.map(source=>source.mode).filter(mode=>mode!=='unavailable'),...(undatedSamples.length?['ledger']:[])]),promotionSampleSource=sourceModes.length>1?`按月份选择来源：${sourceModes.map(mode=>sampleSourceLabels[mode]).join('；')}`:sampleSourceLabels[sourceModes[0]||'unavailable'];
 Object.assign(stats,{promotionSampleOrders:unique(promotionSampleRows.map(row=>row.orderId||row.id)).length,promotionSampleQuantity:sum(promotionSampleRows,'quantity')+chosenSampleSources.reduce((total,source)=>total+source.historicalQuantity,0),promotionSampleCreators:unique(promotionSampleRows.map(row=>row.creatorId)).length,promotionUnlinkedSampleOrders:unique(promotionSampleRows.filter(row=>!row.creatorId).map(row=>row.orderId||row.id)).length,promotionSampleSource,candidateSamples:effectiveSamples.filter(row=>row.candidateVideoCount>0).length});
 return {samples,allSamples,creators,promotions,videos,publicationVideos,allPublicationVideos,stats,months,issues,orders:orderDecisions,settings,preferenceIndex:state.preferences||[]};
}
