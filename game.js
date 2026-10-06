"use strict";
/* Prince of Persia 2D — Palace Adventure. Single-file canvas game, phone/tablet ready. */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 960, H = 540, TILE = 32;
const GRAV = 2300, MOVE = 235, SNEAK = 120, JUMP = 760, CLIMB_SPD = 150;

const $ = id => document.getElementById(id);
const overlay = $('overlay'), card = $('card'), toastEl = $('toast');

const input = { left:false, right:false, up:false, down:false, jump:false, atk:false, block:false };
let jumpQueued = false, atkQueued = false, swordToggleQueued = false;

function toast(msg, ms=1800){
  toastEl.textContent = msg; toastEl.style.opacity = 1;
  clearTimeout(toast._t); toast._t = setTimeout(()=>toastEl.style.opacity=0, ms);
}

/* ---------- audio (synthesized, no assets) ---------- */
let AC = null, muted = false;
function beep(freq=440, dur=0.12, type='square', vol=0.12, slide=0){
  if (muted) return;
  try{
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, AC.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30,freq+slide), AC.currentTime+dur);
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime+dur);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime+dur);
  }catch(e){}
}
const sfx = {
  jump(){ beep(300,0.18,'square',0.10,250); },
  land(){ beep(140,0.08,'sine',0.08,-40); },
  sword(){ beep(1400,0.12,'sawtooth',0.07,-900); },
  clang(){ beep(2200,0.14,'square',0.08,-1400); beep(700,0.1,'triangle',0.08); },
  hurt(){ beep(200,0.25,'sawtooth',0.14,-120); },
  potion(){ beep(500,0.2,'sine',0.12,400); setTimeout(()=>beep(750,0.2,'sine',0.1,300),120); },
  crumble(){ beep(120,0.3,'sawtooth',0.1,-60); },
  spike(){ beep(900,0.2,'sawtooth',0.12,-700); },
  door(){ beep(180,0.5,'triangle',0.12,120); beep(360,0.4,'sine',0.08,80); },
  win(){ [523,659,784,1046].forEach((f,i)=>setTimeout(()=>beep(f,0.25,'triangle',0.12),i*140)); },
  die(){ [400,300,220,140].forEach((f,i)=>setTimeout(()=>beep(f,0.3,'sawtooth',0.1,-50),i*160)); },
  guardDie(){ beep(350,0.3,'square',0.1,-250); }
};

/* ---------- levels (built in code so layouts are always consistent) ---------- */
function emptyGrid(w,h){ const g=[]; for(let r=0;r<h;r++) g.push(new Array(w).fill('.')); return g; }
function rect(g,x0,y0,x1,y1,ch){ for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) if(g[y]&&x>=0&&x<g[y].length) g[y][x]=ch; }

function buildLevel(idx){
  const WL = [72, 84, 96][idx];
  const HL = 17;
  const g = emptyGrid(WL, HL);
  const groundTop = 13; // surface row = 13 means solid starts at 14
  // base ground
  rect(g, 0, 14, WL-1, 16, '#');
  const pits = idx===0 ? [[18,20],[34,36],[52,54]] : idx===1 ? [[14,16],[28,31],[44,46],[60,63]] : [[12,14],[24,27],[40,44],[58,62],[76,80]];
  for (const [a,b] of pits) rect(g, a, 14, b, 16, '.');
  // platforms
  const plats = idx===0
    ? [[8,10,13,10],[22,8,27,8],[38,10,43,10],[56,8,61,8]]
    : idx===1
    ? [[6,10,11,10],[20,8,25,8],[33,10,38,10],[48,8,53,8],[64,10,69,10]]
    : [[5,10,10,10],[17,8,22,8],[30,10,35,10],[47,8,52,8],[55,10,60,10],[66,8,71,8],[82,10,87,10]];
  for (const [x0,y,x1] of plats) { /* y is row */ }
  for (const p of plats) rect(g, p[0], p[1], p[2], p[1], '#');
  // ladders connecting ground to platforms
  const ladders = idx===0 ? [[9,11,13],[39,11,13],[57,9,13]] : idx===1 ? [[7,11,13],[34,11,13],[65,11,13]] : [[6,11,13],[31,11,13],[56,11,13],[83,11,13]];
  for (const [x,y0,y1] of ladders) for(let y=y0;y<=y1;y++) g[y][x]='|';
  // loose (collapsing) floors over solid stretches
  const loose = idx===0 ? [[15,14,17,14]] : idx===1 ? [[24,14,26,14],[50,14,51,14]] : [[20,14,22,14],[45,14,47,14],[68,14,70,14]];
  // note: loose tiles sit at row 14 replacing '#', i.e. same surface
  for (const [x0,,x1] of loose) for(let x=x0;x<=x1;x++) g[14][x]='=';

  // spikes sit ON ground: row 13 hazard
  const spikes = idx===0 ? [12,26,42,48] : idx===1 ? [10,23,37,42,56,68] : [9,19,29,38,50,64,74];
  for (const x of spikes) g[13][x]='^';
  // chopper positions (arch + blade)
  const choppers = idx===0 ? [30,46] : idx===1 ? [19,35,55] : [16,33,53,72];
  for (const x of choppers) g[13][x]='C';
  // saws patrol segments [x0,x1] in tiles on ground row 13
  const saws = idx===0 ? [{a:38,b:43}] : idx===1 ? [{a:33,b:38},{a:64,b:69}] : [{a:30,b:35},{a:55,b:60},{a:82,b:87}];
  // guards {x (tile), hp}
  const guards = idx===0
    ? [{x:24,hp:3},{x:44,hp:3},{x:62,hp:4}]
    : idx===1
    ? [{x:18,hp:3},{x:32,hp:4},{x:49,hp:4},{x:66,hp:5}]
    : [{x:15,hp:4},{x:28,hp:4},{x:43,hp:5},{x:57,hp:5},{x:78,hp:6}];
  // potions {x,row,big}
  const potions = idx===0
    ? [{x:11,row:9,big:false},{x:33,row:13,big:false},{x:58,row:7,big:true}]
    : idx===1
    ? [{x:8,row:9,big:false},{x:27,row:13,big:false},{x:50,row:7,big:true},{x:67,row:9,big:false}]
    : [{x:7,row:9,big:false},{x:32,row:9,big:true},{x:49,row:7,big:false},{x:69,row:13,big:true},{x:84,row:9,big:false}];
  const names = ['Level 1 — Palace Gates','Level 2 — Dungeon of Blades','Level 3 — Throne of the Vizier'];
  const hints = [
    'Reach the golden gate. Draw your sword (X) before guards. Hold block to parry.',
    'Watch the floor — cracked tiles collapse. Time the choppers and saws.',
    'The Vizier waits. Use ladders (Up/Down), grab ledges, save your potions.'
  ];
  return {
    idx, name:names[idx], hint:hints[idx], w:WL, h:HL, grid:g,
    spawn:{x:2.5*TILE, y:10*TILE}, doorCol: WL-4, guards, potions, saws, choppers, spikes
  };
}

const LEVELS = [buildLevel(0), buildLevel(1), buildLevel(2)];

/* ---------- game state ---------- */
const S = {
  mode:'title', levelIdx:0, score:0, timeLeft:600, camX:0,
  player:null, guards:[], parts:[], floats:[],
  loose:{}, saws:[], chops:[], pots:[], shake:0, flash:0, t:0, best:+(localStorage.getItem('pop2d_best')||0)
};

