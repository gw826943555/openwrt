#!/usr/bin/env python3
"""Render page.html as a standalone preview with a fake device behind it.

Usage: preview.py page.html [preview.html]

Opens in any browser straight from disk: every request the page makes
(/info, /check, /log, /env, /ping, /reboot, the POST) is answered by a stub,
and a small bar at the bottom right switches the device between the
states the page has to handle -- healthy, no UBI, no fip volume, a build
without console recording, /info failing -- picks how a submit ends, and
can cut the connection so the heartbeat's disconnected overlay can be
seen.  The stub also goes quiet for as long as a real device would: a
write, a reboot, a whole-chip read.  Downloads have no device behind
them off a file:// page, so the transfer is replaced with the line the
page shows while the device reads.  Look at the
page here before touching the C side; what the stub answers is what the
real endpoints answer, so a layout or wording change is decided on the
same data.

Markers are handled the way gen.py does, except that the @@MACROS@@ get
sample values.  The STOCK section is shown by default; --no-stock drops it
instead, which is what a board built without CMD_HTTPD_STOCK_RESTORE serves.
Anything reachable from outside that section has to keep working in both.
"""
import json
import sys

MACROS = {
    "WEB_VERSION": "0.3.0",
    "AUTHOR": "Loong",
    "AUTHOR_HOST": "github.com/Loong1996",
    "AUTHOR_URL": "https://github.com/Loong1996",
    "PROJECT_URL": "https://github.com/Loong1996/ImmortalWrt-Airoha",
    "PROJECT_HOST": "github.com/Loong1996/ImmortalWrt-Airoha",
    "PORTAL_URL": "https://loong1996.github.io/ImmortalWrt-Airoha/",
    "PORTAL_HOST": "loong1996.github.io/ImmortalWrt-Airoha",
}

# s = reserved_pebs * leb_size；u = used_bytes，dynamic 卷恒等于 s，
# 只有 static 卷（这里是 fip）的 u 才是真实内容长度。
VOLS = [
    {"i": 0, "n": "fip", "t": "static", "s": 1142784, "u": 325632},
    {"i": 1, "n": "fit", "t": "dynamic", "s": 13078528, "u": 13078528},
    {"i": 2, "n": "ubootenv", "t": "dynamic", "s": 126976, "u": 126976},
    {"i": 3, "n": "ubootenv2", "t": "dynamic", "s": 126976, "u": 126976},
    {"i": 4, "n": "bosa", "t": "dynamic", "s": 380928, "u": 380928},
    {"i": 5, "n": "ri", "t": "dynamic", "s": 380928, "u": 380928},
    {"i": 6, "n": "rootfs_data", "t": "dynamic", "s": 239349760,
     "u": 239349760},
]

INFO = {
    "web": MACROS["WEB_VERSION"],
    "model": "Nokia XG-040G-MD",
    "soc": "airoha,an7581",
    "ram": 536870912,
    "mac": "90:03:2e:12:34:56",
    "net": {"ip": "192.168.1.1", "mask": "0.0.0.0",
            "gw": "0.0.0.0", "server": "192.168.1.254",
            "dev": "airoha-gdm1", "offer": 1, "ack": 1,
            "mode": "server", "ram": 0, "saved": None,
            "client": "a4:5e:60:11:22:33"},
    "ports": [{"p": 1, "link": 0, "speed": 0, "fd": 0},
              {"p": 2, "link": 1, "speed": 1000, "fd": 1},
              {"p": 3, "link": 0, "speed": 0, "fd": 0},
              {"p": 4, "link": 1, "speed": 100, "fd": 1}],
    "uboot": "U-Boot 2026.07-ImmortalWrt (Sep 06 2026 - 10:21:03 +0800)",
    "flash": {"name": "spi-nand0", "size": 268435456, "erase": 131072,
              "page": 2048},
    "parts": [{"n": "bl2", "o": 0, "s": 131072},
              {"n": "ubi", "o": 131072, "s": 268304384}],
    "uploadmax": 0xf8d1000,
    "stock": 1,
    "log": 1,
    "fv": [{"n": "ri", "s": 262144}, {"n": "bosa", "s": 262144}],
    "ubi": {"leb": 126976, "pebs": 2046, "avail": 0, "fip": 1,
            "vols": VOLS},
}

