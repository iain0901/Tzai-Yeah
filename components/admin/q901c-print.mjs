import qrcode from '../../vendor/qrcode-generator/qrcode.mjs';
const AGENT = 'http://127.0.0.1:9537';
export function drawTicket(ticket, documentObject = document) {
  const c = documentObject.createElement('canvas'); c.width = 384; c.height = 730;
  const x = c.getContext('2d'); if (!x) throw new Error('無法產生票券圖像。');
  x.fillStyle = '#fff'; x.fillRect(0,0,384,730); x.fillStyle = '#000'; x.strokeStyle = '#000'; x.lineWidth = 2; x.strokeRect(17,12,350,701);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const text=(value,y,font)=>{ x.font=font; x.fillText(value,192,y,320); };
  const line=y=>{ x.beginPath(); x.moveTo(38,y); x.lineTo(346,y); x.stroke(); };
  text('T Z A I   Y E A H',55,'bold 26px Arial'); text('載 耶  ·  聖 誕 聚 會',95,'20px "Microsoft JhengHei",sans-serif'); line(117);
  text('參 加 者',151,'18px "Microsoft JhengHei",sans-serif'); text(ticket.name,208,'bold 38px "Microsoft JhengHei",sans-serif'); line(247);
  text('卡  號',280,'18px "Microsoft JhengHei",sans-serif'); text('# '+ticket.number,329,'bold 34px Arial'); line(360);
  const qr=qrcode(0,'M'); qr.addData(ticket.url); qr.make(); const n=qr.getModuleCount(), size=252, margin=4, total=n+margin*2, startX=66, startY=380;
  x.fillStyle='#fff';x.fillRect(startX,startY,size,size);x.fillStyle='#000';
  for(let r=0;r<n;r++) for(let col=0;col<n;col++) if(qr.isDark(r,col)) {
    const x1=Math.round((col+margin)*size/total),x2=Math.round((col+margin+1)*size/total),y1=Math.round((r+margin)*size/total),y2=Math.round((r+margin+1)*size/total);
    x.fillRect(startX+x1,startY+y1,x2-x1,y2-y1);
  }
  text('M E R R Y   C H R I S T M A S',672,'14px Arial');return c.toDataURL('image/png');
}
export async function printTickets(tickets, { fetcher=fetch, render=drawTicket, shouldStop=()=>false, onProgress=()=>{} }={}) {
  if(!Array.isArray(tickets)||!tickets.length) throw new Error('沒有可列印的票券。');
  let health; try { const r=await fetcher(AGENT+'/health',{cache:'no-store'}); if(!r.ok) throw Error(); health=await r.json(); }
  catch { throw new Error('無法連接這台電腦的 WMS 列印代理，請先啟動。'); }
  if(!health.ok||!health.sdk_ready||health.active_profile?.active!=='q901c') throw new Error('請在 WMS 列印設定選擇 Q901C，並確認印表機已連線。');
  let complete=0;
  for(const ticket of tickets) {
    if(shouldStop()) return {complete,total:tickets.length,stopped:true};
    const image=await render(ticket);
    if(shouldStop()) return {complete,total:tickets.length,stopped:true};
    onProgress({complete,total:tickets.length,current:ticket.number});
    try {
      const r=await fetcher(AGENT+'/print-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_base64:image,port:'USB,',copies:1,cut_distance:40,name:'舞會票券',barcode:''})});
      let value;try{value=await r.json()}catch{throw Error('invalid')}
      if(!r.ok||!value.ok||value.active_profile!=='q901c')throw Error('failed');
    } catch { throw new Error(`已確認 ${complete}/${tickets.length} 張；卡號 ${ticket.number} 的列印或切紙狀態不確定，請先檢查實體票券，勿直接重印全部。`); }
    complete++; onProgress({complete,total:tickets.length,current:null});
  }
  return {complete,total:tickets.length,stopped:false};
}