function tileAt(lv, tx, ty){
  if (tx<0 || tx>=lv.w) return '#';
  if (ty<0) return '.';
  if (ty>=lv.h) return '.'; // below = pit (fall death)
  return lv.grid[ty][tx];
}
function looseState(lv,tx,ty){
  const k = tx+','+ty;
  if (!S.loose[k]) S.loose[k] = {st:'solid', t:0};
  return S.loose[k];
}
function isSolid(lv,tx,ty){
  const c = tileAt(lv,tx,ty);
  if (c==='#') return true;
  if (c==='='){ const l=looseState(lv,tx,ty); return (l.st==='solid'||l.st==='shaking'); }
  return false;
}
function isLadder(lv,tx,ty){ return tileAt(lv,tx,ty)==='|'; }

function makePlayer(x,y){
  return { x,y,w:22,h:48, vx:0,vy:0, dir:1, onGround:false, coyote:0, jumpBuf:0,
    hp:5, maxhp:5, sword:false, atkT:0, atkCD:0, atkHit:false, block:false, crouch:false,
    climb:false, hang:false, hangDir:1, hurtT:0, stepT:0, safeX:x, safeY:y, safeT:0, dead:false };
}
function makeGuard(x,hp,lvl){
  return { x, y:10*TILE, w:24,h:48, vx:0,vy:0, dir:-1, onGround:false, hp, maxhp:hp,
    state:'idle', t:Math.random()*2, atkT:0, atkCD:1+Math.random(), hurtT:0, block:false, dead:false, lvl, stepT:0 };
}

function loadLevel(i, keepHP){
  const lv = LEVELS[i];
  S.levelIdx = i; S.loose = {}; S.parts=[]; S.floats=[];
  const hp = keepHP && S.player ? S.player.hp : 5;
  S.player = makePlayer(lv.spawn.x, lv.spawn.y);
  S.player.hp = hp;
  S.guards = lv.guards.map(g=>makeGuard((g.x+0.5)*TILE, g.hp, i));
  S.pots = lv.potions.map(p=>({x:(p.x+0.5)*TILE, y:(p.row+0.5)*TILE, big:p.big, taken:false, bob:Math.random()*6}));
  S.saws = lv.saws.map(s=>({x0:(s.a+0.5)*TILE, x1:(s.b+0.5)*TILE, x:(s.a+0.5)*TILE, dir:1, spd:90+i*25, y:13.55*TILE}));
  S.chops = lv.choppers.map(x=>({x:(x+0.5)*TILE, phase:Math.random()*2, period:2.2-i*0.25, bladeY:0}));
  S.camX = 0;
  updateHUD();
}

function rectsOverlap(a,b){ return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y; }
function entRect(e){ return {x:e.x-e.w/2, y:e.y-e.h, w:e.w, h:e.h}; }

/* collision move */
function physMove(lv, e, dt, useLadder){
  // horizontal
  e.x += e.vx*dt;
  let r = entRect(e);
  const top = Math.floor(r.y/TILE), bot = Math.floor((r.y+r.h-1)/TILE);
  if (e.vx>0){
    const tx = Math.floor((r.x+r.w)/TILE);
    for(let ty=top;ty<=bot;ty++) if(isSolid(lv,tx,ty)){
      e.x = tx*TILE - e.w/2 - 0.1; e.vx = 0;
      e.hitWall = 1; break;
    }
  } else if (e.vx<0){
    const tx = Math.floor(r.x/TILE);
    for(let ty=top;ty<=bot;ty++) if(isSolid(lv,tx,ty)){
      e.x = (tx+1)*TILE + e.w/2 + 0.1; e.vx = 0;
      e.hitWall = -1; break;
    }
  } else e.hitWall = 0;
  if (e.vx!==0 && !e.hitWall) e.hitWall = 0;
  // vertical
  e.vy += GRAV*dt;
  if (e.vy>1100) e.vy=1100;
  e.y += e.vy*dt;
  e.onGround = false;
  r = entRect(e);
  const l = Math.floor((r.x+2)/TILE), rr = Math.floor((r.x+r.w-3)/TILE);
  if (e.vy>=0){
    const ty = Math.floor((r.y+r.h)/TILE);
    for(let tx=l;tx<=rr;tx++) if(isSolid(lv,tx,ty)){
      e.y = ty*TILE - 0.1; e.vy = 0; e.onGround = true;
      e.groundTiles = [tx,ty]; break;
    }
  } else {
    const ty = Math.floor(r.y/TILE);
    for(let tx=l;tx<=rr;tx++) if(isSolid(lv,tx,ty)){
      e.y = (ty+1)*TILE + e.h + 0.1; e.vy = 0; break;
    }
  }
}

function burst(x,y,n,col,spd=220,life=0.6){
  for(let i=0;i<n;i++) S.parts.push({x,y,vx:(Math.random()-0.5)*spd*2,vy:-Math.random()*spd-40,life:life*(0.5+Math.random()*0.8),t:0,col,sz:2+Math.random()*3});
}
function floatText(x,y,txt,col='#ffd97a'){ S.floats.push({x,y,txt,t:0,col}); }

/* ---------- HUD / screens ---------- */
function updateHUD(){
  $('hHP').textContent = S.player? S.player.hp : 5;
  $('hLv').textContent = (S.levelIdx+1)+'/3';
  $('hScore').textContent = S.score;
  $('hSword').textContent = S.player && S.player.sword ? 'drawn' : 'sheathed';
  const m = Math.max(0,Math.floor(S.timeLeft/60)), s = Math.max(0,Math.floor(S.timeLeft%60));
  $('hTime').textContent = m+':'+String(s).padStart(2,'0');
}
function show(html){ card.innerHTML = html; overlay.classList.remove('hidden'); }
function hide(){ overlay.classList.add('hidden'); }