CHECK = [
    ["闪存", 0, "spi-nand0，256 MiB，擦除块 128 KiB，页 2048 B", "闪存"],
    ["坏块", 0, "无", "闪存"],
    ["BL2", 0, "0x800 处有 BL2 镜像", "引导"],
    ["web_uboot_envver", 0, "7，与当前 U-Boot 一致", "引导"],
    ["bootcmd", 0, "与当前版本默认值一致", "引导"],
    ["引导菜单", 0, "9 项", "引导"],
    ["UBI", 0, "7 个卷，坏块 0 个，空闲 0 个逻辑擦除块", "UBI"],
    ["可写空间", 0, "刷机可用 240 MiB（1988 个逻辑擦除块）。当前空闲 0 MiB；写入固件时会先删掉 fit 与 rootfs_data，再腾出 240 MiB", "UBI"],
    ["磨损", 0, "擦写次数最大 47、平均 12", "UBI"],
    ["fip 卷", 0, "325632 字节，校验通过", "UBI"],
    ["fit 卷", 0, "FIT 镜像，12984320 字节", "UBI"],
    ["固件", 0, "ARM64 ImmortalWrt nokia_xg-040g-md FIT (Flattened Image Tree)"
               "，2026-09-05 17:01", "UBI"],
    ["ubootenv 卷", 0, "存在，CRC 0x3f2a91c4", "环境"],
    ["ubootenv2 卷", 0, "存在，与 ubootenv 一致", "环境"],
    ["ri 卷", 0, "已读取，MAC 90:03:2e:12:34:56", "出厂数据"],
    ["bosa 卷", 1, "已读取，内容为空", "出厂数据"],
    ["U-Boot MAC", 0, "90:03:2e:12:34:56，与出厂数据一致", "出厂数据"],
]
ENV = [
    ("arch", "arm"),
    ("baudrate", "115200"),
    ("board", "an7581"),
    ("boot_ubi", "ubi part ubi && ubi read $loadaddr fit && bootm $loadaddr"),
    ("bootcmd", "run _firstboot ; run boot_ubi ; run web_uboot_boot_forever"),
    ("bootdelay", "3"),
    ("bootmenu_0", "启动 ImmortalWrt.=run boot_ubi"),
    ("bootmenu_8", "网页恢复（Airoha Web U-Boot 0.3.0）.=httpd"),
    ("bootmenu_delay", "3"),
    ("check_buttons", "if button reset ; then echo recovery ; httpd ; fi"),
    ("ethaddr", "90:03:2e:12:34:56"),
    ("ethaddr_factory", "90:03:2e:12:34:56"),
    ("fdtcontroladdr", "bfad0f10"),
    ("ipaddr", "192.168.1.1"),
    ("loadaddr", "0x84000000"),
    ("netmask", "255.255.255.0"),
    ("serverip", "192.168.1.100"),
    ("soc", "airoha"),
    ("stderr", "serial"),
    ("stdin", "serial"),
    ("stdout", "serial"),
    ("ubi_write_fip", "run ubi_remove_rootfs ; ubi check fip && ubi remove "
                      "fip ; ubi create fip 0x100000 static && ubi write "
                      "$loadaddr fip $filesize"),
    ("ubi_write_production", "ubi check fit && ubi remove fit ; "
                             "ubi check rootfs_data && ubi remove rootfs_data ; "
                             "ubi create fit $filesize dynamic && "
                             "ubi write $loadaddr fit $filesize"),
    ("vendor", "nokia"),
    ("web_uboot_boot_forever", "while true ; do httpd ; sleep 1 ; done"),
    ("web_uboot_envver", "7"),
    ("web_uboot_format_ubi", "ubi detach ; mtd erase ubi && ubi part ubi"),
    ("web_uboot_write_bl2", "mtd erase bl2 && mtd write bl2 $loadaddr 0x800 $filesize"),
    ("web_uboot_write_fip", "if ubi check fip ; then ubi write $loadaddr fip "
                            "$filesize ; else run ubi_write_fip ; fi"),
]

