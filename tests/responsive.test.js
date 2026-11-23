import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=read('public/style.css'),script=read('public/viewport.js'),html=read('public/index.html');

test('small phone windows keep a full-width board and scroll for short screens',()=>{
  const latest=css.split('v0.7 — Telegram Desktop narrow webview')[1];
  assert.ok(latest);
  assert.match(latest,/overflow-y:auto/);
  assert.match(latest,/width:min\(100%,510px\)/);
  assert.match(latest,/overflow-x:auto/);
});
test('fullscreen safe area is applied to app, dialogs and return button',()=>{
  assert.match(html,/src="\/viewport\.js"/);
  assert.match(css,/--chess-telegram-clear-top/);
  assert.match(css,/html\.chess-tg-fullscreen \.dialog\[open\]/);
  assert.match(script,/safeAreaInset/);
  assert.match(script,/contentSafeAreaInset/);
  for(const event of ['fullscreenChanged','safeAreaChanged','contentSafeAreaChanged','viewportChanged'])
    assert.ok(script.includes(event),event);
  assert.match(script,/telegram\.requestFullscreen\(\)/);
  assert.match(script,/telegram\.exitFullscreen\(\)/);
});
function mock({full=false,mobile=true,safe=0,content=0}={}){
  const events={},style={},classes=new Set();
  const button={addEventListener(name,fn){events['button_'+name]=fn},setAttribute(){},textContent:''};
  const root={style:{setProperty:(key,val)=>{style[key]=val}},classList:{toggle:(key,on)=>{if(on)classes.add(key);else classes.delete(key)}}};
  const doc={readyState:'complete',fullscreenElement:null,documentElement:root,
    querySelector:()=>({appendChild(){}}),getElementById:()=>null,createElement:()=>button,
    addEventListener(name,fn){events[name]=fn}};
  const telegram={isFullscreen:full,safeAreaInset:{top:safe,bottom:4},
    contentSafeAreaInset:{top:content,bottom:8},
    onEvent:(name,fn)=>{events[name]=fn},
    requestFullscreen(){telegram.isFullscreen=true},
    exitFullscreen(){telegram.isFullscreen=false},
    expand(){}};
  const win={Telegram:{WebApp:telegram},innerWidth:mobile?390:1280,
    matchMedia:()=>({matches:mobile}),getComputedStyle:()=>({getPropertyValue:()=>''}),
    addEventListener(){},requestAnimationFrame:cb=>cb()};
  vm.runInNewContext(script,{window:win,document:doc},{timeout:1000});
  return {style,classes,events,telegram,button};
}
test('top controls shift below Telegram chrome only in mobile fullscreen',()=>{
  const t=mock({full:false,mobile:true,safe:25,content:58});
  assert.equal(t.style['--chess-telegram-clear-top'],'0px');
  t.telegram.isFullscreen=true;t.events.fullscreenChanged();
  assert.equal(t.style['--chess-telegram-clear-top'],'96px');
  assert.equal(t.classes.has('chess-tg-fullscreen'),true);
  t.telegram.contentSafeAreaInset.top=112;
  t.events.contentSafeAreaChanged();
  assert.equal(t.style['--chess-telegram-clear-top'],'137px');
  t.telegram.isFullscreen=false;t.events.fullscreenChanged();
  assert.equal(t.style['--chess-telegram-clear-top'],'0px');
  assert.equal(t.classes.has('chess-tg-fullscreen'),false);
  const desktop=mock({full:true,mobile:false,safe:30,content:90});
  assert.equal(desktop.style['--chess-telegram-clear-top'],'0px');
});
test('zero insets still keep mobile controls out of the Telegram overlay',()=>{
  const t=mock({full:true,mobile:true,safe:0,content:0});
  assert.equal(t.style['--chess-telegram-clear-top'],'96px');
});