function showTitle(){
  S.mode='title';
  show(`<h1>🕌 PRINCE OF PERSIA 2D</h1>
  <h2>Palace Adventure — rescue the Princess before the sands run out</h2>
  <p>The evil Vizier has seized the palace. <b>Run, jump, climb, fight</b> through 3 deadly levels of spikes, saws, choppers, crumbling floors and royal guards.</p>
  <div class="row"><button class="btn" id="bStart">▶ START ADVENTURE</button><button class="btn ghost" id="bHow">❓ HOW TO PLAY</button></div>
  <div class="keys">⌨️ <b>Arrows / WASD</b> move &amp; climb • <b>Space</b> jump • <b>X</b> draw sword • <b>F</b> attack • <b>G / hold</b> block • <b>P</b> pause<br>📱 Use the on-screen buttons — left pad to move, ⤒ jump, ⚔ attack, 🛡 block, 🗡 sword.</div>
  ${S.best?`<p style="margin-top:8px">🏆 Best score: <b>${S.best}</b></p>`:''}`);
  $('bStart').onclick = ()=>{ startGame(); };
  $('bHow').onclick = showHelp;
}
function showHelp(){
  S.mode='help';
  show(`<h1>HOW TO PLAY</h1>
  <p>🏃 <b>Run &amp; jump</b> across gaps — you can briefly run off edges (coyote time).<br>
  🧗 <b>Climb ladders</b> with Up/Down. <b>Grab ledges</b> automatically when falling against them — press <b>Up</b> to mantle.<br>
  🗡 Press <b>sword button</b> to draw your blade near guards. <b>Attack</b> is ⚔, <b>hold block</b> 🛡 to parry.<br>
  🩸 <b>Red potions</b> heal 1, <b>big gold potions</b> heal 2. Spikes, saws &amp; choppers hurt — time them!<br>
  🧱 Cracked tiles <b>collapse</b> — keep moving. Reach the <b>golden gate</b> to clear each level.</p>
  <div class="row"><button class="btn" id="bBack">◀ BACK</button><button class="btn" id="bGo">▶ PLAY</button></div>`);
  $('bBack').onclick = showTitle; $('bGo').onclick = ()=>startGame();
}
function levelIntro(i){
  S.mode='intro';
  const lv = LEVELS[i];
  show(`<h1>${lv.name}</h1><p>${lv.hint}</p>
  <p style="opacity:.8">Guards: ${lv.guards.length} • Time carries over — hurry, the Princess waits!</p>
  <div class="row"><button class="btn" id="bPlay">⚔ ENTER</button></div>`);
  $('bPlay').onclick = ()=>{ hide(); S.mode='playing'; toast(lv.name); beep(600,0.2,'triangle',0.1,200); };
}
function pauseGame(){
  if (S.mode!=='playing') return;
  S.mode='paused';
  show(`<h1>⏸ PAUSED</h1><p>Score ${S.score} • Level ${S.levelIdx+1}/3 • Time left ${$('hTime').textContent}</p>
  <div class="row"><button class="btn" id="bR">▶ RESUME</button><button class="btn ghost" id="bQ">↺ RESTART LEVEL</button></div>
  <div class="keys"><button class="btn ghost" id="bM">${muted?'🔊 UNMUTE':'🔇 MUTE'}</button></div>`);
  $('bR').onclick=()=>{hide();S.mode='playing';};
  $('bQ').onclick=()=>{hide();loadLevel(S.levelIdx,true);S.mode='playing';};
  $('bM').onclick=()=>{muted=!muted;$('bM').textContent=muted?'🔊 UNMUTE':'🔇 MUTE';};
}
function gameOver(reason){
  S.mode='over'; sfx.die();
  if (S.score>S.best){ S.best=S.score; localStorage.setItem('pop2d_best',S.best); }
  show(`<h1>💀 GAME OVER</h1><h2>${reason}</h2><p>Score <b>${S.score}</b> • Best <b>${S.best}</b></p>
  <div class="row"><button class="btn" id="bA">↺ TRY AGAIN</button><button class="btn ghost" id="bT">TITLE</button></div>`);
  $('bA').onclick=()=>startGame(); $('bT').onclick=showTitle;
}
function victory(){
  S.mode='win'; sfx.win();
  const bonus = Math.floor(S.timeLeft)*2;
  S.score += bonus;
  if (S.score>S.best){ S.best=S.score; localStorage.setItem('pop2d_best',S.best); }
  show(`<h1>👑 YOU RESCUED THE PRINCESS!</h1>
  <p>The Vizier is defeated and the palace is free. The sands of time bow to you.</p>
  <p>Time bonus <b>+${bonus}</b> • Final score <b>${S.score}</b> • Best <b>${S.best}</b></p>
  <div class="row"><button class="btn" id="bP">▶ PLAY AGAIN</button><button class="btn ghost" id="bT2">TITLE</button></div>`);
  $('bP').onclick=()=>startGame(); $('bT2').onclick=showTitle;
}
function levelClear(){
  S.mode='clear'; sfx.door(); sfx.win();
  S.score += 500;
  show(`<h1>🚪 LEVEL ${S.levelIdx+1} CLEAR!</h1><p>+500 bonus • Score <b>${S.score}</b></p>
  <div class="row"><button class="btn" id="bN">▶ NEXT LEVEL</button></div>`);
  $('bN').onclick=()=>{
    hide();
    if (S.levelIdx+1>=LEVELS.length) victory();
    else { loadLevel(S.levelIdx+1,true); S.player.hp=Math.min(S.player.maxhp,S.player.hp+1); levelIntro(S.levelIdx); }
  };
}

function startGame(){
  S.score=0; S.timeLeft=600;
  loadLevel(0,false); hide(); S.mode='playing';
  toast('Save the Princess! →');
  beep(500,0.2,'triangle',0.1,300);
}

/* ---------- damage / death ---------- */
function hurtPlayer(n, kx=0){
  const p = S.player;
  if (p.dead || p.hurtT>0 || S.mode!=='playing') return;
  if (p.block && p.sword){ n = Math.max(0,n-1); sfx.clang(); burst(p.x,p.y-30,6,'#ffe9a0'); floatText(p.x,p.y-60,'PARRY','#aef'); if(n<=0){p.hurtT=0.25;return;} }
  p.hp -= n; p.hurtT = 0.8; p.vx = kx; p.vy = -260; S.shake=0.25; S.flash=0.25;
  sfx.hurt(); burst(p.x,p.y-24,10,'#c33'); updateHUD();
  if (p.hp<=0){ p.dead=true; setTimeout(()=>{ if(S.mode==='playing') gameOver('Your strength fails... the palace falls silent.'); },900); }
}
function hurtGuard(g,n,kx=0){
  if (g.dead || g.hurtT>0) return;
  if (g.block && Math.random()<0.5){ sfx.clang(); burst(g.x,g.y-30,5,'#fff'); floatText(g.x,g.y-62,'BLOCK','#aef'); return; }
  g.hp -= n; g.hurtT=0.5; g.vx=kx; sfx.clang(); burst(g.x,g.y-28,8,'#ff6b5e');
  if (g.hp<=0){ g.dead=true; S.score+=200; floatText(g.x,g.y-60,'+200'); sfx.guardDie(); burst(g.x,g.y-24,16,'#ffd97a'); updateHUD(); }
}

/* ---------- update ---------- */
function playerOnLadder(lv,p){
  const cx = Math.floor(p.x/TILE);
  const top = Math.floor((p.y-p.h+4)/TILE), bot = Math.floor((p.y-4)/TILE);
  for(let ty=top;ty<=bot;ty++) if(isLadder(lv,cx,ty)) return true;
  return false;
}