LOG = """

U-Boot 2026.07-ImmortalWrt-r40957-4b007b8c20 (Sep 05 2026 - 17:01:01 +0000)

CPU:   Airoha AN7581
dram: probing by address aliasing, base 0x80000000
dram:  anchor at 0x80200000, holds 0x00000000
dram:   512 MiB: wrote 0xa0200000, anchor now 0xa5a55a5a -- wrapped onto the anchor
dram: 512 MiB, agrees with the device tree
DRAM:  512 MiB
Core:  37 devices, 22 uclasses, devicetree: separate
Loading Environment from UBI... spi-nand: spi_nand nand@0: SkyHigh SPI NAND was found.
spi-nand: spi_nand nand@0: 256 MiB, block size: 128 KiB, page size: 2048, OOB size: 128
Read 126976 bytes from volume ubootenv to 00000000bfad17c0
OK
In:    serial
Out:   serial
Err:   serial
Net:   eth0: airoha-gdm1
Airoha Web U-Boot %s by Loong
Using airoha-gdm1 device, MAC 90:03:2e:12:34:56
Listening for HTTP on 192.168.1.1 port 80
Handing out DHCP leases from 192.168.1.1
Press Ctrl-C to abort
httpd: DHCP OFFER -> 192.168.1.100
httpd: DHCP ACK -> 192.168.1.100
""" % MACROS["WEB_VERSION"]

