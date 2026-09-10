// Airoha Web U-Boot -- cases for ../page.html.
//
// The page is the part of this project a user actually touches, and the one
// part that cannot be checked by compiling.  So it is driven here instead:
// preview.py renders exactly the HTML the device serves, with a stub device
// answering every request the page makes, and these cases drive that document
// in jsdom.  The stub answers what the real endpoints answer, so a case that
// passes here is a case about the real page -- not about a copy of it.
//
//     cd package/boot/uboot-airoha/files/httpd/test
//     npm install && npm test
//
// Needs python3 for preview.py; set PYTHON= to override the interpreter name.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const HERE = __dirname;
const HTML = path.join(HERE, 'preview.html');
// The same page as a board without CMD_HTTPD_STOCK_RESTORE serves it.  Kept
// as a second document rather than a flag on boot(), because what is being
// checked is what the STOCK markers cut out -- and that is decided while the
// page is rendered, not while it runs.
const HTML_NOSTOCK = path.join(HERE, 'preview-nostock.html');
const PY = process.env.PYTHON ||
	(process.platform === 'win32' ? 'python' : 'python3');

// Render first, always: a stale preview.html would test yesterday's page.
const SRC = path.join(HERE, '..', 'page.html');
const PREVIEW = path.join(HERE, '..', 'preview.py');
execFileSync(PY, [PREVIEW, SRC, HTML], { stdio: 'inherit' });
execFileSync(PY, [PREVIEW, '--no-stock', SRC, HTML_NOSTOCK], { stdio: 'inherit' });
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  <' + extra + '>' : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(src) {
  // jsdom cannot navigate, so a location.reload() surfaces as a jsdomError;
  // that is how the tests observe whether the page decided to reload.
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push(String(e && e.message)));
  const dom = new JSDOM(fs.readFileSync(src || HTML, 'utf8'), {
    url: 'http://192.168.1.1/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  w.__errs = errs;
  await new Promise(r => w.addEventListener('load', r));
  await sleep(600);
  return w;
}
const $ = (w, s) => w.document.querySelector(s);
const txt = (w, s) => ($(w, s) || {}).textContent || '';
const on = (w, s) => $(w, s).hasAttribute('data-on');
const navs = (w) => Array.from(w.document.querySelectorAll('.nav'));
function setsel(w, id, v) { const s = $(w, '#pv' + id); s.value = v; s.onchange(); }
/* 偏移要经 oninput 改，「擦净尾部」的默认值跟着它走 */
function setoff(w, v) { const e = $(w, '#p4 input[name=stockoff]'); e.value = v; e.oninput(); }

(async () => {
  console.log('\n--- 备份下载 (p10) ---');
  {
    const w = await boot();
    ok('侧栏有备份下载入口', !!$(w, '.nav[data-p=p10]'));
    $(w, '.nav[data-p=p10]').click();
    ok('点进去切到 p10', on(w, '#p10'));

    const rows = [...w.document.querySelectorAll('#dl tr')];
    ok('七个卷都列出来了', rows.length === 7, rows.length);
    ok('出厂数据排在最前', /^(ri|bosa)/.test(rows[0].cells[0].textContent) &&
                          /^(ri|bosa)/.test(rows[1].cells[0].textContent),
       rows.map(r => r.cells[0].textContent).join(','));
    ok('出厂卷带标记', !!rows[0].querySelector('.tag') && !rows[2].querySelector('.tag'));
    /* dynamic 卷的 used_bytes 恒等于预留，只有 static 的 fip 分得出来 */
    ok('static 卷的大小取已用而非预留',
       rows.find(r => /^fip/.test(r.cells[0].textContent)).cells[2].textContent === '318 KiB',
       rows.find(r => /^fip/.test(r.cells[0].textContent)).cells[2].textContent);

    let url = null;
    w.sink = (u, what, n) => { url = u; };
    rows.find(r => /^ri/.test(r.cells[0].textContent)).querySelector('button').click();
    ok('卷下载走 /dump?vol=', url === '/dump?vol=ri', url);

    w.dumpall();
    ok('整片下载不带 len，交给设备去数', url === '/dump?off=0x0', url);

    $(w, '#dumpoff').value = '0x20000'; $(w, '#dumplen').value = '';
    w.dumpraw();
    ok('留空长度也不带 len', url === '/dump?off=0x20000', url);

    url = null;
    $(w, '#dumpoff').value = '0x0'; $(w, '#dumplen').value = '0x20000000';
    w.dumpraw();
    ok('超出容量不发请求',
       url === null && /超过 flash 容量/.test(txt(w, '#dlh')), txt(w, '#dlh'));
    $(w, '#dumpoff').value = 'zz'; w.dumpraw();
    ok('偏移不是十六进制不发请求', url === null && /十六进制/.test(txt(w, '#dlh')));
    ok('长度提示报的是整片容量',
       txt(w, '#dumphint').includes(w.sz(w.INFO.flash.size)),
       txt(w, '#dumphint'));

    /* 位置保持：坏块在文件里占着位子，所以整片就是标称容量 */
    url = null;
    $(w, '#dumpoff').value = '0x0';
    $(w, '#dumplen').value = '0x' + w.INFO.flash.size.toString(16);
    w.dumpraw();
    ok('整整一片的长度是收的',
       url === '/dump?off=0x0&len=0x' + w.INFO.flash.size.toString(16), url);
    ok('设备详情里没有 good 这个字段', w.INFO.flash.good === undefined);
    ok('p10 上回车不弹写入确认框', w.ask() === false && !on(w, '#mask'));
  }

  console.log('\n--- 没有 UBI 时的备份下载 ---');
  {
    const w = await boot();
    setsel(w, 'dev', 'noubi');
    await sleep(600);
    $(w, '.nav[data-p=p10]').click();
    ok('提示改用原始区段', /原始区段/.test(txt(w, '#dl')));
  }

  console.log('\n--- 环境变量 (p11) ---');
  {
    const w = await boot();
    ok('侧栏有环境变量入口', !!$(w, '.nav[data-p=p11]'));
    $(w, '.nav[data-p=p11]').click();
    await sleep(600);
    let rows = [...w.document.querySelectorAll('#envt tr')];
    ok('把 env 全列出来', rows.length === 29, rows.length);
    ok('计数对得上', /29 \/ 29 项/.test(txt(w, '#envh')), txt(w, '#envh'));

    $(w, '#envq').value = 'bootmenu'; w.envfill();
    ok('按名称过滤', w.document.querySelectorAll('#envt tr').length === 3);
    $(w, '#envq').value = 'remove rootfs_data'; w.envfill();
    rows = [...w.document.querySelectorAll('#envt tr')];
    ok('按值也能过滤', rows.length === 1 &&
       /ubi_write_production/.test(rows[0].cells[0].textContent));
    $(w, '#envq').value = '没有这个'; w.envfill();
    ok('没有匹配时说清楚', /没有匹配的变量/.test(txt(w, '#envt')));

    $(w, '#envq').value = ''; $(w, '#envkey').checked = true; w.envfill();
    const names = [...w.document.querySelectorAll('#envt tr')].map(r => r.cells[0].textContent);
    ok('只看关键项筛掉噪声', names.length === 20 && !names.includes('stdin'), names.length);
    ok('关键项留下 bootcmd 与版本号',
       names.includes('bootcmd') && names.includes('web_uboot_envver'));

    $(w, '#envkey').checked = false; w.envfill();
    w.askenvdef();
    ok('恢复默认弹确认框', on(w, '#mask'));
    ok('确认框写明命令', /env default -a && saveenv/.test(txt(w, '#abody')));
    ok('确认框说清出厂 MAC 不受影响', /出厂 MAC/.test(txt(w, '#abody')));
    ok('主按钮改成恢复默认', txt(w, '#yes') === '恢复默认');
    $(w, '#mask button.pb:not(.red)').click();
    ok('取消就什么都不做', !on(w, '#mask') && w.YES === null);

    w.askenvdef();
    $(w, '#yes').click();
    await sleep(600);
    ok('恢复成功说重启后生效', /已恢复并保存，重启后生效/.test(txt(w, '#envdh')), txt(w, '#envdh'));
  }

  console.log('\n--- 改过环境的动作也让体检作废 ---');
  {
    const w = await boot();
    /* envver、bootcmd、引导菜单这三项体检都在看 */
    w.CHK = [{ n: 'bootcmd', s: 0, v: '旧的', g: '引导' }];
    w.envdef();
    await sleep(600);
    ok('恢复默认环境之后作废', w.CHK === null, String(w.CHK));

    w.CHK = [{ n: 'bootcmd', s: 0, v: '旧的', g: '引导' }];
    w.ENV = [{ k: 'bootcmd', v: '旧的' }];
    w.bootonce();
    await sleep(600);
    ok('设过一次性引导入口之后也作废', w.CHK === null, String(w.CHK));
    /* bootonce 改的就是 bootcmd，环境变量那一页照抄旧值只会误导 */
    ok('环境变量那一页也跟着作废', w.ENV === null, String(w.ENV));
  }

  console.log('\n--- UBI 挂不上时恢复默认环境 ---');
  {
    const w = await boot();
    setsel(w, 'dev', 'noubi');
    await sleep(600);
    $(w, '.nav[data-p=p11]').click();
    await sleep(600);
    w.askenvdef();
    $(w, '#yes').click();
    await sleep(600);
    ok('保存失败要说明改动没落盘', /保存失败.*仅存于内存/.test(txt(w, '#envdh')), txt(w, '#envdh'));
    /* 结果不能被紧随其后的重新读取写掉 —— CI 上就是这么红的 */
    await sleep(900);
    ok('重新读取之后结果还在', /保存失败/.test(txt(w, '#envdh')),
       txt(w, '#envdh'));
  }

  console.log('\n--- 心跳与断开 ---');
  {
    const w = await boot();
    ok('侧栏显示已连接', txt(w, '#lives') === '已连接', txt(w, '#lives'));
    ok('连接标识在侧栏底部', !!$(w, '.side .foot #lived'));
    ok('点是绿的', $(w, '#lived').className === 'dot s0', $(w, '#lived').className);
    ok('一切正常时没有覆盖层', !on(w, '#off'));

    setsel(w, 'conn', 'down');
    await sleep(4500);                       // 心跳 3s 一次，失败判定 0.9s
    ok('掉一次只转黄不弹框', !on(w, '#off') && $(w, '#lived').className === 'dot s1',
       $(w, '#lived').className);
    await sleep(4500);                       // 第二次失败才算断开
    ok('连掉两次才弹框', on(w, '#off'));
    ok('说的是已断开', /连接已断开/.test(txt(w, '#offt')), txt(w, '#offt'));
    ok('给了排查线索', /网线|重启|写入/.test(txt(w, '#offb')));
    ok('有重新连接按钮', !$(w, '#offr').hidden);
    ok('点变红', $(w, '#lived').className === 'dot s2');

    $(w, '#offr').click();
    ok('重连按钮进入重试态', $(w, '#offr').disabled);

    setsel(w, 'conn', 'up');
    await sleep(4000);
    ok('设备回来覆盖层自己消失', !on(w, '#off'));
    ok('回来之后点转绿', $(w, '#lived').className === 'dot s0');
    ok('同一次上电不刷新页面', !w.__errs.some(e => /navigation/i.test(e)),
       w.__errs.join('|'));
  }

  console.log('\n--- 自己发起的读取不打扰 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p10]').click();
    /* 整片在桩里要跑十几秒（真机是十几分钟），
       而这里验的是「读取期间不打扰」，不是快慢 */
    $(w, '#dumpoff').value = '0x0';
    $(w, '#dumplen').value = '0x4000000';
    w.dumpraw();
    /*
     * 心跳是 3 秒一次的，得等真的轮到一次、并且那一次打不通。传输在桩里跑
     * 6.7 秒，5 秒这个点两边都稳：至少有一次心跳失败了，传输还没结束。
     */
    await sleep(5000);
    ok('备份期间不弹框', !on(w, '#off'));
    /*
     * net/tcp.c 只有一条流，下载那条连接从头开到尾 —— 所以这期间心跳也打不
     * 通，点本来就该转黄。以前这里断言「一直是绿的」，那是桩只静默 900 ms 的
     * 产物，真设备上从来不是这样。
     */
    ok('边读边传时点转黄', $(w, '#lived').className === 'dot s1',
       $(w, '#lived').className);
    ok('点旁边写设备忙', /设备忙/.test(txt(w, '#lives')), txt(w, '#lives'));
    await sleep(9000);
    ok('传完点转回绿', $(w, '#lived').className === 'dot s0',
       $(w, '#lived').className);
    ok('传完记了一行', w.document.querySelectorAll('#dll tr').length === 1);

    // 真正拖住设备的是体检那种全片扫描：那时只变点，不盖框
    w.silent();
    setsel(w, 'conn', 'down');
    await sleep(9000);
    ok('长时间静默也不弹框', !on(w, '#off'));
    ok('点旁边说设备忙', /设备忙/.test(txt(w, '#lives')), txt(w, '#lives'));

    setsel(w, 'conn', 'up');
    await sleep(4000);
    ok('回来就恢复已连接', txt(w, '#lives') === '已连接', txt(w, '#lives'));
    ok('全程没弹过框', !on(w, '#off'));
  }

  console.log('\n--- 体检期间也不弹框 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p8]').click();
    await sleep(2200);
    ok('体检跑完且没弹框', !on(w, '#off') && /16 项正常/.test(txt(w, '#chkh')));
  }

  console.log('\n--- 重启 (p12) ---');
  {
    const w = await boot();
    ok('侧栏有重启入口', !!$(w, '.nav[data-p=p12]'));
    $(w, '.nav[data-p=p12]').click();
    ok('点进去切到 p12', on(w, '#p12'));
    ok('说清闪存不受影响', /不改动闪存/.test(txt(w, '#p12')));
    ok('重启页不啰嗦', txt(w, '#p12').replace(/\s/g, '').length < 300,
       txt(w, '#p12').replace(/\s/g, '').length);

    $(w, '#p12 button.red').click();
    ok('重启要确认', on(w, '#mask') && /reset/.test(txt(w, '#abody')));
    ok('主按钮是立即重启', txt(w, '#yes') === '立即重启');
    $(w, '#yes').click();
    await sleep(300);
    ok('立刻说设备在重启', on(w, '#off') && /设备正在重启/.test(txt(w, '#offt')), txt(w, '#offt'));
    ok('重启时不给重连按钮', $(w, '#offr').hidden);
    ok('并说会自动刷新', /自动刷新/.test(txt(w, '#offb')));
    ok('重启提示不啰嗦', txt(w, '#offb').replace(/\s/g, '').length < 40,
       txt(w, '#offb').replace(/\s/g, '').length);
  }

  console.log('\n--- 写入过程与结果框 ---');
  {
    const w = await boot();
    /* 先跑一遍体检：写完之后它读的那片闪存已经不是这一份了 */
    $(w, '.nav[data-p=p8]').click();
    await sleep(2200);
    const chk0 = w.CHK;
    ok('写之前体检跑过一遍', !!chk0 && chk0.length > 0);
    $(w, '.nav[data-p=p1]').click();
    const i = $(w, '#p1 input[name=firmware]');
    Object.defineProperty(i, 'files', {
      value: [new w.File([new Uint8Array(1024)], 'x.itb')], configurable: true });
    w.send();
    ok('上传期间不发心跳', w.HBOFF === 1);
    /* 写入期间设备还在服务，侧栏里改地址、恢复默认、重启都会动到写了一半
       的闪存。灰掉不够，键盘 Tab 过去按回车照样能走 —— 得真禁掉。 */
    ok('写入期间侧栏按钮真被禁用',
       navs(w).length > 0 && navs(w).every(b => b.disabled));

    await sleep(3000);
    ok('报出正在写哪一步', /写入 固件…/.test(txt(w, '#p1 .pwhat')),
       txt(w, '#p1 .pwhat'));
    /* 写那一步在环境变量的配方里，设备报不出中间态 —— 只能给个估计 */
    ok('写入那段只有估计', /预计/.test(txt(w, '#p1 .pct')), txt(w, '#p1 .pct'));

    await sleep(3000);
    ok('走到回读校验', /回读校验/.test(txt(w, '#p1 .pwhat')), txt(w, '#p1 .pwhat'));
    ok('校验那段有真百分比', /%/.test(txt(w, '#p1 .pct')), txt(w, '#p1 .pct'));

    await sleep(3600);
    ok('弹出结果框', on(w, '#rmask'));
    ok('列出写了什么，并带 crc32',
       /固件/.test(txt(w, '#rbody')) && /crc32/.test(txt(w, '#rbody')),
       txt(w, '#rbody').slice(0, 100));
    ok('报了回读校验通过', /通过/.test(txt(w, '#rbody')));
    ok('两条路都给', /留在恢复页/.test(txt(w, '#rmask .btns')) &&
       /立即重启/.test(txt(w, '#rmask .btns')), txt(w, '#rmask .btns'));
    ok('不再自己跳完成页', !on(w, '#p7'));
    ok('侧栏解锁了', !$(w, '#app').hasAttribute('data-busy'));
    ok('侧栏按钮跟着解禁', navs(w).every(b => !b.disabled));
    ok('心跳回来了', w.HB === 1, String(w.HB));
    ok('实测速度记下来给下次估算', +w.localStorage.getItem('xgwrspd') > 0,
       w.localStorage.getItem('xgwrspd'));

    /*
     * 卷刚建出来、ri/bosa 刚写进去，再进「诊断」却还摆着写之前那一份结果，
     * 看上去就像没写成 —— 报过的就是这个。
     */
    ok('写完之后旧的体检结果作废', w.CHK === null, String(w.CHK));

    w.rhide();
    ok('留在恢复页就把框关掉', !on(w, '#rmask'));
    ok('进度条停在写入完成', /写入完成/.test(txt(w, '#p1 .pwhat')) &&
       $(w, '#p1 .prog').className === 'prog ok', txt(w, '#p1 .pwhat'));

    $(w, '.nav[data-p=p8]').click();
    await sleep(2200);
    ok('再进诊断是重跑出来的', !!w.CHK && w.CHK !== chk0);
  }

  console.log('\n--- 写坏了不弹框 ---');
  {
    const w = await boot();
    setsel(w, 'post', 'fail500');
    const i = $(w, '#p1 input[name=firmware]');
    Object.defineProperty(i, 'files', {
      value: [new w.File([new Uint8Array(1024)], 'x.itb')], configurable: true });
    w.send();
    await sleep(6000);
    ok('没有结果框', !on(w, '#rmask'));
    ok('进度条转红', $(w, '#p1 .prog').className === 'prog bad',
       $(w, '#p1 .prog').className);
    ok('设备那句话带出来', /写入失败/.test(txt(w, '#p1 .pwhat')),
       txt(w, '#p1 .pwhat'));
    ok('按钮放回来，能重传', !$(w, '#p1 button[type=submit]').disabled);
  }

  console.log('\n--- 备份完之后能核对 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p10]').click();
    [...w.document.querySelectorAll('#dl tr')]
      .find(r => /^ri/.test(r.cells[0].textContent))
      .querySelector('button').click();
    await sleep(700);
    ok('先说正在读并传送', /正在读取并传送 ri 卷/.test(txt(w, '#dlh')), txt(w, '#dlh'));
    ok('读的时候还没有 crc', !/crc32/.test(txt(w, '#dlh')));
    await sleep(4500);
    ok('传完出现一行记录', w.document.querySelectorAll('#dll tr').length === 1);
    const row = $(w, '#dll tr');
    ok('记录带文件名', /\.bin$/.test(row.cells[0].textContent), row.cells[0].textContent);
    /* dynamic 卷没有「内容多长」这回事，整卷都得下 */
    ok('记录带长度', row.cells[1].textContent === '372 KiB', row.cells[1].textContent);
    ok('记录带 crc32', /^[0-9a-f]+$/.test(row.cells[2].textContent), row.cells[2].textContent);
    ok('说清这个数怎么用', /本地文件核对/.test(txt(w, '#dllh')));
    ok('说清长度不受限', /不限长度/.test(txt(w, '#p10')));
    ok('读取期间没弹断开框', !on(w, '#off'));

    // 分段存档的人需要每一段的 crc，新的不能盖掉旧的
    [...w.document.querySelectorAll('#dl tr')]
      .find(r => /^bosa/.test(r.cells[0].textContent))
      .querySelector('button').click();
    await sleep(5200);
    const rows = [...w.document.querySelectorAll('#dll tr')];
    ok('第二段往下排而不是覆盖', rows.length === 2, rows.length);
    ok('两段的 crc 不一样', rows[0].cells[2].textContent !== rows[1].cells[2].textContent);
  }

  console.log('\n--- 整片就是一个文件 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p10]').click();
    let url = null;
    w.dlstart = u => { url = u; };

    w.dumpall();
    await sleep(600);
    ok('整片一次要到底', url === '/dump?off=0x0', url);
    ok('没有「下一段」这种东西', !$(w, '#dlnext'));
    ok('长度未知时说的是到片尾', /到片尾/.test(txt(w, '#dlh')), txt(w, '#dlh'));

    $(w, '#dumpoff').value = '0x20000'; $(w, '#dumplen').value = '';
    w.dumpraw();
    await sleep(600);
    ok('留空长度读到片尾', url === '/dump?off=0x20000', url);

    url = null;
    $(w, '#dumpoff').value = '0x0';
    $(w, '#dumplen').value = '0x' + (w.INFO.flash.size + 0x20000).toString(16);
    w.dumpraw();
    ok('还是拦得住超出容量的', url === null &&
       /超过 flash 容量/.test(txt(w, '#dlh')), txt(w, '#dlh'));
  }

  console.log('\n--- 读不出来的块要报出来 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p10]').click();
    w.dlrow({ name: 'nokia-xg-040g-md-flash.bin', len: 268435456,
              crc: '3f2a91c4', holes: 3 });
    ok('洞数写在状态行上', /3 个块读取失败/.test(txt(w, '#dlh')), txt(w, '#dlh'));
    ok('填的是什么也说了', /ff/.test(txt(w, '#dlh')));
    ok('那一行带标记', /3 块读取失败/.test($(w, '#dll').textContent));

    w.dlrow({ name: 'nokia-xg-040g-md-ri.bin', len: 65536,
              crc: 'aabbccdd', holes: 0 });
    ok('没有洞就还是「传输完成」', txt(w, '#dlh') === '传输完成', txt(w, '#dlh'));
    ok('那一行不带标记',
       !/读取失败/.test([...$(w, '#dll').querySelectorAll('tr')].pop().textContent));
  }

  console.log('\n--- 设备拒绝时不用干等四分钟 ---');
  {
    /*
     * 下载走隐藏 iframe：真下载会被浏览器接走、不触发 load，只有错误页会。
     * 这里直接喂给 dlrefused()，不必让 jsdom 真去导航一个 iframe。
     */
    const w = await boot();
    $(w, '.nav[data-p=p10]').click();
    w.dlstart = () => {};
    w.dumpall();
    await sleep(50);
    ok('先报在读', /正在读/.test(txt(w, '#dlh')), txt(w, '#dlh'));

    w.dlrefused({ contentDocument: { body: { textContent: '  \n ' } } });
    ok('空白的 load 不当成错误',
       w.DLBAD === 0 && /正在读/.test(txt(w, '#dlh')), txt(w, '#dlh'));

    w.dlrefused({ contentDocument: { body: { textContent:
      ' 从 0x0 起只读得出 268173312 字节（已扣掉坏块），要不了 268435456\n' } } });
    ok('拒绝的理由当场显示', /只读得出/.test(txt(w, '#dlh')), txt(w, '#dlh'));
    ok('理由里的换行被压平', !/\n/.test(txt(w, '#dlh')));
    ok('不再等 /dumpinfo', w.DLBAD === 1);

    const before = txt(w, '#dlh');
    await sleep(2400);
    ok('轮询确实停了', txt(w, '#dlh') === before, txt(w, '#dlh'));
  }

  console.log('\n--- 刷回原厂写到一半失败 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    const pick = () => {
      const i = $(w, '#p4 input[name=stock]');
      const f = new w.File([new Uint8Array(4)], 'all_flash.bin');
      Object.defineProperty(f, 'size', { value: 1 << 20 });
      Object.defineProperty(i, 'files', { value: [f], configurable: true });
    };

    pick();
    setsel(w, 'post', 'fail500');
    w.send();
    await sleep(3200);
    ok('没跑去完成页', !on(w, '#p13') && !on(w, '#p7'));
    ok('说的是写入失败不是被拒绝',
       /设备写入失败（500）/.test(txt(w, '#p4 .pwhat')), txt(w, '#p4 .pwhat'));
    ok('设备那句话完整带出来',
       /闪存已写入一部分/.test(txt(w, '#p4 .pwhat')) &&
       /不要断电/.test(txt(w, '#p4 .pwhat')));
    ok('长句不再被省略号切掉',
       w.getComputedStyle($(w, '#p4 .pwhat')).whiteSpace === 'normal',
       w.getComputedStyle($(w, '#p4 .pwhat')).whiteSpace);
    ok('顶上挂出不一致的红条', !$(w, '#ban').hasAttribute('hidden') &&
       /不要重启设备/.test(txt(w, '#bant')), txt(w, '#bant'));
    ok('按钮还能再来一次', !$(w, '#p4 button[type=submit]').disabled &&
       txt(w, '#p4 button[type=submit]') === '刷写');

    /* 换到别的页红条也得跟着 —— 它说的是设备的状态，不是这一页的 */
    $(w, '.nav[data-p=p1]').click();
    ok('切页红条还在', !$(w, '#ban').hasAttribute('hidden'));

    $(w, '.nav[data-p=p4]').click();
    pick();
    setsel(w, 'post', 'ok');
    w.send();
    await sleep(3200);
    ok('重写成功后落到完成页', on(w, '#p13'));
    ok('红条跟着消失', $(w, '#ban').hasAttribute('hidden'));
  }

  console.log('\n--- 400 是没开始写，不该吓人 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    const i = $(w, '#p4 input[name=stock]');
    const f = new w.File([new Uint8Array(4)], 'all_flash.bin');
    Object.defineProperty(f, 'size', { value: 1 << 20 });
    Object.defineProperty(i, 'files', { value: [f], configurable: true });
    setsel(w, 'post', 'reject');
    w.send();
    await sleep(3200);
    ok('说的是被拒绝', /设备拒绝了上传（400）/.test(txt(w, '#p4 .pwhat')),
       txt(w, '#p4 .pwhat'));
    ok('不挂不一致的红条', $(w, '#ban').hasAttribute('hidden'));
  }

  console.log('\n--- 刷回原厂写完是它自己的完成页 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    const i = $(w, '#p4 input[name=stock]');
    const f = new w.File([new Uint8Array(4)], 'all_flash.bin');
    Object.defineProperty(f, 'size', { value: 1 << 20 });
    Object.defineProperty(i, 'files', { value: [f], configurable: true });
    w.send();
    await sleep(3200);
    ok('不落到上传完成页', !on(w, '#p7'));
    ok('落到写入完成页', on(w, '#p13'));
    ok('标题是写入完成', txt(w, '#p13 h1') === '写入完成', txt(w, '#p13 h1'));
    ok('说的是已经写完而不是正在写', !/正在写入/.test(txt(w, '#p13 .sub')),
       txt(w, '#p13 .sub'));

    const rows = [...w.document.querySelectorAll('#stres tr')];
    ok('设备回报四项都在', rows.length === 4, rows.length);
    ok('写入长度对得上', /1\.0 MiB/.test(rows[0].textContent),
       rows[0].textContent);
    ok('crc32 报出来了', /^[0-9a-f]{1,8}$/.test(rows[1].cells[1].textContent),
       rows[1].cells[1].textContent);
    ok('没有坏块就写无', rows[2].cells[1].textContent === '无',
       rows[2].cells[1].textContent);
    /* 1 MiB 的镜像落在 256 MiB 的片子上，尾巴 255 MiB = 2040 个 128 KiB 块 */
    ok('第四项是擦净尾部', /擦净尾部/.test(rows[3].cells[0].textContent),
       rows[3].cells[0].textContent);
    ok('擦净的块数和容量都报了',
       /2040 块/.test(rows[3].cells[1].textContent) &&
       /255[.,]0 MiB/.test(rows[3].cells[1].textContent),
       rows[3].cells[1].textContent);
    ok('说清 crc32 拿来跟备份对', /与备份时记录的值一致/.test(txt(w, '#p13')));
    ok('心跳停了', w.HB === 0);

    w.stdone('ok 100 bytes crc32 aabbccdd skipped 3');
    ok('跳过的坏块说清楚',
       /跳过 3 块/.test($(w, '#stres').textContent),
       $(w, '#stres').textContent);
    w.stdone('something else entirely');
    ok('回报不认识就原样贴出',
       /something else entirely/.test($(w, '#stres').textContent));
  }

  console.log('\n--- 刷回原厂只有「刷写」一个动作 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    ok('按钮就叫刷写', txt(w, '#p4 button[type=submit]') === '刷写',
       txt(w, '#p4 button[type=submit]'));
    ok('别的页还是上传并刷写',
       txt(w, '#p1 button[type=submit]') === '上传并刷写');
    ok('说清是边收边写', /边接收边写入/.test(txt(w, '#p4')));

    const i = $(w, '#p4 input[name=stock]');
    const f = new w.File([new Uint8Array(4)], 'all_flash.bin');
    Object.defineProperty(f, 'size', { value: 1 << 20 });
    Object.defineProperty(i, 'files', { value: [f], configurable: true });
    setsel(w, 'post', 'drop');
    w.send();
    ok('进行中不叫上传中',
       txt(w, '#p4 button[type=submit]') === '写入中\u2026',
       txt(w, '#p4 button[type=submit]'));
    await sleep(3200);
    ok('失败后按钮还原成刷写', txt(w, '#p4 button[type=submit]') === '刷写',
       txt(w, '#p4 button[type=submit]'));
  }

  console.log('\n--- 刷回原厂：整片多大都收，走裸端点 ---');
  {
    const w = await boot();
    const max = w.INFO.uploadmax;
    ok('设备报了上传上限', max > 0, max);
    $(w, '.nav[data-p=p4]').click();
    ok('页上写的是 flash 容量而不是内存上限',
       txt(w, '#upmax') === w.sz(w.INFO.flash.size), txt(w, '#upmax'));

    const pick = (n) => {
      const i = $(w, '#p4 input[name=stock]');
      const f = new w.File([new Uint8Array(1)], 'all_flash.bin');
      Object.defineProperty(f, 'size', { value: n });
      Object.defineProperty(i, 'files', { value: [f], configurable: true });
    };

    /* 整片 256 MiB 比内存上限还大 —— 流式之后这不该再是错误 */
    pick(w.INFO.flash.size);
    w.ask();
    ok('整片不再被内存上限拦下',
       !/超过设备单次可接收的/.test(txt(w, '#abody')), txt(w, '#abody'));
    ok('还是给「仍要写入」', !$(w, '#yes').hidden);
    w.hide();

    pick(0xEBA0000);
    w.ask();
    ok('原厂镜像照样放行', !$(w, '#yes').hidden);
    w.hide();
  }

  console.log('\n--- 刷回原厂发的是裸 body，不是表单 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    const i = $(w, '#p4 input[name=stock]');
    const f = new w.File([new Uint8Array(4)], 'all_flash.bin');
    Object.defineProperty(f, 'size', { value: 0x10000000 });
    Object.defineProperty(i, 'files', { value: [f], configurable: true });
    setoff(w, '0x8000000');

    let sent = null;
    const XHR = w.XMLHttpRequest;
    w.XMLHttpRequest = function () {
      const x = new XHR();
      const open = x.open.bind(x), send = x.send.bind(x);
      x.open = (m, u) => { sent = { m, u }; return open(m, u); };
      x.send = (b) => { sent.body = b; return send(b); };
      return x;
    };
    w.send();
    w.XMLHttpRequest = XHR;

    /* 偏移非 0 是写单个分区，擦尾会连它后面的东西一起带走 —— 默认松勾 */
    ok('走 /stock，带偏移但不带擦净标记',
       sent && sent.u === '/stock?off=0x8000000', sent && sent.u);
    ok('body 就是文件本身，没有 FormData 包装',
       sent && sent.body === f, sent && String(sent.body));

    /* 偏移 0 是整片写回，擦掉镜像之后的残留是对的，默认仍旧勾着 */
    let sent3 = null;
    const w3 = await boot();
    $(w3, '.nav[data-p=p4]').click();
    ok('擦净尾部在偏移 0 时默认勾着', $(w3, '#p4 input[name=wipe]').checked);
    const i3 = $(w3, '#p4 input[name=stock]');
    const f3 = new w3.File([new Uint8Array(4)], 'all_flash.bin');
    Object.defineProperty(f3, 'size', { value: 0x10000000 });
    Object.defineProperty(i3, 'files', { value: [f3], configurable: true });
    setoff(w3, '0x0');
    const XHR3 = w3.XMLHttpRequest;
    w3.XMLHttpRequest = function () {
      const x = new XHR3();
      const open = x.open.bind(x);
      x.open = (m, u) => { sent3 = { m, u }; return open(m, u); };
      return x;
    };
    w3.send();
    w3.XMLHttpRequest = XHR3;
    ok('偏移 0 照旧带擦净标记',
       sent3 && sent3.u === '/stock?off=0x0&wipe=1', sent3 && sent3.u);

    /* 别的页仍然是表单 */
    let sent2 = null;
    const w2 = await boot();
    $(w2, '.nav[data-p=p1]').click();
    const i2 = $(w2, '#p1 input[name=firmware]');
    const f2 = new w2.File([new Uint8Array(4)], 'x.itb');
    Object.defineProperty(i2, 'files', { value: [f2], configurable: true });
    const XHR2 = w2.XMLHttpRequest;
    w2.XMLHttpRequest = function () {
      const x = new XHR2();
      const open = x.open.bind(x), send = x.send.bind(x);
      x.open = (m, u) => { sent2 = { m, u }; return open(m, u); };
      x.send = (b) => { sent2.body = b; return send(b); };
      return x;
    };
    w2.send();
    w2.XMLHttpRequest = XHR2;
    ok('引导升级还是 POST /', sent2 && sent2.u === '/', sent2 && sent2.u);
    ok('引导升级还是 FormData',
       sent2 && sent2.body instanceof w2.FormData, sent2 && String(sent2.body));
  }

  console.log('\n--- 备份的进度条只说它知道的 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p10]').click();
    await sleep(400);
    ok('还没开始时不占地方', $(w, '#dlprog').hidden);
    ok('那条说明也收着', $(w, '#dlwhy').hidden);

    $(w, '#dumpoff').value = '0x0';
    $(w, '#dumplen').value = '0x4000000';
    w.dumpraw();
    await sleep(700);
    ok('开始就露出来', !$(w, '#dlprog').hidden);
    ok('先说在读哪一段', /正在读取并传送/.test(txt(w, '#dlprog .pwhat')),
       txt(w, '#dlprog .pwhat'));
    ok('给了总长度', /MiB|KiB/.test(txt(w, '#dlprog .pct')),
       txt(w, '#dlprog .pct'));

    /*
     * 字节进度是问不到的：net/tcp.c 里只有一个 static struct tcp_stream，旧连接
     * 没进 CLOSED 之前新 SYN 直接被拒，而下载那条从浏览器点「保存」一直开到传
     * 完 —— /dumpinfo 在这期间根本连不上设备。
     *
     * 这四条以前断言的是百分比、速率、剩余时间，全绿，因为桩是并发应答的；真
     * 设备上那几个数一次都没出现过。判据自己错了比没有判据更坏，所以改成断言
     * 它确实没有假装知道，并且把去哪儿看说清楚了。
     */
    await sleep(4200);
    ok('进度条是不确定那根', $(w, '#dlprog .pbar').className.includes('ind'),
       $(w, '#dlprog .pbar').className);
    ok('不摆假百分比', !/%/.test(txt(w, '#dlprog .pct')), txt(w, '#dlprog .pct'));
    ok('说清了为什么没有字节数', !$(w, '#dlwhy').hidden &&
       /只有一条连接/.test(txt(w, '#dlwhy')), txt(w, '#dlwhy'));
    ok('指了去哪儿看', /浏览器自己的下载栏/.test(txt(w, '#dlwhy')));

    await sleep(9000);
    ok('传完转绿', $(w, '#dlprog').className === 'prog ok',
       $(w, '#dlprog').className);
    ok('传完那行说传输完成', /传输完成/.test(txt(w, '#dlprog .pwhat')),
       txt(w, '#dlprog .pwhat'));
    ok('传完把那条说明收起来', $(w, '#dlwhy').hidden);
    ok('完成记录也照旧', w.document.querySelectorAll('#dll tr').length === 1);
  }

  console.log('\n--- 串口日志实时跟随 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p8]').click();
    $(w, '#logtab').click();
    await sleep(600);
    const first = txt(w, '#log');
    ok('先按老路整段读出来', /probing by address aliasing/.test(first));
    ok('缓冲没满就不提这茬', $(w, '#logovf').hidden);

    $(w, '#logf').checked = true;
    w.logfollow();
    ok('跟随时不让人再手点读取', $(w, '#logb').disabled);
    await sleep(900);
    ok('跟随第一次就把全文取回来',
       /probing by address aliasing/.test(txt(w, '#log')), txt(w, '#log').length);
    ok('偏移是设备给的，不是页面数的', w.LOGN > 0, w.LOGN);

    const n1 = w.LOGN, t1 = txt(w, '#log');
    await sleep(5200);
    ok('日志自己长了出来', w.LOGN > n1, w.LOGN + ' vs ' + n1);
    ok('新内容是追加不是重画', txt(w, '#log').indexOf(t1) === 0);
    ok('没有把旧内容再贴一遍',
       txt(w, '#log').split('probing by address aliasing').length === 2,
       txt(w, '#log').split('probing by address aliasing').length);

    $(w, '#logf').checked = false;
    w.logfollow();
    const n2 = w.LOGN;
    await sleep(4200);
    ok('关掉就真的停了', w.LOGN === n2, w.LOGN + ' vs ' + n2);
    ok('按钮也放开了', !$(w, '#logb').disabled);
  }

  console.log('\n--- 上传时报速率与剩余时间 ---');
  {
    const w = await boot();
    const i = $(w, '#p1 input[name=firmware]');
    /* size 得是真的：进了 FormData 之后桩按 Blob 自己的长度算 */
    const f = new w.File([new Uint8Array(4 << 20)], 'x.itb');
    Object.defineProperty(i, 'files', { value: [f], configurable: true });
    w.send();
    await sleep(2200);
    const pct = txt(w, '#p1 .pct');
    ok('还是有百分比', /%/.test(pct), pct);
    ok('报了速率', /(MiB|KiB|B)\/s/.test(pct), pct);
    ok('报了剩余时间', /剩余 /.test(pct), pct);
    ok('正在上传哪个文件也还在', /正在上传/.test(txt(w, '#p1 .pwhat')),
       txt(w, '#p1 .pwhat'));

    await sleep(2600);
    ok('传完改说设备在写', /开始写入闪存/.test(txt(w, '#p1 .pwhat')),
       txt(w, '#p1 .pwhat'));
    ok('写入阶段给的是预计时间', /预计 /.test(txt(w, '#p1 .pct')),
       txt(w, '#p1 .pct'));
  }

  console.log('\n--- 每个文件框都能拖 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p2]').click();
    const i = $(w, '#p2 input[name=bl2]');
    const box = i.closest('.fr');
    ok('表格里的文件框也接了拖拽', !!box && typeof box.ondrop === 'function');

    const f = new w.File([new Uint8Array(4)], 'x-preloader.bin');
    Object.defineProperty(f, 'size', { value: 120832 });
    box.ondragover({ preventDefault() {} });
    ok('拖上去有反馈', box.classList.contains('over'));
    Object.defineProperty(i, 'files', { value: [f], configurable: true,
                                        writable: true });
    box.ondrop({ preventDefault() {}, dataTransfer: { files: [f] } });
    ok('松手就选上了', /x-preloader\.bin/.test(txt(w, '#p2')));
    ok('反馈也收了', !box.classList.contains('over'));
    ok('大框那条老路没断',
       typeof $(w, '#p1 .drop').ondrop === 'function');
  }

  console.log('\n--- 重建 UBI 要 BL2 和 U-Boot 一起传 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p2]').click();
    await sleep(300);
    const pick = (name, fn, n) => {
      const i = $(w, '#p2 input[name=' + name + ']');
      Object.defineProperty(i, 'files',
        { value: [new w.File([new Uint8Array(n)], fn)], configurable: true });
      i.onchange();
    };
    const drop = name => {
      const i = $(w, '#p2 input[name=' + name + ']');
      Object.defineProperty(i, 'files', { value: [], configurable: true });
    };
    const errs = () => [...w.document.querySelectorAll('#abody .e')]
      .map(e => e.textContent).join(' | ');

    ok('说明里就写着要一起传', /必须同时上传 BL2 与 U-Boot/.test(txt(w, '#p2')));

    /*
     * 重建从 0x20000 起擦，而原厂 bootloader 分区是 0x0-0x80000 —— 后半截连同
     * 原厂 BL2 要加载的下一级一起没了。只写 FIP 的话，重启是原厂 BL2 起来、找
     * 不到下一级，我们的 FIP 又躺在它不认识的 UBI 卷里，只能拆串口。
     */
    $(w, '#p2 [name=format]').checked = true;
    pick('fip', 'x-bl31-uboot.fip', 325632);
    w.ask();
    ok('只带 U-Boot 就拦下来', /没有选择 BL2/.test(errs()), errs());
    ok('说清后果是拆串口', /串口/.test(errs()));
    ok('拦下来就不给「仍要写入」', $(w, '#yes').hidden);
    w.hide();

    pick('bl2', 'x-preloader.bin', 120832);
    w.ask();
    ok('两个都带就放行', !/没有选择 BL2/.test(errs()) &&
       !/没有选择 U-Boot/.test(errs()), errs());
    ok('放行才有「仍要写入」', !$(w, '#yes').hidden);
    w.hide();

    /* 反过来也要拦：只带 BL2 不带 FIP，重建之后没有 U-Boot 可启动 */
    drop('fip');
    w.ask();
    ok('只带 BL2 也拦', /没有选择 U-Boot 文件/.test(errs()), errs());
    w.hide();

    /* 不重建就只是日常升级引导器，单独换 U-Boot 是正常用法 */
    $(w, '#p2 [name=format]').checked = false;
    pick('fip', 'x-bl31-uboot.fip', 325632);
    drop('bl2');
    w.ask();
    ok('不重建时单独换 U-Boot 照旧放行', !/没有选择 BL2/.test(errs()), errs());
    ok('并且给得出「仍要写入」', !$(w, '#yes').hidden);
  }

  console.log('\n--- BL2 与 U-Boot 的尺寸上限 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p2]').click();
    await sleep(300);
    const pick = (name, fn, n) => {
      const i = $(w, '#p2 input[name=' + name + ']');
      Object.defineProperty(i, 'files',
        { value: [new w.File([new Uint8Array(n)], fn)], configurable: true });
      i.onchange();
    };
    const errs = () => [...w.document.querySelectorAll('#abody .e')]
      .map(e => e.textContent).join(' | ');

    /*
     * 两条写入配方都是先擦后写，装不下就是擦完才失败。出厂卷一直有精确尺寸
     * 门，这两个到 0.3.0 才有 —— 而它要的数（分区大小、卷预留）只有 /info 给
     * 得出，所以页面这一半和设备那一半必须用同一个判据。
     */
    pick('fip', 'x-bl31-uboot.fip', 325632);
    pick('bl2', 'x-preloader.bin', 200000);
    w.ask();
    ok('BL2 超过 bl2 分区就拦下来', /超过 bl2 分区/.test(errs()), errs());
    ok('拦下来就不给「仍要写入」', $(w, '#yes').hidden);
    w.hide();

    pick('bl2', 'x-preloader.bin', 120832);
    w.ask();
    ok('放得下的 BL2 照旧放行', !/超过 bl2 分区/.test(errs()), errs());
    w.hide();

    /* 现存 fip 卷预留 1.1 MiB，这个文件塞得进去 */
    pick('fip', 'x-bl31-uboot.fip', 1100000);
    w.ask();
    ok('现存 fip 卷装得下就不拦', !/超过 fip 卷/.test(errs()), errs());
    w.hide();

    /* 重建之后 fip 是 ubi_write_fip 按 0x100000 新建的，上限反而更紧 */
    $(w, '#p2 [name=format]').checked = true;
    w.ask();
    ok('重建后按 1 MiB 算，同一个文件就装不下了',
       /超过 fip 卷/.test(errs()), errs());
    w.hide();
  }

  console.log('\n--- 引导菜单预览 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p11]').click();
    await sleep(600);
    const rows = [...w.document.querySelectorAll('#bmenu tr')];
    ok('两条菜单都列出来了', rows.length === 2, rows.length);
    ok('序号是串口上的按键，从 1 起', rows[0].cells[0].textContent === '1.',
       rows[0].cells[0].textContent);
    ok('标题切在第一个等号', rows[0].cells[1].textContent === '启动 ImmortalWrt.',
       rows[0].cells[1].textContent);
    ok('命令也摆出来', rows[0].cells[2].textContent === 'run boot_ubi',
       rows[0].cells[2].textContent);
    ok('说清不按键会怎样', /秒内无按键/.test(txt(w, '#bmh')), txt(w, '#bmh'));

    /* 串口上红的那几条是会写闪存的，这里也标红；颜色码不能漏进标题 */
    w.ENV = { env: [
      { k: 'bootmenu_1', v: '\u001b[31mWrite BL2\u001b[0m=run x' },
      { k: 'bootmenu_delay', v: '3' }], cut: 0 };
    w.bmfill();
    const r = $(w, '#bmenu tr');
    ok('颜色码没漏进标题', r.cells[1].textContent === 'Write BL2',
       r.cells[1].textContent);
    ok('危险条目标红', r.cells[1].className === 'hot', r.cells[1].className);

    /* U-Boot 的快捷键只有一位：1~9 之后接 a~z，0 留给 Exit */
    w.ENV = { env: [
      { k: 'bootmenu_0', v: 'A=run a' },
      { k: 'bootmenu_8', v: 'I=run i' },
      { k: 'bootmenu_9', v: 'J=run j' },
      { k: 'bootmenu_10', v: 'K=run k' }], cut: 0 };
    w.bmfill();
    const keys = [...w.document.querySelectorAll('#bmenu tr')]
      .map((x) => x.cells[0].textContent);
    ok('第九项还是数字 9', keys[1] === '9.', keys[1]);
    ok('第十项跟串口一样是 a', keys[2] === 'a.', keys[2]);
    ok('第十一项接着是 b', keys[3] === 'b.', keys[3]);

    w.ENV = { env: [{ k: 'bootcmd', v: 'x' }], cut: 0 };
    w.bmfill();
    ok('没有菜单也说清楚', /直接执行 bootcmd/.test(txt(w, '#bmh')),
       txt(w, '#bmh'));
  }

  console.log('\n--- 诊断包下载 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p8]').click();
    await sleep(2200);
    let got = null;
    w.save = (name, text) => { got = { name, text } };
    const b = [...w.document.querySelectorAll('#p8 button')]
      .find(x => /下载诊断包/.test(x.textContent));
    ok('体检页上有这个按钮', !!b);
    b.click();
    await sleep(1500);
    ok('存了一个文件', !!got);
    ok('文件名带机型', got && got.name === 'nokia-xg-040g-md-diag.txt',
       got && got.name);
    ok('带设备详情', /Nokia XG-040G-MD/.test(got.text));
    ok('带体检结果', /== 快速检查 ==/.test(got.text) && /BL2/.test(got.text));
    ok('带环境变量', /== 环境变量 ==/.test(got.text) &&
       /bootcmd=/.test(got.text));
    ok('带串口日志', /== 串口日志 ==/.test(got.text) &&
       /probing by address aliasing/.test(got.text));
    ok('按钮恢复原样', /下载诊断包/.test(b.textContent) && !b.disabled,
       b.textContent);
    ok('顺手把环境变量也读回来了', !!w.ENV);
  }

  console.log('\n--- 试跑固件，不写闪存 ---');
  {
    const w = await boot();
    ok('侧栏有试跑固件入口', !!$(w, '.nav[data-p=p14]'));
    $(w, '.nav[data-p=p14]').click();
    ok('它自己就是一页', on(w, '#p14'));
    /* 开关没了，这一页天生就是试跑 —— tryboot 由隐藏字段带上去 */
    ok('tryboot 默认就带着', $(w, '#p14 input[name=tryboot]').checked);
    const i = $(w, '#p14 input[name=firmware]');
    const f = new w.File([new Uint8Array(1024)], 'x-initramfs-recovery.itb');
    Object.defineProperty(i, 'files', { value: [f], configurable: true });

    w.ask();
    ok('确认框的主按钮改口', txt(w, '#yes') === '启动它', txt(w, '#yes'));
    ok('说清闪存不写', /不写入闪存/.test(txt(w, '#abody')), txt(w, '#abody'));
    ok('没把它说成写入', !/仍要写入/.test(txt(w, '#yes')));
    ok('名字对得上就不啰嗦', !/不像 initramfs/.test(txt(w, '#abody')),
       txt(w, '#abody'));
    w.hide();

    /* 传错文件是最可能犯的错：名字不像恢复固件就说一句 */
    const bad = new w.File([new Uint8Array(1024)], 'x-squashfs-sysupgrade.itb');
    Object.defineProperty(i, 'files', { value: [bad], configurable: true });
    w.ask();
    ok('传成 sysupgrade 会被点破', /不像 initramfs/.test(txt(w, '#abody')),
       txt(w, '#abody'));
    ok('但拦不住，只是提醒', !$(w, '#yes').hidden);
    w.hide();
    Object.defineProperty(i, 'files', { value: [f], configurable: true });

    /* 日常刷机那一页没有 tryboot，走的还是写入 */
    $(w, '.nav[data-p=p1]').click();
    ok('日常刷机没有试跑开关', !$(w, '#p1 input[name=tryboot]'));
    const i1 = $(w, '#p1 input[name=firmware]');
    Object.defineProperty(i1, 'files', { value: [f], configurable: true });
    w.ask();
    ok('那边还是写入', txt(w, '#yes') === '仍要写入', txt(w, '#yes'));
    w.hide();

    $(w, '.nav[data-p=p14]').click();
    w.send();
    await sleep(3500);
    ok('走到完成页', on(w, '#p7'));
    ok('标题不说上传完成', txt(w, '#p7 h1') === '已交给设备启动',
       txt(w, '#p7 h1'));
    ok('说清闪存没动', /闪存未改动/.test(txt(w, '#p7 .sub')),
       txt(w, '#p7 .sub'));
    const steps = txt(w, '#steps');
    ok('步骤是启动不是写入', /直接引导/.test(steps) && !/写入固件/.test(steps),
       steps);
    ok('说清起不来怎么办', /断电/.test(steps), steps);
  }

  console.log('\n--- 直接启动系统 / 下次开机进恢复页 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p12]').click();
    ok('重启还在', /立即重启/.test(txt(w, '#p12')));
    ok('多了直接启动', /启动系统/.test(txt(w, '#p12')));
    ok('多了下次开机进恢复页', /下次开机进恢复页/.test(txt(w, '#p12')));

    w.askboot();
    ok('要确认', on(w, '#mask') && /run bootcmd/.test(txt(w, '#abody')));
    ok('说清闪存不受影响', /闪存内容不受影响/.test(txt(w, '#abody')));
    ok('主按钮是启动系统', txt(w, '#yes') === '启动系统');
    $(w, '#yes').click();
    await sleep(400);
    ok('立刻说在启动', on(w, '#off') && /设备正在启动系统/.test(txt(w, '#offt')),
       txt(w, '#offt'));
    ok('不给重连按钮', $(w, '#offr').hidden);
    ok('说清起不来会回来', /回到本页面/.test(txt(w, '#offb')),
       txt(w, '#offb'));
  }

  console.log('\n--- 下次开机进恢复页 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p12]').click();
    $(w, '#bob').click();
    await sleep(600);
    ok('按钮改口', txt(w, '#bob') === '已设置', txt(w, '#bob'));
    ok('说清只生效一次', /再下次开机恢复正常/.test(txt(w, '#boh')),
       txt(w, '#boh'));

    /* 闪存里有东西可启动时，重启就真的只是重启 */
    w.askreboot();
    ok('正常设备重启只说闪存不受影响',
       /闪存内容不受影响/.test(txt(w, '#abody')) &&
       !/仅存于内存/.test(txt(w, '#abody')), txt(w, '#abody'));

    /* 存不进闪存是要说的：断电就白设了 */
    const w2 = await boot();
    setsel(w2, 'dev', 'noubi');
    await sleep(600);
    $(w2, '.nav[data-p=p12]').click();
    $(w2, '#bob').click();
    await sleep(600);
    ok('保存失败要说明', /断电后失效/.test(txt(w2, '#boh')), txt(w2, '#boh'));
    ok('没保存成功就不说已设置', txt(w2, '#bob') === '未保存', txt(w2, '#bob'));

    /*
     * 没有 UBI 的机器上，当前 U-Boot 只在内存里：重启把它丢掉，回到原有
     * 系统，得再走一轮串口。确认框不能只说「闪存内容不受影响」。
     */
    w2.askreboot();
    ok('没有 UBI 时重启要警告', /仅存于内存/.test(txt(w2, '#abody')),
       txt(w2, '#abody'));
    ok('说清后果是回到原有系统', /回到原有系统/.test(txt(w2, '#abody')),
       txt(w2, '#abody'));

    const w3 = await boot();
    setsel(w3, 'dev', 'nofip');
    await sleep(600);
    w3.askreboot();
    ok('没有 fip 卷时重启也要警告',
       /本页面将无法再打开/.test(txt(w3, '#abody')), txt(w3, '#abody'));
  }

  console.log('\n--- 网络状态 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    const t = txt(w, '#net');
    ok('报了模式', /DHCP 服务器/.test(t), t);
    ok('存过的就不挂「未保存」', !/未保存/.test(t), t);
    ok('报了地址', /192\.168\.1\.1/.test(t), t);
    ok('0.0.0.0 的掩码不往外摆', !/0\.0\.0\.0/.test(t), t);
    ok('报了网卡', /airoha-gdm1/.test(t), t);
    /* 这几句是 DHCP 服务自己的账，只有在真的在发地址时才有意义 */
    ok('说清地址是设备发的',
       /用的就是设备发的地址/.test(txt(w, '#dhsum')), txt(w, '#dhsum'));
    ok('带上了客户端 MAC',
       /a4:5e:60:11:22:33/.test(txt(w, '#dhsum')), txt(w, '#dhsum'));

    const rows = [...w.document.querySelectorAll('#net tr')]
      .filter(r => /端口/.test(r.cells[0].textContent));
    ok('四个口都列出来', rows.length === 4, rows.length);
    ok('亮着的口报速率', /1 Gb\/s 全双工/.test(rows[1].cells[1].textContent),
       rows[1].cells[1].textContent);
    ok('百兆口也对', /100 Mb\/s 全双工/.test(rows[3].cells[1].textContent),
       rows[3].cells[1].textContent);
    ok('没插线的说未连接', rows[0].cells[1].textContent === '未连接',
       rows[0].cells[1].textContent);
    ok('亮的点是绿的', rows[1].cells[0].querySelector('.dot').className
       === 'dot s0');
    ok('没插的点是黄的', rows[0].cells[0].querySelector('.dot').className
       === 'dot s1');
    ok('说清端口号的口径', !$(w, '#portn').hidden &&
       /与外壳丝印不一定对应/.test(txt(w, '#portn')));

    /* 没发过地址 = 用户自己配的 IP，后续建议不一样 */
    w.INFO.net.ack = 0; w.INFO.net.offer = 0;
    w.netfill();
    ok('没发过地址就直说', /手动配置的 IP/.test(txt(w, '#dhsum')),
       txt(w, '#dhsum'));
    w.INFO.net.offer = 3;
    w.netfill();
    ok('发了没被接受也分得清',
       /已发出 3 次地址，均未被接受/.test(txt(w, '#dhsum')),
       txt(w, '#dhsum'));

    /* 读不到端口的板子不该留一张空表 */
    w.INFO.ports = [];
    w.netfill();
    ok('没有端口就不摆那条说明', $(w, '#portn').hidden);

    /* 不在发地址的时候这本账是噪音 */
    w.INFO.net.mode = 'client';
    w.netfill();
    ok('客户端档就把发地址那本账收起来', $(w, '#dhsum').hidden);
    ok('模式那行跟着变', /DHCP 客户端/.test(txt(w, '#net')), txt(w, '#net'));
    w.INFO.net.ram = 1;
    w.netfill();
    ok('没保存的挂个标记', /未保存/.test(txt(w, '#net')), txt(w, '#net'));
  }

  console.log('\n--- 端口链路自己会刷新 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    ok('硬件那一段在前台时不轮询', !w.NETT);

    $(w, '#p5 button[data-s=s52]').click();
    await sleep(600);
    ok('切到网络就开始轮询', !!w.NETT);
    /* /info 会重新挂载 UBI，为了看一眼哪个口亮着不该付那个代价 */
    ok('问的是 /net 那一半，不是整份 /info',
       !!(w.NET && w.NET.net && w.NET.ports) && w.NET.ubi === undefined);

    const row = () => [...w.document.querySelectorAll('#net tr')]
      .filter(r => /端口 1$/.test(r.cells[0].textContent))[0];
    ok('一开始 1 口是空的', row().cells[1].textContent === '未连接',
       row().cells[1].textContent);

    /* 把网线插到 1 口上 */
    w.PV.info.ports[0] = { p: 1, link: 1, speed: 1000, fd: 1 };
    w.netget();
    await sleep(600);
    ok('换个口之后这张表跟着变', /1 Gb\/s/.test(row().cells[1].textContent),
       row().cells[1].textContent);
    ok('点也跟着变绿', row().cells[0].querySelector('.dot').className
       === 'dot s0');

    $(w, '.nav[data-p=p8]').click();
    ok('看不见这一页了就停下来', !w.NETT);
  }

  console.log('\n--- 三种模式互斥 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    ok('默认是 DHCP 服务器', $(w, '#amode').value === 'server');
    ok('只有三个选项',
       [...w.document.querySelectorAll('#amode option')].map(o => o.value)
         .join(',') === 'server,static,client');
    /* 原来是「静态 or 自动获取」再叠一个独立开关，四种组合三种含义 */
    ok('独立的 DHCP 服务开关没有了', !$(w, '#dhcpd'));

    ok('服务器档要填地址', !$(w, '#arow1').hidden);
    ok('服务器档不给改掩码', $(w, '#arow2').hidden);
    ok('说清掩码固定 /24', /255\.255\.255\.0/.test(txt(w, '#nh')), txt(w, '#nh'));
    ok('说清电脑拿到的是 .100', /\.100/.test(txt(w, '#nh')));
    ok('警告别拿它接已有网络', /接入已有网络前不要用这一档/.test(txt(w, '#nh')));

    $(w, '#amode').value = 'static'; w.amodesw();
    ok('静态档露出掩码', !$(w, '#arow2').hidden && !$(w, '#arow1').hidden);
    ok('静态档说明本机不再发地址', /本机不再发地址/.test(txt(w, '#nh')),
       txt(w, '#nh'));

    $(w, '#amode').value = 'client'; w.amodesw();
    ok('客户端档两行都收起来', $(w, '#arow1').hidden && $(w, '#arow2').hidden);
    ok('客户端档仍可选保存', !$(w, '#arow3').hidden);
    ok('说清地址预知不了', /本页面事先不知道/.test(txt(w, '#nh')), txt(w, '#nh'));
    ok('客户端档也不再发地址', /本机不再发地址/.test(txt(w, '#nh')));
  }

  console.log('\n--- 服务器档的末位与掩码不归用户挑 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#nip').value = '192.168.5.77';
    w.ippv();
    /* 设备发的地址一直是 (net_ip & 0xffffff00) | 100，所以这两个数是绑死的；
       与其等按下「应用」再纠正，不如打字的时候就把结果摆出来 */
    ok('打字时就把 .1 摆出来', /192\.168\.5\.1</.test($(w, '#ipfn').innerHTML),
       $(w, '#ipfn').innerHTML);
    ok('顺带说清电脑会拿到什么',
       /192\.168\.5\.100/.test($(w, '#ipfn').innerHTML));

    w.applyaddr();
    ok('确认框里也是改正过的地址',
       /192\.168\.5\.1 \/ 255\.255\.255\.0/.test(txt(w, '#abody')),
       txt(w, '#abody'));
    ok('确认框说清电脑会拿到 .100',
       /192\.168\.5\.100/.test(txt(w, '#abody')));

    let url = null;
    const real = w.get;
    w.get = (u, cb) => { url = u; return real(u, cb) };
    w.YES();
    await sleep(600);
    ok('发出去的也是 .1', /ip=192\.168\.5\.1&/.test(url), url);
    ok('掩码是设备档位定的 /24', /mask=255\.255\.255\.0/.test(url), url);
    w.get = real;
  }

  console.log('\n--- 不保存就说清下次开机回哪去 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    /* 从没存过：闪存里没有 web_uboot_netmode，回的是出厂默认 */
    ok('先摆出下次开机是什么', /下次开机/.test(txt(w, '#nboot')), txt(w, '#nboot'));
    ok('没存过就说是出厂默认', /出厂默认/.test(txt(w, '#nboot')));
    ok('并且把默认那一套写出来',
       /DHCP 服务器 192\.168\.1\.1/.test(txt(w, '#nboot')), txt(w, '#nboot'));

    $(w, '#amode').value = 'static'; w.amodesw();
    $(w, '#nip').value = '192.168.9.1';
    $(w, '#nsave').checked = false;
    w.applyaddr();
    ok('不保存时确认框点名会回到哪',
       /下次开机回到/.test(txt(w, '#abody')) && /出厂默认/.test(txt(w, '#abody')),
       txt(w, '#abody'));
    w.hide();

    $(w, '#nsave').checked = true;
    w.applyaddr();
    ok('勾了保存就换一句话', /下次开机就用这一套/.test(txt(w, '#abody')),
       txt(w, '#abody'));
    w.YES();
    await sleep(700);

    /* 存过之后，「下次开机」那行说的就是刚存的那一套 */
    w.GONE = 0; w.netget();
    await sleep(600);
    ok('存过之后下次开机跟着变',
       /静态地址 192\.168\.9\.1/.test(txt(w, '#nboot')), txt(w, '#nboot'));
    ok('不再说出厂默认', !/出厂默认/.test(txt(w, '#nboot')));
  }

  console.log('\n--- 靠设备发的地址连上来的机器 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#amode').value = 'static'; w.amodesw();
    $(w, '#nip').value = '192.168.9.1';
    w.applyaddr();
    ok('点名本机用的是设备发的地址',
       /本机用的是设备发的地址/.test(txt(w, '#abody')), txt(w, '#abody'));
    ok('给出该配成哪个网段', /192\.168\.9\.x/.test(txt(w, '#abody')));
    w.hide();

    /* 自己配的静态 IP 上来的机器不受影响，别吓唬人 */
    w.INFO.net.ack = 0;
    w.applyaddr();
    ok('自己配 IP 的就不提这茬', !/本机用的是设备发的地址/.test(txt(w, '#abody')));
    w.hide();

    /* 还是服务器档的话，本机继续能续到租约，这条提醒就是噪音 */
    w.INFO.net.ack = 1;
    $(w, '#amode').value = 'server'; w.amodesw();
    w.applyaddr();
    ok('仍然发地址的话不提这茬',
       !/本机用的是设备发的地址/.test(txt(w, '#abody')), txt(w, '#abody'));
    w.hide();

    $(w, '#amode').value = 'client'; w.amodesw();
    w.applyaddr();
    ok('客户端档也点名',
       /本机用的是设备发的地址/.test(txt(w, '#abody')), txt(w, '#abody'));
    ok('说清该换台机器访问', /改用上级路由那个网络里的机器/.test(txt(w, '#abody')));
  }

  console.log('\n--- 改地址 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#amode').value = 'static'; w.amodesw();
    $(w, '#nip').value = '1.2.3';
    w.applyaddr();
    ok('地址不合法就当场说', /不是一个合法的地址/.test(txt(w, '#nh')), txt(w, '#nh'));
    ok('并且不弹确认框', !on(w, '#mask'));

    $(w, '#nip').value = '192.168.9.1';
    $(w, '#nmask').value = '255.255.0';
    w.applyaddr();
    ok('掩码不合法也当场说', /子网掩码/.test(txt(w, '#nh')), txt(w, '#nh'));

    $(w, '#nmask').value = '255.255.255.0';
    $(w, '#nsave').checked = false;
    w.applyaddr();
    ok('说清页面会断', /本页面将断开/.test(txt(w, '#abody')));
    ok('给出新地址', /192\.168\.9\.1/.test(txt(w, '#abody')));
    w.hide();

    $(w, '#nsave').checked = true;
    w.applyaddr();
    ok('保存到闪存要单说', /保存到闪存/.test(txt(w, '#abody')));
    ok('说清填错了断电也回不去', /断电也无法恢复/.test(txt(w, '#abody')));
    w.YES();
    await sleep(600);
    ok('之后是「设备已移至」而不是断开框',
       /设备已移至 192\.168\.9\.1/.test(txt(w, '#offt')), txt(w, '#offt'));
    ok('给出新的打开地址', /http:\/\/192\.168\.9\.1\//.test(txt(w, '#offb')));
    ok('重连按钮收起来了', $(w, '#offr').hidden);
  }

  console.log('\n--- DHCP 客户端 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#amode').value = 'client'; w.amodesw();
    w.applyaddr();
    ok('说清地址无法预知', /本页面无法预知/.test(txt(w, '#abody')), txt(w, '#abody'));
    ok('给出要按什么找', /90:03:2e:12:34:56/.test(txt(w, '#abody')));
    ok('说清拿不到就退回来', /退回当前地址/.test(txt(w, '#abody')));

    let url = null;
    const real = w.get;
    w.get = (u, cb) => { url = u; return real(u, cb) };
    w.YES();
    await sleep(600);
    w.get = real;
    ok('客户端档不往设备发地址', /mode=client/.test(url) && !/[?&]ip=/.test(url),
       url);
    ok('之后停在「正在获取地址」', /正在获取地址/.test(txt(w, '#offt')),
       txt(w, '#offt'));
    ok('说清去上级路由按 MAC 找', /按 <b>90:03:2e/.test($(w, '#offb').innerHTML));
  }

  console.log('\n--- 侧栏合并：诊断 ---');
  {
    const w = await boot();
    ok('串口日志不再单独占一格', !$(w, '.nav[data-p=p9]'));
    ok('侧栏十一项', w.document.querySelectorAll('.nav').length === 11,
       w.document.querySelectorAll('.nav').length);
    ok('诊断这一格在', /诊断/.test(txt(w, '.nav[data-p=p8]')),
       txt(w, '.nav[data-p=p8]'));
    ok('日志段在诊断屏里', $(w, '#p8').contains($(w, '#log')));

    /* 进段才读，别一进诊断就白读一遍日志 */
    $(w, '.nav[data-p=p8]').click();
    await sleep(700);
    ok('只开诊断不读日志', txt(w, '#log') === '未读取', txt(w, '#log'));
    $(w, '#logtab').click();
    await sleep(600);
    ok('切进日志段才读', /probing by address aliasing/.test(txt(w, '#log')));

    /* 跟随开着的时候切走：不能在背后一直敲设备 */
    $(w, '#logf').checked = true;
    w.logfollow();
    await sleep(600);
    const n1 = w.LOGN;
    $(w, '.seg[data-seg=g8] button').click();
    ok('切到别的段就把跟随关了', !$(w, '#logf').checked);
    await sleep(4200);
    ok('关了就真的不再取', w.LOGN === n1, w.LOGN + ' vs ' + n1);

    /* 离开诊断屏同样要停 */
    $(w, '#logtab').click();
    await sleep(600);
    $(w, '#logf').checked = true;
    w.logfollow();
    $(w, '.nav[data-p=p5]').click();
    ok('切走别的屏也把跟随关了', !$(w, '#logf').checked);
  }

  console.log('\n--- 改名 ---');
  {
    const w = await boot();
    /* 侧栏求字宽齐整，屏内标题求说全 —— 环境变量那格早就是这么分的 */
    ok('侧栏那格求短', txt(w, '.nav[data-p=p3]') === '按卷写入',
       txt(w, '.nav[data-p=p3]'));
    ok('屏内标题写全', txt(w, '#p3 h1') === '写入 UBI 卷', txt(w, '#p3 h1'));
    ok('诊断那格补齐四字', txt(w, '.nav[data-p=p8]') === '系统诊断',
       txt(w, '.nav[data-p=p8]'));
    ok('试跑固件那格也是四字', txt(w, '.nav[data-p=p14]') === '试跑固件',
       txt(w, '.nav[data-p=p14]'));
    ok('重启改成启动与重启', txt(w, '.nav[data-p=p12]') === '启动与重启',
       txt(w, '.nav[data-p=p12]'));
    ok('环境变量屏的标题写全', txt(w, '#p11 h1') === 'U-Boot 环境变量',
       txt(w, '#p11 h1'));
    ok('侧栏那格还是短的', txt(w, '.nav[data-p=p11]') === '环境变量',
       txt(w, '.nav[data-p=p11]'));
    ok('引导菜单那段叫预览',
       /引导菜单预览/.test(txt(w, '.seg[data-seg=g11]')),
       txt(w, '.seg[data-seg=g11]'));
  }

  console.log('\n--- 空状态 ---');
  {
    const w = await boot();
    /* 进「诊断」就自己跑体检，所以初始空态要在进去之前看 */
    ok('体检没跑时是空态', !!$(w, '#chk .empty'), txt(w, '#chk'));
    ok('空态说清该点哪个按钮', /开始检查/.test(txt(w, '#chk .empty')));
    $(w, '.nav[data-p=p8]').click();
    await sleep(1800);
    ok('跑完就不是空态了', !$(w, '#chk .empty'), txt(w, '#chk').slice(0, 40));
    ok('扫描那段仍是空态', !!$(w, '#scan .empty') &&
       /开始扫描/.test(txt(w, '#scan .empty')), txt(w, '#scan'));

    /* 空态那句是给人看的，不该混进诊断包 */
    let got = null;
    w.save = (name, text) => { got = { name, text } };
    w.diagfile($(w, '#chkb'));
    await sleep(1500);
    ok('诊断包里未扫描就写未扫描',
       got && /== 全片扫描 ==\s*\(未扫描\)/.test(got.text),
       got && got.text.split('== 全片扫描 ==')[1].slice(0, 40));

    ok('主题按钮换成图标了',
       !!$(w, '.tb svg') && txt(w, '.tb').trim() === '', txt(w, '.tb'));
  }

  console.log('\n--- UBI 卷占用条 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    const segs = [...w.document.querySelectorAll('#vbar i')];
    ok('七个卷加空闲加预留，九段', segs.length === 9, segs.length);
    /* UBI 按 LEB 取整，`ubi create fip 0x100000` 落到 9 个 LEB */
    ok('fip 报的是取整后的 1.1 MiB', segs[0].title === 'fip 1.1 MiB',
       segs[0].title);
    ok('会被腾出的两个卷打了斜纹',
       w.document.querySelectorAll('#vbar i.re').length === 2);
    ok('斜纹的正是 fit 与 rootfs_data',
       [...w.document.querySelectorAll('#vbar i.re')]
         .map(i => i.title.split(' ')[0]).sort().join(',') === 'fit,rootfs_data',
       [...w.document.querySelectorAll('#vbar i.re')].map(i => i.title).join('|'));
    ok('图例每段都有', w.document.querySelectorAll('#vleg span').length === 9,
       w.document.querySelectorAll('#vleg span').length);
    ok('点破了这不是物理布局', /不表示物理位置/.test(txt(w, '#ubih')));
    ok('刷机可用与体检那行对得上', /刷机可用 240 MiB/.test(txt(w, '#ubih')),
       txt(w, '#ubih'));

    /* 老设备的 /info 没有 avail：并成一段，不假装分得清 */
    const ubi = JSON.parse(JSON.stringify(w.INFO.ubi));
    delete ubi.avail;
    w.INFO.ubi = ubi;
    w.ubibar();
    ok('没有 avail 时并成一段',
       w.document.querySelectorAll('#vbar i').length === 8 &&
       /空闲与 UBI 预留/.test(txt(w, '#vleg')), txt(w, '#vleg'));
    ok('那时不报刷机可用', !/刷机可用/.test(txt(w, '#ubih')), txt(w, '#ubih'));

    w.INFO.ubi = null;
    w.ubibar();
    ok('没有 UBI 就整条收起来',
       $(w, '#vbar').hidden && $(w, '#vleg').hidden && !txt(w, '#ubih'));
  }

  console.log('\n--- 胶囊分段 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    ok('默认落在第一段', on(w, '#s51') && !on(w, '#s52') && !on(w, '#s53'));
    ok('第一段是选中态',
       $(w, '.seg[data-seg=g5] button').getAttribute('aria-selected') === 'true');

    const segb = g => Array.from(
      w.document.querySelectorAll('.seg[data-seg=' + g + '] button'));
    const b = segb('g5')[1];
    b.click();
    ok('切过去了', on(w, '#s52') && !on(w, '#s51') && !on(w, '#s53'));
    ok('选中态跟着走', b.getAttribute('aria-selected') === 'true' &&
       $(w, '.seg[data-seg=g5] button').getAttribute('aria-selected') === 'false');

    /* 藏起来的那段还在 DOM 里 —— 读到的数据不该因为切段就丢 */
    ok('没被切走的段仍有内容', /机型/.test(txt(w, '#s51')), txt(w, '#s51'));

    /* 每屏一组，互不牵连 */
    $(w, '.nav[data-p=p11]').click();
    await sleep(400);
    ok('另一屏不受影响', on(w, '#s111') && on(w, '#s52'));
    segb('g11')[2].click();
    ok('三段的也切得动', on(w, '#s113') && !on(w, '#s111'));
    ok('恢复默认的按钮在第三段里',
       $(w, '#s113').contains($(w, 'button[onclick="askenvdef()"]')));

    /* 备份下载：两段共用一条状态行，它不能待在任何一段里 */
    $(w, '.nav[data-p=p10]').click();
    await sleep(400);
    ok('状态行在分段外', !$(w, '#s101').contains($(w, '#dlh')) &&
       !$(w, '#s102').contains($(w, '#dlh')));
    ok('进度条也在分段外', !$(w, '#s102').contains($(w, '#dlprog')));
    segb('g10')[1].click();
    ok('区段那两个按钮跟着区段走',
       $(w, '#s102').contains($(w, 'button[onclick="dumpraw()"]')) &&
       $(w, '#s102').contains($(w, 'button[onclick="dumpall()"]')));
  }

  console.log('\n--- 全片扫描 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p8]').click();
    await sleep(2000);
    ok('还没扫时进度条不占地方', $(w, '#scanprog').hidden);
    ok('表里说未扫描', /未扫描/.test(txt(w, '#scan')));

    $(w, '#scanb').click();
    await sleep(1200);
    ok('按钮变成停止', txt(w, '#scanb') === '停止', txt(w, '#scanb'));
    ok('进度条露出来', !$(w, '#scanprog').hidden);
    ok('一段一段来，不是一口气', w.SCAN && w.SCAN.off > 0 &&
       w.SCAN.off < w.SCAN.size, w.SCAN && w.SCAN.off);

    /* 停得下来 —— 整片要几分钟，停不下来就是耍赖 */
    $(w, '#scanb').click();
    ok('点停就停', w.SCAN === null);
    ok('说清结果只覆盖扫过的部分', /仅覆盖已扫描的部分/.test(txt(w, '#scanh')),
       txt(w, '#scanh'));
    const off = txt(w, '#scan');
    await sleep(2500);
    ok('停了就真的不动了', txt(w, '#scan') === off);

    $(w, '#scanb').click();
    ok('能重新开始', w.SCAN !== null && w.SCAN.off === 0);
    await sleep(40000);
    ok('扫完了', w.SCAN === null, w.SCAN && w.SCAN.off);
    ok('按钮回到重新扫描', txt(w, '#scanb') === '重新扫描', txt(w, '#scanb'));
    ok('进度条转绿', $(w, '#scanprog').className === 'prog ok',
       $(w, '#scanprog').className);

    const t = txt(w, '#scan');
    ok('报了扫过多少', /256\.0 MiB \/ 256\.0 MiB/.test(t), t.slice(0, 60));
    ok('两个坏块都列出来了', /0x2a00000/.test(t) && /0x9c00000/.test(t), t);
    ok('ECC 纠错报了页数', /页在读取时被纠正/.test(t), t);
    ok('说清 ECC 意味着什么', /颗粒退化/.test(t));
    ok('没有读失败就写无', /读失败/.test(t) && !/数据已丢失/.test(t));
    ok('汇总说整片读得回来或见上表',
       /扫描完成/.test(txt(w, '#scanh')), txt(w, '#scanh'));

    /* 扫描期间不该弹断开框 —— 那是自己发起的读取 */
    ok('全程没弹断开框', !on(w, '#off'));
  }

  console.log('\n--- 快速检查分组 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p8]').click();
    await sleep(2200);
    const heads = [...w.document.querySelectorAll('#chk th.g')].map(t => t.textContent);
    ok('五组标题都在', heads.join(',') === '闪存,引导,UBI,环境,出厂数据', heads.join(','));
    ok('十七项都在',
       w.document.querySelectorAll('#chk td.s0,#chk td.s1,#chk td.s2').length === 17);
    ok('envver 报出来了', /envver/.test(txt(w, '#chk')));
    ok('固件版本报出来了', /2026-09-05 17:01/.test(txt(w, '#chk')));
    ok('两份环境对比过', /与 ubootenv 一致/.test(txt(w, '#chk')));
    ok('汇总仍然正确', /1 项注意 · 16 项正常/.test(txt(w, '#chkh')), txt(w, '#chkh'));
  }

  console.log('\n--- 卷名当数据看，不当代码看 ---');
  {
    const w = await boot();
    const evil = 'a\'b"c<img src=x onerror="window.__X=1">';
    const kind = 'dy\'na<b>mic</b>';
    w.INFO.ubi.vols = w.INFO.ubi.vols.concat(
      [{ i: 9, n: evil, t: kind, s: 4096, u: 4096 }]);
    w.fill();
    $(w, '.nav[data-p=p10]').click();
    await sleep(300);
    const rows = [...w.document.querySelectorAll('#dl tr')];
    const row = rows.find(r => r.cells[0].textContent.indexOf('<img') >= 0);
    ok('带引号带标签的卷名照样列出来', !!row,
       rows.map(r => r.cells[0].textContent).join('|'));
    ok('卷名一个字符都没走样', row.cells[0].textContent === evil,
       row.cells[0].textContent);
    ok('标签没被当成标签', !$(w, '#dl img') && !$(w, '#dl b'));
    ok('卷类型也过了转义', row.cells[1].textContent === kind,
       row.cells[1].textContent);

    const b = row.querySelector('button');
    ok('按钮不再往内联 onclick 里塞卷名', !b.hasAttribute('onclick'),
       b.outerHTML.slice(0, 80));
    ok('卷名挂在 data 属性上', b.getAttribute('data-v') === evil,
       b.getAttribute('data-v'));
    let url = null;
    w.sink = u => { url = u };
    b.click();
    ok('点下去拿到的还是那个卷名',
       url === '/dump?vol=' + encodeURIComponent(evil), url);
    ok('没有脚本被执行', w.__X === undefined);

    /* 设备详情那张卷表是同一件事 */
    const urow = [...w.document.querySelectorAll('#ubi tr')]
      .find(r => r.cells[1] && r.cells[1].textContent === evil);
    ok('UBI 卷表里也是纯文本', !!urow && !$(w, '#ubi img') && !$(w, '#ubi b'));
    ok('UBI 卷表的类型也转义了', urow && urow.cells[2].textContent === kind,
       urow && urow.cells[2].textContent);
    ok('esc 把单引号也一起转掉', w.esc("it's") === 'it&#39;s', w.esc("it's"));
  }

  console.log('\n--- 跟随关了又开，不会跑成两条链 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p8]').click();
    $(w, '#logtab').click();
    await sleep(600);

    const hits = [];
    const Real = w.XMLHttpRequest;
    w.XMLHttpRequest = function () {
      const x = new Real(), open = x.open;
      x.open = function (m, u) {
        if (String(u).indexOf('/log?from=') === 0) hits.push(u);
        return open.call(x, m, u);
      };
      return x;
    };

    $(w, '#logf').checked = true; w.logfollow();
    await sleep(500);
    ok('跟随跑起来了', w.LOGN > 0, w.LOGN);
    /* 每 150 毫秒关一次再开一次，每一次都落在上一条请求还没回来的窗口里 */
    for (let i = 0; i < 10; i++) {
      await sleep(150);
      $(w, '#logf').checked = false; w.logfollow();
      $(w, '#logf').checked = true; w.logfollow();
    }
    hits.length = 0;
    await sleep(600);
    const n = w.LOGN;
    ok('重新开的那条自己在跑', n > 0, n);
    await sleep(6500);
    ok('只剩一条链在取', hits.length <= 5, hits.length);
    ok('偏移只增不减', w.LOGN >= n, w.LOGN + ' vs ' + n);
    ok('日志没有被贴两遍',
       txt(w, '#log').split('probing by address aliasing').length === 2,
       txt(w, '#log').split('probing by address aliasing').length);
    $(w, '#logf').checked = false; w.logfollow();
  }

  console.log('\n--- 跟随开着时再点日志段 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p8]').click();
    $(w, '#logtab').click();
    await sleep(600);
    $(w, '#logf').checked = true; w.logfollow();
    await sleep(800);
    ok('跟随时按钮是禁着的', $(w, '#logb').disabled);

    const before = txt(w, '#log');
    $(w, '#logtab').click();               // 再点一次已经选中的那一段
    await sleep(800);
    ok('跟随开着就不整篇重读', txt(w, '#log').indexOf(before) === 0 &&
       txt(w, '#log').split('probing by address aliasing').length === 2,
       txt(w, '#log').split('probing by address aliasing').length);
    ok('按钮没被解禁', $(w, '#logb').disabled);

    w.getlog();
    await sleep(700);
    ok('手点读取读完也按跟随的状态来', $(w, '#logb').disabled);
    $(w, '#logf').checked = false; w.logfollow();
    w.getlog();
    await sleep(700);
    ok('不跟随时读完就放开', !$(w, '#logb').disabled);
  }

  console.log('\n--- 停了立刻重扫，坏块不翻倍 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p8]').click();
    await sleep(2000);
    $(w, '#scanb').click();
    await sleep(1200);
    ok('先扫了一段', w.SCAN && w.SCAN.off > 0, w.SCAN && w.SCAN.off);

    /* 上一段的响应还在路上就停掉，马上重来 */
    $(w, '#scanb').click();
    $(w, '#scanb').click();
    ok('重扫是从头开始的', w.SCAN && w.SCAN.off === 0, w.SCAN && w.SCAN.off);

    const s = w.SCAN;
    let i = 0;
    while (w.SCAN === s && s.off < 0x2c00000 && i++ < 300) await sleep(100);
    ok('扫过了第一个坏块所在的那一段', s.off >= 0x2c00000, s.off);
    ok('坏块只记了一次', s.bad === 1, s.bad);
    ok('坏块表里也只有一个', s.badl.length === 1 && s.badl[0] === 0x2a00000,
       s.badl.join(','));
    ok('这一段之前没有 ECC，也没被加两遍', s.ecc === 0, s.ecc);
    $(w, '#scanb').click();
  }

  console.log('\n--- 改完地址，残留的心跳盖不掉指引 ---');
  {
    const w = await boot();
    /* 让一次 ping 停在空中：hbstop 拦不住已经发出去的那一次 */
    let held = null;
    const Real = w.XMLHttpRequest;
    w.XMLHttpRequest = function () {
      const x = new Real(), open = x.open, send = x.send;
      x.open = function (m, u) { x.__u = u; return open.call(x, m, u) };
      x.send = function (d) {
        if (x.__u === '/ping' && !held) { held = x; return }
        return send.call(x, d);
      };
      return x;
    };
    for (let i = 0; i < 60 && !held; i++) await sleep(100);
    ok('抓到一次还在飞的心跳', !!held);

    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#amode').value = 'static'; w.amodesw();
    $(w, '#nip').value = '192.168.9.1';
    w.applyaddr();
    $(w, '#yes').click();
    await sleep(600);
    ok('先说清设备去哪了', /设备已移至 192\.168\.9\.1/.test(txt(w, '#offt')),
       txt(w, '#offt'));
    ok('心跳停了', w.HB === 0);

    /* 那次 ping 现在才失败：它是上一代的，早该丢掉 */
    w.MISS = 1;
    held.onerror();
    await sleep(300);
    ok('指引还在，没被通用断开框盖掉',
       /设备已移至 192\.168\.9\.1/.test(txt(w, '#offt')), txt(w, '#offt'));
    ok('也没冒出重新连接按钮', $(w, '#offr').hidden);
    ok('心跳没被这一下续上', w.HB === 0);

    w.offline('');
    ok('设备已搬走时 offline 直接让路',
       /设备已移至 192\.168\.9\.1/.test(txt(w, '#offt')), txt(w, '#offt'));
  }

  console.log('\n--- 要到 DHCP 客户端之后同样盖不掉 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#amode').value = 'client'; w.amodesw();
    w.applyaddr();
    $(w, '#yes').click();
    await sleep(300);
    ok('先说在要地址', /正在获取地址/.test(txt(w, '#offt')), txt(w, '#offt'));
    w.MISS = 1; w.seen(0, -1);
    ok('心跳失败也盖不掉这条', /正在获取地址/.test(txt(w, '#offt')),
       txt(w, '#offt'));
  }

  console.log('\n--- 心跳停过之后「重新连接」还管用 ---');
  {
    const w = await boot();
    setsel(w, 'conn', 'down');
    await sleep(9000);
    ok('先弹出断开框', on(w, '#off') && !$(w, '#offr').hidden);
    w.hbstop();                          // 写入、改地址都会把心跳停掉
    $(w, '#offr').click();
    ok('按钮进了重试态', $(w, '#offr').disabled);
    setsel(w, 'conn', 'up');
    await sleep(5000);
    ok('心跳自己接了回去', w.HB === 1, w.HB);
    ok('设备回来框就散了', !on(w, '#off'));
  }

  console.log('\n--- 轮询回来不许覆盖正在编辑的表单 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    ok('第一次照着设备填', $(w, '#amode').value === 'server' &&
       $(w, '#nip').value === '192.168.1.1', $(w, '#nip').value);

    /* 三秒一次的 /net 轮询回来时，用户可能正在改这几个框 */
    $(w, '#amode').value = 'client'; w.amodesw();
    $(w, '#nip').value = '10.0.0.1';
    w.netget();
    await sleep(600);
    ok('模式没被拨回去', $(w, '#amode').value === 'client');
    ok('地址没被写回去', $(w, '#nip').value === '10.0.0.1', $(w, '#nip').value);

    /* 但设备那边的实况该跟着变 */
    w.PV.info.net.mode = 'static';
    w.netget();
    await sleep(600);
    ok('信息表跟着设备走', /静态地址/.test(txt(w, '#net')), txt(w, '#net'));
    ok('下拉框仍归用户', $(w, '#amode').value === 'client');
  }

  console.log('\n--- 掩码交给设备判 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#amode').value = 'static'; w.amodesw();
    $(w, '#nip').value = '192.168.9.1';
    $(w, '#nmask').value = '255.255.0.0';
    w.applyaddr();
    ok('页面这关先过', on(w, '#mask') && /255\.255\.0\.0/.test(txt(w, '#abody')),
       txt(w, '#abody'));
    $(w, '#yes').click();
    await sleep(600);
    ok('设备收下了 255.255.0.0',
       /设备已移至 192\.168\.9\.1/.test(txt(w, '#offt')), txt(w, '#offt'));

    /* 回话形状：ok <模式> <地址> <掩码> <saved|ram>，客户端档地址位是 - */
    let r = null;
    const ask = async (u) => { r = null; w.get(u, (st, t) => { r = t });
                               await sleep(500); return r };
    ok('保存到闪存的回话不一样',
       await ask('/netmode?mode=static&ip=192.168.1.5&mask=255.255.255.0&save=1')
       === 'ok static 192.168.1.5 255.255.255.0 saved', r);
    ok('不保存就是 ram',
       await ask('/netmode?mode=static&ip=192.168.1.5&mask=255.255.255.0&save=0')
       === 'ok static 192.168.1.5 255.255.255.0 ram', r);
    ok('服务器档把末位改成 .1、掩码定成 /24',
       await ask('/netmode?mode=server&ip=192.168.7.77&save=1')
       === 'ok server 192.168.7.1 255.255.255.0 saved', r);
    ok('客户端档不带地址',
       await ask('/netmode?mode=client&save=0') === 'ok client - - ram', r);
    ok('地址不合法直接回 bad ip',
       await ask('/netmode?mode=static&ip=1.2.3&save=0') === 'bad ip', r);
    ok('模式不认识就 bad mode',
       await ask('/netmode?mode=bridge&save=0') === 'bad mode', r);
  }

  console.log('\n--- 不连续的掩码设备不收 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#amode').value = 'static'; w.amodesw();
    $(w, '#nip').value = '192.168.9.1';
    $(w, '#nmask').value = '10.0.0.1';
    w.applyaddr();
    ok('形状对的掩码页面拦不住', on(w, '#mask'));
    $(w, '#yes').click();
    await sleep(600);
    ok('设备把它挡回来', /没有接受.*bad mask/.test(txt(w, '#nh')), txt(w, '#nh'));
    ok('没有假装设备搬了家', !on(w, '#off'));
    ok('心跳也没白停', w.HB === 1, w.HB);
  }

  console.log('\n--- 在 IP 框里按回车 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    $(w, '#amode').value = 'static'; w.amodesw();
    $(w, '#nip').value = '192.168.9.1';
    ok('回车不再弹那个空的写入确认框', w.ask() === false &&
       !/未选择任何文件/.test(txt(w, '#abody')), txt(w, '#abody'));
    ok('回车就是「应用」', on(w, '#mask') &&
       /192\.168\.9\.1/.test(txt(w, '#abody')), txt(w, '#abody'));
    ok('标题是改网络模式不是设备详情',
       txt(w, '#atitle') === '改网络模式', txt(w, '#atitle'));
    w.hide();

    $(w, '#amode').value = 'client'; w.amodesw();
    w.ask();
    ok('客户端档回车走的是要地址那条',
       /本页面无法预知/.test(txt(w, '#abody')), txt(w, '#abody'));
  }

  console.log('\n--- 客户端 MAC 不转两遍 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    w.INFO.net.client = "a&b'c";
    w.netfill();
    ok('textContent 里不再套 esc', txt(w, '#dhsum').indexOf("a&b'c") >= 0,
       txt(w, '#dhsum'));
    ok('没有冒出 &amp; 这种东西', !/&amp;|&#39;/.test(txt(w, '#dhsum')),
       txt(w, '#dhsum'));
  }

  console.log('\n--- 该是数字的先当数字看 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p5]').click();
    await sleep(600);
    w.INFO.ports = [{ p: '2', link: 1, speed: '1000', fd: 1 },
                    { p: '3"><img src=x>', link: 1, speed: '100"><b>x</b>', fd: 1 }];
    w.netfill();
    ok('数字字符串照样当数字用', /端口 2/.test(txt(w, '#net')) &&
       /1 Gb\/s/.test(txt(w, '#net')), txt(w, '#net'));
    ok('端口号里塞标签只会变成 0', !$(w, '#net img') && /端口 0/.test(txt(w, '#net')),
       txt(w, '#net'));
    ok('速率里塞标签也一样', !$(w, '#net b'), txt(w, '#net'));

    /* /check 的 s 直接进 class，设备给什么都得先夹成 0..2 */
    const real = w.get;
    w.get = function (u, cb) {
      if (String(u).indexOf('/check') === 0)
        return cb(200, JSON.stringify({ items: [
          { n: 'a', s: '2" onmouseover="window.__Y=1', v: 'v', g: 'g' },
          { n: 'b', s: 7, v: 'v', g: 'g' }] }));
      return real(u, cb);
    };
    w.check();
    await sleep(100);
    w.get = real;
    const crows = [...w.document.querySelectorAll('#chk tr')]
      .filter(r => r.cells[0].querySelector('.dot'));
    ok('两行都渲染出来了', crows.length === 2, crows.length);
    ok('不是数字的状态落回 0',
       crows[0].cells[0].querySelector('.dot').className === 'dot s0',
       crows[0].cells[0].querySelector('.dot').className);
    ok('状态没把属性带进标签', !/onmouseover/.test($(w, '#chk').innerHTML));
    ok('超出范围的夹到 2', crows[1].cells[1].className === 's2',
       crows[1].cells[1].className);

    /* 坏块数也是设备给的 */
    w.dlrow({ name: 'x.bin', len: 1024, crc: 'abc', holes: '3"><img src=x>' });
    ok('读取失败块数不是数字就当 0', !$(w, '#dll img') && !$(w, '#dll .tag'),
       $(w, '#dll').innerHTML.slice(0, 120));
  }

  console.log('\n--- 试跑起不来，页面不锁死 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p14]').click();
    const i = $(w, '#p14 input[name=firmware]');
    Object.defineProperty(i, 'files',
      { value: [new w.File([new Uint8Array(1024)], 'x-initramfs-recovery.itb')],
        configurable: true });
    w.send();
    await sleep(3500);
    ok('走到完成页', on(w, '#p7'));
    ok('心跳留着，等设备回来', w.HB === 1, w.HB);
    ok('侧栏没被锁死', !$(w, '#app').hasAttribute('data-busy'));
    /* p7 已经把「起不来怎么办」写全了，遮罩只会盖住它 */
    ok('不再盖一层遮罩', !on(w, '#off'));
    ok('该说的话在 p7 上', /断电/.test(txt(w, '#p7')) &&
       /回到本页面/.test(txt(w, '#p7')), txt(w, '#p7'));
    ok('等设备回来靠整页刷新', w.TRYB === 1, w.TRYB);
    /* 静默久了也不许弹通用的「连接已断开」 */
    w.offline('');
    ok('通用断开框同样不弹', !on(w, '#off'));
  }

  console.log('\n--- 老功能没被碰坏 ---');
  {
    const w = await boot();
    ok('设备详情还在填', /Nokia XG-040G-MD/.test(txt(w, '#dev')));
    ok('UBI 卷表还在', w.document.querySelectorAll('#ubi tr').length === 8);
    $(w, '.nav[data-p=p8]').click();
    $(w, '#logtab').click();
    await sleep(600);
    ok('串口日志还能读', /Airoha Web U-Boot/.test(txt(w, '#log')));
    ok('日志里有内存推导过程', /probing by address aliasing/.test(txt(w, '#log')));
    ok('日志里有每一步的锚点读数', /anchor now 0xa5a55a5a/.test(txt(w, '#log')));
    setsel(w, 'dev', 'nofip');
    await sleep(600);
    ok('没有 fip 卷的红条还在', !$(w, '#ban').hasAttribute('hidden') &&
       /没有 U-Boot/.test(txt(w, '#bant')));
    ok('日常刷机页说清设备不会自己走', /不会自行引导/.test(txt(w, '#p1')));

    const who = [...w.document.querySelectorAll('a')]
      .filter(a => a.textContent === 'Loong');
    ok('三处作者名都是链接', who.length === 3, who.length);
    ok('指向作者的 GitHub 主页',
       who.every(a => a.getAttribute('href') === 'https://github.com/Loong1996'),
       who.map(a => a.getAttribute('href')).join('|'));
    ok('新标签页打开且带 noopener',
       who.every(a => a.target === '_blank' && /noopener/.test(a.rel)));
    ok('侧栏副标题那处也在', !!$(w, '.side .id a'));

    // 页内跳转链接是内联 onclick，改错了函数名只有点下去才炸
    const dead = [...w.document.querySelectorAll('[onclick]')]
      .map(e => e.getAttribute('onclick'))
      .flatMap(h => [...h.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))
      .filter(fn => !['if', 'for', 'while', 'switch', 'catch', 'return',
                     'typeof', 'function', 'new'].includes(fn))
      .filter(fn => typeof w[fn] !== 'function');
    ok('所有内联 onclick 调的函数都存在', dead.length === 0, dead.join(','));
  }

  console.log('\n--- 关掉 STOCK 的构建 ---');
  {
    const w = await boot(HTML_NOSTOCK);
    ok('刷回原厂整块没编进来', !$(w, '#p4') && !$(w, '.nav[data-p=p4]'));
    ok('它的写入完成页也没有', !$(w, '#p13'));

    /* 试跑是服务端一直都有的能力，不跟着 stock restore 走。侧栏按钮和 p1 上
       的跳转都在 STOCK 段外面，页要是留在段里面，点下去就是一片空白 */
    ok('侧栏还有试跑固件', !!$(w, '.nav[data-p=p14]'));
    ok('试跑页本身也在', !!$(w, '#p14'));
    ok('日常刷机里的跳转落得下去',
       w.jump('p14') === false && !!$(w, '#p14') && on(w, '#p14'));
    $(w, '.nav[data-p=p1]').click();
    ok('回得去日常刷机', on(w, '#p1'));
    $(w, '.nav[data-p=p14]').click();
    ok('侧栏点进去也不是空白', on(w, '#p14'));
    ok('tryboot 标记跟着页一起在', !!$(w, '#p14 input[name=tryboot]'));

    /* 反过来也查一遍：侧栏每个按钮都得有对应的 pane */
    const orphan = navs(w).map(b => b.getAttribute('data-p'))
      .filter(id => !$(w, '#' + id));
    ok('侧栏没有指向不存在的页', orphan.length === 0, orphan.join(','));
  }

  console.log('\n--- 擦净尾部：确认框先说清楚 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    const i = $(w, '#p4 input[name=stock]');
    const f = new w.File([new Uint8Array(4)], 'all_flash.bin');
    Object.defineProperty(f, 'size', { value: 200 * 1024 * 1024 });
    Object.defineProperty(i, 'files', { value: [f], configurable: true });

    /* 256 MiB 的片子写 200 MiB，剩下 56 MiB */
    w.ask();
    ok('说了尾部会被擦成空白',
       /剩余的 56[.,]0 MiB 将被擦成空白/.test(txt(w, '#abody')), txt(w, '#abody'));
    w.hide();

    $(w, '#p4 input[name=wipe]').checked = false;
    w.ask();
    ok('取消勾选就改口说保留',
       /剩余的 56[.,]0 MiB 保留原有内容不动/.test(txt(w, '#abody')), txt(w, '#abody'));
    w.hide();
  }

  console.log('\n--- 擦净尾部：默认值跟着写入偏移走 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    const wp = $(w, '#p4 input[name=wipe]');
    ok('开页面是偏移 0，默认勾着', wp.checked);

    setoff(w, '0x20000');
    ok('偏移改成非 0 就松勾', !wp.checked);

    setoff(w, '0x0');
    ok('改回 0 又勾上', wp.checked);

    /* 亲手动过之后不再代他决定：勾上再改偏移，勾不会掉 */
    setoff(w, '0x20000');
    wp.checked = true;
    wp.onchange();
    setoff(w, '0x40000');
    ok('亲手勾上之后改偏移不会被覆盖', wp.checked);
  }

  {
    /* 反向也一样：亲手松勾之后，回到偏移 0 不会自己勾回来 */
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    const wp = $(w, '#p4 input[name=wipe]');
    wp.checked = false;
    wp.onchange();
    setoff(w, '0x20000');
    setoff(w, '0x0');
    ok('亲手松勾之后回到偏移 0 也不会自己勾回来', !wp.checked);
  }

  console.log('\n--- 擦净尾部：不勾就不报那一行 ---');
  {
    const w = await boot();
    $(w, '.nav[data-p=p4]').click();
    const i = $(w, '#p4 input[name=stock]');
    const f = new w.File([new Uint8Array(4)], 'all_flash.bin');
    Object.defineProperty(f, 'size', { value: 1 << 20 });
    Object.defineProperty(i, 'files', { value: [f], configurable: true });
    $(w, '#p4 input[name=wipe]').checked = false;
    w.send();
    await sleep(3200);
    ok('照样落到写入完成页', on(w, '#p13'));
    const rows = [...w.document.querySelectorAll('#stres tr')];
    ok('回报回到三项', rows.length === 3, rows.length);
    ok('没有擦净尾部那一行', !/擦净尾部/.test(txt(w, '#stres')), txt(w, '#stres'));
  }

  console.log('\n--- 上传完成那一刻说的话 ---');
  {
    /* 桩：80ms 触发 upload.onload，1200ms 后才回 200，中间这段就是屏幕上
       挂着那句话的时间 */
    const w = await boot();
    $(w, '.nav[data-p=p14]').click();
    const i = $(w, '#p14 input[name=firmware]');
    Object.defineProperty(i, 'files',
      { value: [new w.File([new Uint8Array(1024)], 'x-initramfs-recovery.itb')],
        configurable: true });
    w.send();
    await sleep(600);
    const what = txt(w, '#p14 .pwhat');
    /* 试跑一个字节都不写闪存，这里原来跟着别的页一起说「开始写入闪存」 */
    ok('没说在写闪存', !/写入闪存/.test(what), what);
    ok('说的是载入内存要启动了', /已载入内存，即将启动/.test(what), what);
    ok('不给按写入速度算的预计时间', txt(w, '#p14 .pct') === '',
       txt(w, '#p14 .pct'));
  }

  console.log('\n--- 真要写闪存的页照旧 ---');
  {
    const w = await boot();
    const i = $(w, '#p1 input[name=firmware]');
    Object.defineProperty(i, 'files',
      { value: [new w.File([new Uint8Array(1024)], 'x.itb')], configurable: true });
    w.send();
    await sleep(600);
    ok('日常刷机还是说开始写入闪存',
       /上传完成，设备开始写入闪存/.test(txt(w, '#p1 .pwhat')), txt(w, '#p1 .pwhat'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