function update(dt){
  S.t += dt;
  if (S.mode!=='playing') return;
  const lv = LEVELS[S.levelIdx], p = S.player;
  S.timeLeft -= dt; updateHUD();
  if (S.timeLeft<=0){ S.timeLeft=0; gameOver('The sands of time ran out. The Princess is lost...'); return; }
  if (p.dead){ // death fall anim
    p.vy += GRAV*dt; p.y += p.vy*dt;
    updateParts(dt); return;
  }

  // input direction
  const L = input.left, R = input.right;
  p.block = input.block && p.sword && p.onGround;
  p.crouch = input.down && p.onGround && !p.sword;

  // sword toggle
  if (swordToggleQueued){ swordToggleQueued=false; p.sword=!p.sword; sfx.sword(); updateHUD(); toast(p.sword?'Sword drawn!':'Sword sheathed'); }
  // ladder check
  const onLad = playerOnLadder(lv,p);
  if (!p.climb && onLad && (input.up||input.down) && Math.abs(p.vx)<50){ p.climb=true; p.hang=false; p.vx=0; p.vy=0; }
  if (p.climb && !onLad){ p.climb=false; }

  if (p.hang){
    p.vx=0; p.vy=0;
    if (input.up || jumpQueued){
      // mantle: move up + toward wall
      p.hang=false; p.y -= 34; p.x += p.hangDir*20; p.vy=-120;
      sfx.jump(); burst(p.x,p.y,5,'#cbb');
    } else if (input.down){ p.hang=false; p.vy=60; }
    jumpQueued=false;
  } else if (p.climb){
    p.vx=0; p.vy=0;
    const cx = Math.floor(p.x/TILE);
    // snap to ladder center
    p.x += ((cx+0.5)*TILE - p.x)*Math.min(1,dt*10);
    if (input.up) p.y -= CLIMB_SPD*dt;
    if (input.down) p.y += CLIMB_SPD*dt;
    if (input.left) p.dir=-1; if (input.right) p.dir=1;
    if (jumpQueued){ jumpQueued=false; p.climb=false; p.vy=-JUMP*0.9; p.vx=p.dir*MOVE; sfx.jump(); }
    // collide vertically only
    p.y += 0;
    const r = entRect(p);
    const ty = input.down ? Math.floor((r.y+r.h)/TILE) : Math.floor(r.y/TILE);
    // land on ground while climbing down
    const rr2 = entRect(p); const l2=Math.floor((rr2.x+2)/TILE), r2=Math.floor((rr2.x+rr2.w-3)/TILE);
    if (input.down){
      const tyy=Math.floor((rr2.y+rr2.h+2)/TILE);
      let g=false; for(let tx=l2;tx<=r2;tx++) if(isSolid(lv,tx,tyy)){g=true;break;}
      if(g){ p.climb=false; p.y=tyy*TILE-0.1; p.onGround=true; }
    }
  } else {
    // normal movement
    const spd = (p.crouch?SNEAK:(p.sword?MOVE*0.7:MOVE)) * (p.block?0.25:1);
    let want = 0;
    if (L) want-=1; if (R) want+=1;
    const accel = p.onGround? 2200 : 1400;
    if (want!==0){ p.vx += want*accel*dt; p.dir = want>0?1:-1; if(!p.sword&&!p.crouch&&Math.abs(p.vx)>spd) p.vx += (spd*Math.sign(p.vx)-p.vx)*Math.min(1,dt*8); }
    else { const f = p.onGround? 1800:300; p.vx -= Math.sign(p.vx)*Math.min(Math.abs(p.vx),f*dt); }
    if (Math.abs(p.vx)>MOVE*1.25) p.vx = Math.sign(p.vx)*MOVE*1.25;

    p.coyote -= dt; p.jumpBuf -= dt;
    if (jumpQueued){ jumpQueued=false; p.jumpBuf=0.15; }
    if (p.onGround) p.coyote=0.12;
    if (p.jumpBuf>0 && (p.onGround||p.coyote>0) && !p.block){
      p.vy = -JUMP; p.onGround=false; p.coyote=0; p.jumpBuf=0; sfx.jump(); burst(p.x,p.y,6,'#cbb',160,0.4);
    }
    // variable jump
    if (!input.jump && p.vy<-280) p.vy += GRAV*dt*1.6;

    const wasAir = !p.onGround, fallV = p.vy;
    p.hitWall = 0;
    physMove(lv,p,dt);
    if (p.onGround && wasAir && fallV>500){ sfx.land(); burst(p.x,p.y,5,'#cbb',140,0.35); }
    if (p.onGround && Math.abs(p.vx)>40){ p.stepT-=dt; if(p.stepT<=0){p.stepT=0.28; burst(p.x,p.y,2,'#a99',90,0.3);} }

    // ledge grab: hit wall while falling, head near tile top, space above free
    if (!p.onGround && p.vy>60 && p.hitWall!==0 && !p.climb){
      const dir = p.hitWall; // 1 = wall on right
      const r2 = entRect(p);
      const tx = dir>0 ? Math.floor((r2.x+r2.w+2)/TILE) : Math.floor((r2.x-2)/TILE);
      const handTy = Math.floor((r2.y+10)/TILE);
      if (isSolid(lv,tx,handTy) && !isSolid(lv,tx,handTy-1) && !isSolid(lv,tx,handTy-2)){
        p.hang=true; p.hangDir=dir; p.vx=0; p.vy=0;
        p.y = (handTy)*TILE + 8; // hands near top edge
        p.x = dir>0 ? tx*TILE - p.w/2 - 0.5 : (tx+1)*TILE + p.w/2 + 0.5;
        beep(500,0.08,'sine',0.07);
      }
    }

    // loose tiles trigger
    if (p.onGround && p.groundTiles){
      const [tx,ty] = p.groundTiles;
      if (tileAt(lv,tx,ty)==='='){
        const l = looseState(lv,tx,ty);
        if (l.st==='solid'){ l.st='shaking'; l.t=0.55; sfx.crumble(); }
      }
    }
    // safe spot memory
    p.safeT -= dt;
    if (p.onGround && p.hurtT<=0){ p.safeT=2; }
    if (p.onGround && p.safeT<=0){ /* keep last */ }
    if (p.onGround){ p.safeX=p.x; p.safeY=p.y; }
  }

  // attack
  p.atkCD -= dt; p.atkT -= dt; p.hurtT -= dt;
  if (atkQueued){ atkQueued=false;
    if (p.sword && p.atkCD<=0 && !p.block && !p.climb && !p.hang){
      p.atkT=0.28; p.atkCD=0.5; p.atkHit=false; sfx.sword();
    } else if (!p.sword){ toast('Draw your sword first (🗡)!'); beep(220,0.12,'square',0.08); }
  }
  if (p.atkT>0.13 && p.atkT<0.28 && !p.atkHit){
    // active window at start
  }
  if (p.atkT>0 && !p.atkHit){
    const hb = {x: p.dir>0? p.x : p.x-52, y:p.y-44, w:52, h:40};
    for (const g of S.guards){
      if (g.dead) continue;
      if (rectsOverlap(hb, entRect(g)) && Math.abs(g.y-p.y)<50){
        p.atkHit=true; hurtGuard(g,1,p.dir*180); S.shake=Math.max(S.shake,0.12);
        if (!g.dead) floatText(g.x,g.y-64,'HIT');
      }
    }
    // whiff spark at full extension
    if (!p.atkHit && p.atkT<0.16){ p.atkHit=true; }
  }

  // fell in pit?
  if (p.y > lv.h*TILE + 30){
    p.hp -= 1; updateHUD(); sfx.spike(); S.flash=0.3;
    if (p.hp<=0){ p.dead=true; gameOver('You fell into the abyss...'); return; }
    p.x=p.safeX; p.y=p.safeY-60; p.vx=0; p.vy=0; p.hang=false; p.climb=false; p.hurtT=1;
    // if safe spot itself is a pit (spawn), reset to level spawn
    if (p.y > lv.h*TILE){ p.x=lv.spawn.x; p.y=lv.spawn.y; }
    toast('Careful — pits! (-1 ❤)');
  }

  updateTraps(dt, lv);
  updateGuards(dt, lv);
  updatePickups(dt, lv);
  updateParts(dt);

  // door check
  const doorX = (lv.doorCol+0.5)*TILE;
  if (Math.abs(p.x-doorX)<26 && p.y > 11*TILE && p.y < 16*TILE){
    let alive = S.guards.filter(g=>!g.dead && Math.abs(g.x-doorX)<340).length;
    if (alive>0){ /* allow passing but warn once */ if(!S._warned||S.t-S._warned>5){S._warned=S.t; toast('Defeat the guards first! ⚔');} }
    else { S.score += Math.max(0,Math.floor(S.timeLeft/10)); levelClear(); return; }
  }

  // camera
  const target = Math.max(0, Math.min(lv.w*TILE - W, p.x - W*0.42));
  S.camX += (target - S.camX)*Math.min(1,dt*5);
  S.shake = Math.max(0,S.shake-dt); S.flash=Math.max(0,S.flash-dt);
  updateHUD();
}