# The stub.  Plain ES5 like the page itself.
STUB = r"""
<script>(function(){
var D=@DATA@,S={dev:'ok',post:'ok',conn:'up'},T0=Date.now(),DOWN=0;

/*
 * 擦尾报的块数。设备是从镜像占到的最后一个擦除块之后起算的，这里照抄，
 * 否则完成页上的数字对不上，那一行就白加了。
 */
function wiped(u,tot){
 if(!/wipe=1/.test(u||''))return '';
 var f=D.info.flash,off=parseInt((/off=0x([0-9a-f]+)/.exec(u||'')||[0,'0'])[1],16),
     first=off+Math.ceil(tot/f.erase)*f.erase,
     nb=Math.max(0,Math.floor((f.size-first)/f.erase));
 return ' wiped '+nb}
var DSEQ=0,DINFO={seq:0,len:0,crc:'00000000',holes:0,name:''};
var DBUSY=0,DSENT=0,DTOTAL=0,DTICK=null;
/* 真设备的日志会一直长，跟随功能不自己长就看不出在跟 */
var LOGX='',LOGSEQ=0;
setInterval(function(){LOGSEQ++;
LOGX+='httpd: DHCP ACK -> 192.168.1.10'+(LOGSEQ%9)+'\n'},3000);
function down(){return S.conn=='down'||Date.now()<DOWN}
function fall(ms){DOWN=Date.now()+ms}
function info(){var i=JSON.parse(JSON.stringify(D.info));
if(S.dev=='noubi')i.ubi=null;
if(S.dev=='nofip'){i.ubi.fip=0;i.ubi.vols=i.ubi.vols.filter(function(v){return v.n!='fip'})}
if(S.dev=='nolog')i.log=0;
return i}
function check(){var c=D.check.map(function(r){return{n:r[0],s:r[1],v:r[2],g:r[3]}});
if(S.dev=='noubi')return c.filter(function(i){return i.g=='闪存'||i.g=='引导'}).concat([
{n:'UBI',s:2,v:'无法挂载，闪存上无可用的 UBI。首次迁移请在「引导升级」页启用「重建 UBI」，并同时上传 BL2、U-Boot 与固件',g:'UBI'},
{n:'ubootenv 卷',s:2,v:'无法读取，UBI 未挂载，环境仅存于内存，断电丢失',g:'环境'},
{n:'U-Boot MAC',s:0,v:'90:03:2e:12:34:56',g:'出厂数据'}]);
if(S.dev=='nofip')c.forEach(function(i){if(i.n=='fip 卷'){i.s=2;i.v='不存在。当前 U-Boot 仅存于内存，请在「引导升级」页上传 U-Boot 文件'}});
return c}
function ip4(s){var a=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s||''),i;
 if(!a)return 0;
 for(i=1;i<5;i++)if(+a[i]>255)return 0;
 return 1}
/* 掩码得是连成一片的前导 1：取反加一还等于取反本身的补，10.0.0.1 这种就过不去 */
function maskok(s){var p=s.split('.'),n=0,m,i;
 for(i=0;i<4;i++)n=n*256+(+p[i]);
 m=~n>>>0;return ((m+1)&m)===0}
function body(u){
 if(u=='/ping')return JSON.stringify({up:Date.now()-T0,ovf:0});
 if(u=='/dumpinfo')return JSON.stringify(
  {seq:DINFO.seq,len:DINFO.len,crc:DINFO.crc,holes:DINFO.holes,
   name:DINFO.name,busy:DBUSY,sent:DSENT,total:DBUSY?DTOTAL:0});
 if(u=='/info')return S.dev=='noinfo'?null:JSON.stringify(info());
 /* 网络这一页轮询的那一半：地址与端口，不含 UBI */
 if(u=='/net')return JSON.stringify({net:D.info.net,ports:D.info.ports});
 /* 三种模式走同一个端点；server 那一档掩码与末位由设备定死 */
 if(u.indexOf('/netmode')==0){
  var mo=/[?&]mode=([^&]*)/.exec(u),g=/[?&]ip=([^&]*)/.exec(u),
      k=/[?&]mask=([^&]*)/.exec(u),sv=/[?&]save=1(&|$)/.test(u),
      md=mo?mo[1]:'',ip=g?decodeURIComponent(g[1]):'',
      mk=k?decodeURIComponent(k[1]):'';
  if(md!='server'&&md!='static'&&md!='client')return 'bad mode';
  if(md=='client'){D.info.net.mode='client';D.info.net.ram=sv?0:1;
   if(sv)D.info.net.saved={mode:'client'};
   return 'ok client - - '+(sv?'saved':'ram')}
  if(!ip4(ip))return 'bad ip';
  if(md=='server'){mk='255.255.255.0';ip=ip.replace(/\.\d+$/,'.1')}
  else if(!ip4(mk)||!maskok(mk))return 'bad mask';
  D.info.net.mode=md;D.info.net.ip=ip;D.info.net.mask=mk;
  D.info.net.ram=sv?0:1;
  if(sv)D.info.net.saved={mode:md,ip:ip,mask:mk};
  return 'ok '+md+' '+ip+' '+mk+(sv?' saved':' ram')}
 if(u=='/check')return JSON.stringify({items:check()});
 /* 一段 4 MiB，和设备的 SCAN_SLICE 一样；坏块与 ECC 是编的，但位置固定 */
 if(u.indexOf('/scan')==0){
  var sz=D.info.flash.size,blk=D.info.flash.erase,sl=4<<20,
      m=/off=0x([0-9a-f]+)/.exec(u),a=m?parseInt(m[1],16):0,
      b=Math.min(sz,a+sl),bad=[],fail=[],ecc=0,x;
  for(x=a;x<b;x+=blk){
   if(x==0x2a00000||x==0x9c00000)bad.push(x);
   else if(x>=0xe000000&&((x/blk)%37)==0)ecc++}
  return JSON.stringify({off:b,size:sz,blk:blk,done:b>=sz?1:0,
   bad:bad.length,ecc:ecc,fail:fail.length,badlist:bad,faillist:fail})}
 if(u.indexOf('/wr')==0){var wf=/from=(\d+)/.exec(u);
  wf=wf?+wf[1]:0;if(wf>WRLOG.length)wf=WRLOG.length;
  return String(WRLOG.length)+'\n'+WRLOG.slice(wf)}
 if(u=='/log')return S.dev=='nolog'?null:D.log+LOGX;
 /* ?from= 只回新的那一段，第一行是新偏移 —— 和设备一样 */
 if(u.indexOf('/log?from=')==0){if(S.dev=='nolog')return null;
  var all=D.log+LOGX,f=parseInt(u.slice(10),10)||0;
  if(f>all.length)f=all.length;
  return String(all.length)+'\n'+all.slice(f)}
 if(u=='/env')return JSON.stringify({env:D.env,cut:0});
 if(u=='/envreset')return S.dev=='noubi'?'ok':'ok saved';
 if(u=='/bootonce')return S.dev=='noubi'?'armed, but saving failed':'armed and saved';
 if(u=='/boot'){fall(9000);setTimeout(function(){T0=Date.now()},9000);return 'ok'}
 if(u=='/reboot'){fall(9000);setTimeout(function(){T0=Date.now()},9000);return 'OK'}
 return null}
function XHR(){var x=this;x.upload={};x.status=0;x.responseText='';x.timeout=0;
x.open=function(m,u){x.m=m;x.u=u};x.setRequestHeader=function(){};
x.send=function(fd){
 if(x.m=='GET'){
  if(down()&&x.u!='/reboot'){setTimeout(function(){x.status=0;
   (x.timeout&&x.ontimeout?x.ontimeout:x.onerror||function(){})()},Math.min(x.timeout||1200,900));return}
  var t=body(x.u);
  setTimeout(function(){if(t==null){x.status=404;x.responseText='';x.onerror?x.onerror():x.onload&&x.onload()}
   else{x.status=200;x.responseText=t;x.onload&&x.onload()}},x.u=='/check'?1500:x.u=='/ping'?60:300);return}
 /* p4 发的是裸 File，不是 FormData —— 那条路没有表单可遍历 */
 var tot=0,n=0,st=!!(x.u&&x.u.indexOf('/stock')==0),parts=[],tryb=false,fmt=false;
 try{tot=fd.size||0}catch(e){}
 if(!tot)try{fd.forEach(function(v,k){if(v&&v.size){tot+=v.size;parts.push({k:k,n:v.size})}})}catch(e){}
 if(!tot)tot=1;
 try{tryb=fd.get('tryboot')=='1';fmt=fd.get('format')=='1'}catch(e){}
 var tick=setInterval(function(){n+=Math.max(tot/40,65536);if(n>=tot){n=tot;clearInterval(tick);x.upload.onprogress&&x.upload.onprogress({lengthComputable:true,loaded:n,total:tot});x.upload.onload&&x.upload.onload();
  setTimeout(function(){if(S.post=='drop'){x.onerror&&x.onerror();return}
   if(S.post=='reject'){x.status=400;x.responseText='the flash has no U-Boot (no fip volume) and this upload brings none: nothing would boot after the reset. Upload the U-Boot FIP as well';x.onload&&x.onload();return}
   /* 刷回原厂仍是一次性回复：它边收边写，200 到手时早写完了 */
   if(st){if(S.post=='fail500'){x.status=500;
     x.responseText='写入 0x8c0000 失败（-5，实际写入 0/131072）。闪存已写入一部分，此时重启将无法启动。请重新写入至成功，其间不要断电'}
    else{x.status=200;
     x.responseText='ok '+tot+' bytes crc32 '+((0x3f2a91c4+tot)>>>0).toString(16)+' skipped 0'+wiped(x.u,tot);
     fall(60000)}
    x.onload&&x.onload();return}
   /* 试运行一去不回，所以它还是先回复后动手 */
   if(tryb){x.status=200;x.responseText='OK';fall(9000);x.onload&&x.onload();return}
   x.status=200;x.responseText='OK';x.onload&&x.onload();
   WRLOG='';wrrun(wrlines(parts,fmt),0);return},1200);return}
  x.upload.onprogress&&x.upload.onprogress({lengthComputable:true,loaded:n,total:tot})},80)}}
/*
 * A1 的行协议。写那一步报不出中间态（配方在 run_command 里），所以只有一句
 * 「正在写…」；回读校验是设备自己的循环，一段一段报得出来。
 */
var VNAME={bl2:'BL2',fip:'U-Boot',firmware:'固件',ubifile:'卷'};
function wrlines(parts,fmt){var L=[],tot=0;
 if(fmt)L.push(['s 擦除 UBI 分区',2600]);
 parts.forEach(function(p){var nm=VNAME[p.k]||(p.k.indexOf('fvol_')==0?p.k.slice(5):p.k);
  tot+=p.n;
  L.push(['s 写入 '+nm+' '+p.n,Math.max(800,Math.min(7000,p.n/1400000*1000))]);
  L.push(['r '+nm+' '+p.n+' '+((0x3f2a91c4+p.n)>>>0).toString(16),250])});
 if(S.post=='fail500'){L=L.slice(0,fmt?2:1);
  L.push(['f 写入失败（-5）。闪存内容不完整，重新写入至成功之前不要重启',0]);
  return L}
 L.push(['s 回读校验 '+tot,500]);
 for(var i=1;i<=5;i++)L.push(['v '+Math.round(tot*i/5)+' '+tot,520]);
 L.push(['c ok',250]);
 L.push(['t '+tot+' '+Math.max(0.1,tot/1400000).toFixed(1),120]);
 L.push(['done',0]);
 return L}
/*
 * 写那一步真设备是不应答的（run_command 里出不来），所以在轮到 r 行之前
 * 让假设备也闭嘴同样长的时间 —— 页面要面对的正是这个。
 */
var WRLOG='';
function wrrun(L,i){if(i>=L.length)return;
 var d=L[i][1];
 WRLOG+=L[i][0]+'\n';
 if(L[i+1]&&L[i+1][0].charAt(0)=='r')fall(d);
 setTimeout(function(){wrrun(L,i+1)},d)}
window.XMLHttpRequest=XHR;
/* 桩的数据自己也是可看可改的：用例要模拟「网线换了个口」就动这里 */
window.PV=D;
document.addEventListener('DOMContentLoaded',function(){
 var b=document.createElement('div');
 b.setAttribute('style','position:fixed;right:12px;bottom:12px;z-index:99;background:#1d1d1f;color:#f5f5f7;font:12px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;padding:8px 10px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px)');
 b.innerHTML='<b>预览</b> 设备 <select id=pvdev><option value=ok>正常</option><option value=noubi>没有 UBI</option><option value=nofip>没有 fip 卷</option><option value=nolog>不带串口日志</option><option value=noinfo>/info 失败</option></select> 提交 <select id=pvpost><option value=ok>成功</option><option value=reject>设备拒绝 400</option><option value=fail500>写到一半失败 500</option><option value=drop>断线</option></select> 连接 <select id=pvconn><option value=up>正常</option><option value=down>断开</option></select>';
 document.body.appendChild(b);
 var sel=b.querySelector('#pvdev'),ps=b.querySelector('#pvpost'),cn=b.querySelector('#pvconn');
 sel.onchange=function(){S.dev=sel.value;if(window.CHK!==undefined)window.CHK=null;window.ENV=null;window.info&&window.info()};
 ps.onchange=function(){S.post=ps.value};
 cn.onchange=function(){S.conn=cn.value};
 /*
  * 下载本身在 file:// 下没有设备可下，所以只换掉最里面这一层：读取期间设备
  * 静默、读完记下 crc32 —— 页面那套问 /dumpinfo 的逻辑跑的是真的。
  *
  * 「静默」是整段传输，不是象征性的一下子。net/tcp.c 只有一个
  * static struct tcp_stream，旧连接没 CLOSED 之前新 SYN 直接被拒，而下载那条
  * 从头开到尾 —— 所以这期间设备对任何请求都不应答。桩以前只 fall(900)，于是
  * /dumpinfo 一路答得好好的，页面那套百分比、速率、剩余时间在这里全绿，在真
  * 设备上一次都没出现过。判据自己错了，比没有判据更坏。
  */
 window.dlstart=function(u,n){
  /* 长度留空时由设备算到片尾，这里照做，好让进度和 crc32 都有个数 */
  if(n===null){var o=/off=0x([0-9a-f]+)/.exec(u);
   n=D.info.flash.size-(o?parseInt(o[1],16):0)}
  /* 第一个窗口读完就开始传，所以静默很短；crc32 要等整份传完才有 */
  var send=Math.max(1200,Math.min(n/1e4,30000)),t0=Date.now();
  fall(send);
  DBUSY=1;DSENT=0;DTOTAL=n;clearInterval(DTICK);
  DTICK=setInterval(function(){
   DSENT=Math.min(n,Math.round(n*(Date.now()-t0)/send))},200);
  setTimeout(function(){DSEQ++;clearInterval(DTICK);
   DBUSY=0;DSENT=n;
   DINFO={seq:DSEQ,len:n,crc:(0x3f2a91c4+DSEQ*7).toString(16),holes:0,
          name:'nokia-xg-040g-md-'+(/vol=([^&]+)/.exec(u)||[0,'flash'])[1]+'.bin'}},
   send)};
});
})();</script>
"""


def render(html, stock=True):
    out = []
    skip = False
    for line in html.splitlines():
        s = line.strip()
        if s == "<!--#if STOCK-->":
            skip = not stock
            continue
        if s == "<!--#endif-->":
            skip = False
            continue
        if skip:
            continue
        out.append(line)
    html = "\n".join(out) + "\n"
    for k, v in MACROS.items():
        html = html.replace("@@%s@@" % k, v)
    data = json.dumps({"info": INFO, "check": CHECK, "log": LOG,
                       "env": [{"k": k, "v": v} for k, v in ENV]},
                      ensure_ascii=False)
    stub = STUB.replace("@DATA@", data)
    return html.replace("</head>", stub + "</head>", 1)


def main():
    args = [a for a in sys.argv[1:] if a != "--no-stock"]
    stock = "--no-stock" not in sys.argv[1:]
    html = open(args[0], encoding="utf-8").read()
    # argv[2] is written over, so it is the destination and never the source.
    dst = args[1] if len(args) > 1 else "preview.html"
    open(dst, "w", encoding="utf-8", newline="").write(render(html, stock))
    print("wrote", dst, "(no stock)" if not stock else "")


if __name__ == "__main__":
    main()