function updateTraps(dt, lv){
  const p = S.player;
  // loose tiles
  for (const k in S.loose){
    const l = S.loose[k];
    if (l.st==='shaking'){ l.t-=dt; if(l.t<=0){l.st='falling'; l.t=0.4; sfx.crumble();} }
    else if (l.st==='falling'){ l.t-=dt; if(l.t<=0){l.st='gone'; l.t=9;} }
    else if (l.st==='gone'){ l.t-=dt; if(l.t<=0){l.st='solid';} }
  }
  // spikes
  {
    const r = entRect(p);
    const x0=Math.floor(r.x/TILE), x1=Math.floor((r.x+r.w)/TILE);
    const y0=Math.floor(r.y/TILE), y1=Math.floor((r.y+r.h)/TILE);
    for(let ty=y0;ty<=y1;ty++) for(let tx=x0;tx<=x1;tx++){
      if (tileAt(lv,tx,ty)==='^'){
        const spikeBox={x:tx*TILE+4,y:ty*TILE+14,w:TILE-8,h:TILE-14};
        const feetBox={x:r.x+4,y:r.y+r.h-12,w:r.w-8,h:12};
        if (rectsOverlap(spikeBox,feetBox)){ hurtPlayer(1, -p.dir*120); floatText(p.x,p.y-64,'OUCH','#f88'); }
      }
      if (tileAt(lv,tx,ty)==='C'){
        // chopper handled below with blade pos; proximity handled in chops loop
      }
    }
  }
  // saws
  for (const s of S.saws){
    s.x += s.dir*s.spd*dt;
    if (s.x<s.x0){s.x=s.x0;s.dir=1;} if (s.x>s.x1){s.x=s.x1;s.dir=-1;}
    const sb={x:s.x-14,y:s.y-14,w:28,h:26};
    if (rectsOverlap(sb, entRect(p))){ hurtPlayer(1, (p.x<s.x?-160:160)); }
    if (Math.random()<dt*8) S.parts.push({x:s.x+(Math.random()-0.5)*20,y:s.y-10,vx:(Math.random()-0.5)*120,vy:-120,t:0,life:0.35,col:'#ffcf6b',sz:2});
  }
  // choppers
  for (const c of S.chops){
    c.phase += dt;
    const cyc = c.phase % c.period;
    // blade drops in last 0.5s of cycle
    const dropping = cyc > c.period-0.55;
    c.bladeY = dropping ? 1-(c.period-cyc)/0.55 : 0; // 0 top, 1 bottom
    const bladeBox={x:c.x-12, y:13*TILE - 40 + c.bladeY*44, w:24, h:34};
    if (rectsOverlap(bladeBox, entRect(p)) && dropping){ hurtPlayer(1, (p.x<c.x?-200:200)); }
  }
  // guard attacks handled in updateGuards
}

function updateGuards(dt, lv){
  const p = S.player;
  for (const g of S.guards){
    if (g.dead) continue;
    g.t+=dt; g.atkCD-=dt; g.hurtT-=dt; g.atkT-=dt;
    const dx = p.x-g.x, adx=Math.abs(dx), sameH=Math.abs(p.y-g.y)<60;
    g.block = false;
    if (p.dead){ g.state='idle'; g.vx*=0.9; }
    else if (adx<420 && sameH){
      g.dir = dx>0?1:-1;
      if (adx>54){ // approach
        g.state='chase';
        g.vx += g.dir*900*dt;
        const max = 150 + g.lvl*20;
        if (Math.abs(g.vx)>max) g.vx=Math.sign(g.vx)*max;
        // randomly block while approaching if player attacking
        if (p.atkT>0 && Math.random()<dt*3) g.block=true;
      } else {
        g.vx *= 0.8;
        // attack or block
        if (g.atkCD<=0 && !p.dead){
          if (p.atkT>0 && Math.random()<0.45){ g.block=true; g.atkCD=0.5; }
          else { g.state='attack'; g.atkT=0.3; g.atkCD=1.1+Math.random()*0.9 - g.lvl*0.1; sfx.sword(); }
        } else if (p.atkT>0){ g.block = Math.random()<0.4; }
      }
    } else { g.state='idle'; g.vx*=0.9; }
    // patrol drift when idle
    if (g.state==='idle' && Math.abs(g.vx)<5 && Math.random()<dt*0.3) g.dir*=-1;
    physMove(lv,g,dt);
    if (g.onGround && Math.abs(g.vx)>30){ g.stepT-=dt; if(g.stepT<=0){g.stepT=0.3;} }
    // guard hit lands on player
    if (g.atkT>0.05 && g.atkT<0.22){
      const hb={x: g.dir>0?g.x:g.x-50, y:g.y-44, w:50, h:40};
      if (rectsOverlap(hb, entRect(p)) && Math.abs(p.y-g.y)<55){
        g.atkT=0; // single hit
        if (p.hurtT<=0){
          if (p.block&&p.sword){ sfx.clang(); burst(p.x,p.y-30,6,'#ffe9a0'); floatText(p.x,p.y-62,'PARRY','#aef'); }
          else hurtPlayer(1, g.dir*200);
        }
      }
    }
  }
}

function updatePickups(dt, lv){
  const p = S.player;
  for (const o of S.pots){
    if (o.taken) continue;
    o.bob+=dt*3;
    const box={x:o.x-12,y:o.y-12+Math.sin(o.bob)*3,w:24,h:24};
    if (rectsOverlap(box, entRect(p))){
      o.taken=true;
      const heal = o.big?2:1;
      p.hp=Math.min(p.maxhp,p.hp+heal); S.score+=50; updateHUD();
      sfx.potion(); burst(o.x,o.y,10,o.big?'#ffd97a':'#ff6b6b'); floatText(o.x,o.y-24,'+'+heal+' ❤','#8f8');
    }
  }
}

function updateParts(dt){
  for (const q of S.parts){ q.t+=dt; q.x+=q.vx*dt; q.y+=q.vy*dt; q.vy+=900*dt; }
  S.parts = S.parts.filter(q=>q.t<q.life);
  for (const f of S.floats){ f.t+=dt; f.y-=30*dt; }
  S.floats = S.floats.filter(f=>f.t<1.2);
}

/* ---------- render ---------- */
function drawBackground(){
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#0d1030'); g.addColorStop(0.55,'#2b1a55'); g.addColorStop(0.8,'#7a3b4d'); g.addColorStop(1,'#c97b3f');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  // stars
  ctx.fillStyle='#fff';
  for(let i=0;i<90;i++){ const x=(i*137.5)%W, y=(i*89.3)%260; const tw=0.4+0.6*Math.abs(Math.sin(S.t*2+i)); ctx.globalAlpha=0.25+0.5*tw; ctx.fillRect(x,y,2,2); }
  ctx.globalAlpha=1;
  // moon
  const mx=800,my=90;
  const mg=ctx.createRadialGradient(mx,my,10,mx,my,90);
  mg.addColorStop(0,'#fff8dc'); mg.addColorStop(0.25,'#ffedb0'); mg.addColorStop(1,'rgba(255,230,150,0)');
  ctx.fillStyle=mg; ctx.beginPath(); ctx.arc(mx,my,90,0,7); ctx.fill();
  ctx.fillStyle='#fff3c4'; ctx.beginPath(); ctx.arc(mx,my,34,0,7); ctx.fill();
  ctx.fillStyle='rgba(200,170,120,.5)'; ctx.beginPath(); ctx.arc(mx-10,my-6,7,0,7); ctx.arc(mx+8,my+10,5,0,7); ctx.fill();
  // far domes parallax
  const cam=S.camX*0.15;
  ctx.fillStyle='#1a1440';
  for(let i=-1;i<8;i++){
    const bx=i*220- (cam%220);
    ctx.beginPath(); ctx.arc(bx,430,70,Math.PI,0); ctx.fill();
    ctx.fillRect(bx-8,360,16,70);
    ctx.beginPath(); ctx.arc(bx,358,10,Math.PI,0); ctx.fill();
    // minaret
    ctx.fillRect(bx+90,300,18,130);
    ctx.beginPath(); ctx.arc(bx+99,300,14,Math.PI,0); ctx.fill();
  }
  // nearer silhouette
  const cam2=S.camX*0.35;
  ctx.fillStyle='#241b4d';
  for(let i=-1;i<10;i++){
    const bx=i*300-(cam2%300);
    ctx.beginPath(); ctx.arc(bx,470,60,Math.PI,0); ctx.fill();
    ctx.fillRect(bx+70,400,26,70);
  }
}

function drawTiles(lv){
  const x0=Math.max(0,Math.floor(S.camX/TILE)-1), x1=Math.min(lv.w-1,Math.ceil((S.camX+W)/TILE)+1);
  for(let ty=0;ty<lv.h;ty++) for(let tx=x0;tx<=x1;tx++){
    const c=lv.grid[ty][tx];
    const sx=Math.round(tx*TILE-S.camX), sy=ty*TILE;
    if (c==='#'){
      const gr=ctx.createLinearGradient(0,sy,0,sy+TILE);
      gr.addColorStop(0,'#6b5a8e'); gr.addColorStop(0.25,'#54467a'); gr.addColorStop(1,'#332a55');
      ctx.fillStyle=gr; ctx.fillRect(sx,sy,TILE,TILE);
      ctx.fillStyle='rgba(255,220,150,.18)'; ctx.fillRect(sx,sy,TILE,3);
      ctx.fillStyle='rgba(0,0,0,.35)'; ctx.fillRect(sx,sy+TILE-3,TILE,3);
      ctx.strokeStyle='rgba(20,12,40,.6)'; ctx.lineWidth=1;
      ctx.strokeRect(sx+0.5,sy+0.5,TILE-1,TILE-1);
      ctx.beginPath(); ctx.moveTo(sx+TILE/2,sy); ctx.lineTo(sx+TILE/2,sy+TILE); ctx.strokeStyle='rgba(0,0,0,.18)'; ctx.stroke();
      // torch glow dots
      if ((tx*7+ty*13)%29===0){
        const fl=Math.sin(S.t*9+tx)*2;
        ctx.fillStyle='#ff9d3c'; ctx.beginPath(); ctx.arc(sx+16,sy-6+fl*0.3,5,0,7); ctx.fill();
        ctx.fillStyle='#ffe9a0'; ctx.beginPath(); ctx.arc(sx+16,sy-7+fl*0.3,2.4,0,7); ctx.fill();
        const gg=ctx.createRadialGradient(sx+16,sy-6,2,sx+16,sy-6,44);
        gg.addColorStop(0,'rgba(255,170,60,.35)'); gg.addColorStop(1,'rgba(255,170,60,0)');
        ctx.fillStyle=gg; ctx.beginPath(); ctx.arc(sx+16,sy-6,44,0,7); ctx.fill();
      }
    } else if (c==='='){
      const l=S.loose[tx+','+ty];
      const st=l?l.st:'solid';
      if (st==='gone') continue;
      let oy=0;
      if (st==='shaking') oy=Math.sin(S.t*40)*2;
      if (st==='falling') oy=14;
      ctx.fillStyle= st==='shaking' ? '#a08050' : '#7a6a9a';
      ctx.fillRect(sx,sy+oy,TILE,TILE);
      ctx.strokeStyle='#3a2c10'; ctx.strokeRect(sx+0.5,sy+oy+0.5,TILE-1,TILE-1);
      ctx.fillStyle='rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.moveTo(sx+4,sy+oy+8); ctx.lineTo(sx+TILE-4,sy+oy+8); ctx.moveTo(sx+4,sy+oy+18); ctx.lineTo(sx+TILE-4,sy+oy+18); ctx.stroke();
      // cracks
      ctx.strokeStyle='#2c2008'; ctx.beginPath(); ctx.moveTo(sx+8,sy+oy+4); ctx.lineTo(sx+16,sy+oy+16); ctx.lineTo(sx+12,sy+oy+26); ctx.stroke();
    } else if (c==='|'){
      // ladder
      ctx.fillStyle='#4a3520'; ctx.fillRect(sx+6,sy,5,TILE); ctx.fillRect(sx+21,sy,5,TILE);
      ctx.fillStyle='#8a6a3e'; for(let yy=sy+4;yy<sy+TILE;yy+=9) ctx.fillRect(sx+6,yy,20,4);
    } else if (c==='^'){
      const gy=(14)*TILE; // sits on ground below
      const baseY=sy+TILE;
      ctx.fillStyle='#222'; ctx.fillRect(sx,baseY-4,TILE,4);
      for(let i=0;i<4;i++){
        const px=sx+2+i*8;
        const grd=ctx.createLinearGradient(0,baseY-22,0,baseY);
        grd.addColorStop(0,'#eee'); grd.addColorStop(0.5,'#999'); grd.addColorStop(1,'#444');
        ctx.fillStyle=grd;
        ctx.beginPath(); ctx.moveTo(px,baseY-2); ctx.lineTo(px+4,baseY-22-((i%2)*4)); ctx.lineTo(px+8,baseY-2); ctx.fill();
      }
    } else if (c==='C'){
      // chopper frame: two posts + top beam; blade drawn separately animated
      const baseY=sy+TILE;
      ctx.fillStyle='#3d2c18'; ctx.fillRect(sx+2,baseY-64,6,64); ctx.fillRect(sx+24,baseY-64,6,64);
      ctx.fillStyle='#5a4024'; ctx.fillRect(sx-2,baseY-72,36,10);
      ctx.fillStyle='#8a6a3e'; ctx.fillRect(sx-2,baseY-72,36,3);
    }
  }
  // saws
  for (const s of S.saws){
    const sx=s.x-S.camX, sy=s.y;
    ctx.fillStyle='rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx,sy+12,18,5,0,0,7); ctx.fill();
    ctx.save(); ctx.translate(sx,sy); ctx.rotate(S.t*9*s.dir);
    ctx.fillStyle='#cfd6e4';
    for(let i=0;i<8;i++){ ctx.rotate(Math.PI/4); ctx.beginPath(); ctx.moveTo(0,-16); ctx.lineTo(5,-9); ctx.lineTo(-5,-9); ctx.fill(); }
    ctx.beginPath(); ctx.arc(0,0,10,0,7); ctx.fill();
    ctx.fillStyle='#5a6274'; ctx.beginPath(); ctx.arc(0,0,4,0,7); ctx.fill();
    ctx.restore();
  }
  // chopper blades
  for (const ch of S.chops){
    const sx=ch.x-S.camX, baseY=13*TILE+32;
    const topY=13*TILE-32, botY=13*TILE+18;
    const by=topY+(botY-topY)*ch.bladeY;
    ctx.strokeStyle='#222'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(sx,13*TILE-40); ctx.lineTo(sx,by); ctx.stroke();
    const grd=ctx.createLinearGradient(0,by-26,0,by);
    grd.addColorStop(0,'#888'); grd.addColorStop(1,'#e8ecf4');
    ctx.fillStyle=grd;
    ctx.beginPath(); ctx.moveTo(sx-14,by); ctx.lineTo(sx+14,by); ctx.lineTo(sx+9,by-26); ctx.lineTo(sx-9,by-26); ctx.fill();
    ctx.lineWidth=1;
  }
  // potions
  for (const o of S.pots){
    if (o.taken) continue;
    const sx=o.x-S.camX, sy=o.y+Math.sin(o.bob)*3;
    const gg=ctx.createRadialGradient(sx,sy,2,sx,sy,26);
    gg.addColorStop(0,o.big?'rgba(255,210,110,.5)':'rgba(255,110,110,.45)'); gg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gg; ctx.beginPath(); ctx.arc(sx,sy,26,0,7); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx,sy+10,9,3,0,0,7); ctx.fill();
    ctx.fillStyle=o.big?'#ffcf6b':'#d94f4f';
    ctx.beginPath(); ctx.moveTo(sx-7,sy+8); ctx.lineTo(sx-7,sy-2); ctx.lineTo(sx-4,sy-6); ctx.lineTo(sx-4,sy-9); ctx.lineTo(sx+4,sy-9); ctx.lineTo(sx+4,sy-6); ctx.lineTo(sx+7,sy-2); ctx.lineTo(sx+7,sy+8); ctx.quadraticCurveTo(sx,sy+13,sx-7,sy+8); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.75)'; ctx.fillRect(sx-5,sy-2,4,7);
  }
  // exit door (golden gate)
  {
    const dx=(lv.doorCol+0.5)*TILE-S.camX, gy=14*TILE;
    const glow=ctx.createRadialGradient(dx,gy-50,10,dx,gy-50,90);
    glow.addColorStop(0,'rgba(255,210,110,.45)'); glow.addColorStop(1,'rgba(255,210,110,0)');
    ctx.fillStyle=glow; ctx.fillRect(dx-90,gy-160,180,160);
    ctx.fillStyle='#2c2347'; ctx.fillRect(dx-26,gy-110,52,110);
    ctx.fillStyle='#0e0a20'; ctx.fillRect(dx-19,gy-100,38,100);
    const dg=ctx.createLinearGradient(0,gy-100,0,gy);
    dg.addColorStop(0,'rgba(255,220,130,.85)'); dg.addColorStop(1,'rgba(200,120,30,.25)');
    ctx.fillStyle=dg; ctx.fillRect(dx-19,gy-100,38,100);
    ctx.fillStyle='#ffdf8e';
    ctx.beginPath(); ctx.arc(dx,gy-110,24,Math.PI,0); ctx.fill();
    ctx.fillStyle='#7a4d12'; ctx.fillRect(dx-30,gy-112,60,8); ctx.fillRect(dx-30,gy-6,60,8);
    ctx.fillStyle='#fff'; ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
    ctx.fillText('EXIT ➤', dx, gy-118);
  }
}

function drawFighter(x,y,dir,o){
  // o: {tunic, pants, skin, turban, cape, crouch, runPhase, sword, atkT, block, hurt, hang, climb, guard}
  ctx.save(); ctx.translate(Math.round(x),Math.round(y)); ctx.scale(dir,1);
  const crouch = o.crouch?10:0;
  const runPh = o.runPhase||0;
  const moving = o.moving;
  // shadow
  ctx.fillStyle='rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(0,2,14,4,0,0,7); ctx.fill();
  ctx.translate(0,-crouch*0.4);
  const legSwing = moving? Math.sin(runPh)*9 : 0;
  // legs
  ctx.strokeStyle=o.pants; ctx.lineWidth=6; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(0,-20); ctx.lineTo(-4+legSwing*0.6,0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,-20); ctx.lineTo(4-legSwing*0.6,0); ctx.stroke();
  // torso tunic
  ctx.fillStyle=o.tunic; ctx.fillRect(-8,-42,16,24);
  ctx.fillStyle='#e8b64c'; ctx.fillRect(-8,-28,16,4); // sash
  // cape
  if (o.cape){ ctx.fillStyle=o.cape; ctx.beginPath(); ctx.moveTo(-6,-40); ctx.quadraticCurveTo(-20,-30+legSwing*0.3,-16,-8); ctx.lineTo(-8,-10); ctx.quadraticCurveTo(-10,-26,-4,-38); ctx.fill(); }
  // head
  ctx.fillStyle=o.skin; ctx.beginPath(); ctx.arc(2,-48,7,0,7); ctx.fill();
  // turban / helmet
  if (o.guard){
    ctx.fillStyle='#5a6274'; ctx.beginPath(); ctx.arc(2,-49,8,Math.PI,0); ctx.fill();
    ctx.fillRect(-6,-52,16,3);
    ctx.fillStyle='#8a93a8'; ctx.fillRect(6,-52,5,8); // nose guard
  } else {
    ctx.fillStyle='#f2ead8'; ctx.beginPath(); ctx.arc(2,-49,8,Math.PI*0.95,Math.PI*2.05); ctx.fill();
    ctx.fillStyle='#d43d3d'; ctx.beginPath(); ctx.arc(8,-54,3,0,7); ctx.fill(); // jewel
    ctx.strokeStyle='#d43d3d'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(4,-56); ctx.quadraticCurveTo(12,-62,14,-56); ctx.stroke(); // feather
  }
  // eyes
  ctx.fillStyle='#222'; ctx.fillRect(4,-49,2,2);
  // sword arm
  const atk = o.atkT>0;
  let ang = 0.3;
  if (o.block) ang=-0.5;
  if (atk){ const k=1-(o.atkT/0.28); ang = -1.4 + k*2.4; }
  if (!o.sword) ang=0.9;
  const hx = 8+Math.cos(ang)*14, hy=-32+Math.sin(ang)*14;
  ctx.strokeStyle=o.skin; ctx.lineWidth=5;
  ctx.beginPath(); ctx.moveTo(4,-34); ctx.lineTo(hx,hy); ctx.stroke();
  if (o.sword){
    ctx.save(); ctx.translate(hx,hy); ctx.rotate(ang);
    ctx.strokeStyle=o.block?'#bfe3ff':'#dfe6f2'; ctx.lineWidth=3.5;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(30,0); ctx.stroke();
    ctx.strokeStyle='#8a6a3e'; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(-2,-4); ctx.lineTo(-2,4); ctx.stroke();
    if (atk){ ctx.fillStyle='rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(30,0,10*(1-o.atkT/0.28)+4,0,7); ctx.fill(); }
    ctx.restore();
    if (o.block){ ctx.strokeStyle='rgba(160,220,255,.7)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(hx+8,hy,14,-1,1); ctx.stroke(); }
  }
  if (o.hurt){ ctx.fillStyle='rgba(255,60,60,.35)'; ctx.fillRect(-12,-58,26,60); }
  ctx.restore();
}

function render(){
  ctx.clearRect(0,0,W,H);
  const lv = LEVELS[S.levelIdx];
  let shx=0,shy=0;
  if (S.shake>0){ shx=(Math.random()-0.5)*10*S.shake*4; shy=(Math.random()-0.5)*8*S.shake*4; }
  ctx.save(); ctx.translate(shx,shy);
  drawBackground();
  ctx.save(); // world (tiles already subtract camX internally except fighters)
  drawTiles(lv);
  // fighters
  for (const g of S.guards){
    if (g.dead){
      const sx=g.x-S.camX;
      ctx.save(); ctx.translate(sx,g.y); ctx.globalAlpha=0.8; ctx.rotate(Math.PI/2*0.9);
      drawFighter(0,0,g.dir,{tunic:'#5a6274',pants:'#333',skin:'#d9a066',turban:1,guard:true,sword:false});
      ctx.restore(); continue;
    }
    drawFighter(g.x-S.camX, g.y, g.dir, {
      tunic: g.lvl===2?'#7a2030':'#4a5a7a', pants:'#2c2c3a', skin:'#d9a066', guard:true,
      moving: Math.abs(g.vx)>30, runPhase: S.t*10, sword:true, atkT:Math.max(0,g.atkT), block:g.block, hurt:g.hurtT>0
    });
    // hp pips
    const sx=g.x-S.camX;
    ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(sx-18,g.y-72,36,6);
    ctx.fillStyle='#e14b4b'; ctx.fillRect(sx-17,g.y-71,34*(g.hp/g.maxhp),4);
    if (g.block){ ctx.fillStyle='#aef'; ctx.font='bold 11px sans-serif'; ctx.textAlign='center'; ctx.fillText('BLOCK',sx,g.y-76); }
  }
  const p=S.player;
  if (p){
    if (p.hang){
      drawFighter(p.x-S.camX, p.y+34, p.hangDir, {tunic:'#f2f2f5',pants:'#2b4a8a',skin:'#e8b06a',cape:'#c62f2f',sword:false,moving:false,runPhase:0,hurt:p.hurtT>0});
      // arms up
      ctx.strokeStyle='#e8b06a'; ctx.lineWidth=5;
      const sx=p.x-S.camX;
      ctx.beginPath(); ctx.moveTo(sx,p.y+4); ctx.lineTo(sx+p.hangDir*8,p.y-8); ctx.stroke();
    } else if (p.climb){
      const sx=p.x-S.camX;
      const cyc=Math.sin(S.t*8)*4;
      drawFighter(sx, p.y+24, p.dir, {tunic:'#f2f2f5',pants:'#2b4a8a',skin:'#e8b06a',cape:'#c62f2f',sword:false,moving:true,runPhase:S.t*10,hurt:false});
    } else if (!p.dead){
      drawFighter(p.x-S.camX, p.y, p.dir, {
        tunic:'#f4f2ea', pants:'#2b4a8a', skin:'#e8b06a', cape:'#c62f2f', crouch:p.crouch,
        moving: Math.abs(p.vx)>30&&p.onGround, runPhase: S.t*(Math.abs(p.vx)/40+6),
        sword:p.sword, atkT:Math.max(0,p.atkT), block:p.block, hurt:p.hurtT>0
      });
    } else {
      const sx=p.x-S.camX;
      ctx.save(); ctx.translate(sx,p.y); ctx.rotate(-1.2); ctx.globalAlpha=0.9;
      drawFighter(0,0,1,{tunic:'#f4f2ea',pants:'#2b4a8a',skin:'#e8b06a',cape:'#c62f2f',sword:false});
      ctx.restore();
    }
    // player hp hearts above? HUD covers; draw small bar
    ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(p.x-S.camX-20,p.y-84,40,6);
    ctx.fillStyle='#57d95e'; ctx.fillRect(p.x-S.camX-19,p.y-83,38*(p.hp/p.maxhp),4);
  }
  // particles
  for (const q of S.parts){
    ctx.globalAlpha=Math.max(0,1-q.t/q.life);
    ctx.fillStyle=q.col; ctx.fillRect(q.x-S.camX-q.sz/2,q.y-q.sz/2,q.sz,q.sz);
  }
  ctx.globalAlpha=1;
  // floats
  ctx.textAlign='center'; ctx.font='bold 14px sans-serif';
  for (const f of S.floats){
    ctx.globalAlpha=Math.max(0,1-f.t/1.2);
    ctx.fillStyle='#000'; ctx.fillText(f.txt,f.x-S.camX+1,f.y+1);
    ctx.fillStyle=f.col; ctx.fillText(f.txt,f.x-S.camX,f.y);
  }
  ctx.globalAlpha=1;
  ctx.restore(); // world
  // vignette
  const v=ctx.createRadialGradient(W/2,H/2,H*0.35,W/2,H/2,H*0.85);
  v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,.5)');
  ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  if (S.flash>0){ ctx.fillStyle=`rgba(200,30,30,${S.flash*0.9})`; ctx.fillRect(0,0,W,H); }
  // running hint arrow at start
  if (S.mode==='playing' && S.levelIdx===0 && S.t<12 && S.player && S.player.x<10*TILE){
    ctx.fillStyle='#ffe9b0'; ctx.font='bold 16px sans-serif'; ctx.textAlign='center';
    ctx.fillText('RUN ➤  JUMP the gaps!', 300+Math.sin(S.t*4)*8, 200);
  }
  ctx.restore();
}

/* ---------- loop ---------- */
let last=0;
function frame(ts){
  requestAnimationFrame(frame);
  if (!last) last=ts;
  let dt=(ts-last)/1000; last=ts;
  if (dt>0.05) dt=0.05;
  if (S.mode==='playing') update(dt);
  else { S.t+=dt; updateParts(dt); }
  render();
}

/* ---------- input: keyboard ---------- */
const keyMap = { ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right', ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down', Space:'jump', KeyG:'block', KeyK:'block' };
window.addEventListener('keydown', e=>{
  if (e.code==='Enter' && S.mode!=='playing'){ const b=card.querySelector('.btn'); if(b) b.click(); return; }
  if (e.code==='KeyP'){ if(S.mode==='playing') pauseGame(); else if(S.mode==='paused'){hide();S.mode='playing';} return; }
  if (e.code==='KeyM'){ muted=!muted; toast(muted?'Muted':'Sound on'); return; }
  if (e.code==='KeyX'||e.code==='KeyL'){ swordToggleQueued=true; return; }
  if (e.code==='KeyF'||e.code==='KeyJ'){ atkQueued=true; return; }
  const k=keyMap[e.code];
  if (k){ input[k]=true; if(k==='jump') jumpQueued=true; e.preventDefault(); }
});
window.addEventListener('keyup', e=>{ const k=keyMap[e.code]; if(k) input[k]=false; });

/* ---------- input: touch buttons ---------- */
function bindHold(id, down, up){
  const el=$(id);
  const on=e=>{ e.preventDefault(); el.classList.add('on'); down(); };
  const off=e=>{ e.preventDefault(); el.classList.remove('on'); up&&up(); };
  el.addEventListener('pointerdown',on);
  el.addEventListener('pointerup',off);
  el.addEventListener('pointercancel',off);
  el.addEventListener('pointerleave',off);
  el.addEventListener('contextmenu',e=>e.preventDefault());
}
bindHold('tLeft', ()=>input.left=true, ()=>input.left=false);
bindHold('tRight', ()=>input.right=true, ()=>input.right=false);
bindHold('tUp', ()=>input.up=true, ()=>input.up=false);
bindHold('tDown', ()=>input.down=true, ()=>input.down=false);
bindHold('tJump', ()=>{input.jump=true;jumpQueued=true;}, ()=>input.jump=false);
bindHold('tAtk', ()=>atkQueued=true, ()=>{});
bindHold('tBlock', ()=>input.block=true, ()=>input.block=false);
$('tSword').addEventListener('pointerdown', e=>{ e.preventDefault(); swordToggleQueued=true; $('tSword').classList.add('on'); setTimeout(()=>$('tSword').classList.remove('on'),150); });
// tap canvas = attack (convenient on tablets)
canvas.addEventListener('pointerdown', e=>{ if(S.mode==='playing') atkQueued=true; });
// first interaction unlocks audio
window.addEventListener('pointerdown', ()=>{ try{ AC=AC||new (window.AudioContext||window.webkitAudioContext)(); AC.resume(); }catch(e){} }, {passive:true});
document.addEventListener('visibilitychange', ()=>{ if(document.hidden && S.mode==='playing') pauseGame(); });

/* ---------- boot ---------- */
loadLevel(0,false);
showTitle();
updateHUD();
requestAnimationFrame(frame);
