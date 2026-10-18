// Nano Ball - sunucu mantığı (hesaplar, arkadaşlar, odalar, maç aktarımı)
const fs = require('fs');

function attach(io, opts = {}) {
  const file = opts.file;
  let DB = { users: {}, tokens: {} };
  try { if (file) DB = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  DB.users = DB.users || {}; DB.tokens = DB.tokens || {};
  let dirty = false; const mark = () => { dirty = true; };
  if (file) setInterval(() => { if (dirty) { dirty = false; try { fs.writeFileSync(file, JSON.stringify(DB)); } catch (e) {} } }, 5000).unref();

  const sockOf = {}, rooms = {}, usedRoom = new Set();
  const rid = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4);
  const hex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
  const cstr = (s, m) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, m);
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v)) || 0));
  const cj = j => { if (!j || typeof j !== 'object') return null; const a = hex(j.c1); if (!a) return null; const o = { c1: a }; const b = hex(j.c2); if (b) o.c2 = b; return o; };
  const cn = n => n && typeof n === 'object' ? { col: hex(n.col) || '#ffffff', out: !!n.out, oc: hex(n.oc) || '#000000' } : null;
  const rm = (a, x) => { const i = a.indexOf(x); if (i >= 0) a.splice(i, 1); };
  const add = (a, x) => { if (!a.includes(x)) a.push(x); };

  function newCode() {
    const used = new Set(Object.values(DB.users).map(u => u.code).filter(Boolean));
    if (used.size >= 10000) return '';
    let c; do { c = '#' + String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (used.has(c));
    return c;
  }
  function newUser(token) {
    const id = rid();
    const u = { id, token, name: '', code: '', sp: false, ss: false,
      jy: { us: { c1: '#3b82f6' }, rv: { c1: '#ef4444' } },
      nm: { us: { col: '#ffffff', out: true, oc: '#000000' }, rv: { col: '#ffffff', out: true, oc: '#000000' } },
      tn: { us: 'Mavi', rv: 'Kırmızı' }, myNum: 9,
      pf: { m: 0, min: 0, w: 0, l: 0, d: 0, streak: 0, g: 0, a: 0, mom: 0, rs: 0, rn: 0 },
      friends: [], sent: [], recv: [], blocked: [], room: null };
    DB.users[id] = u; DB.tokens[token] = id; mark(); return u;
  }
  function applyProfile(u, p) {
    if (!p || typeof p !== 'object') return;
    const name = cstr(p.name, 14);
    if (name && name !== u.name) { u.name = name; if (!u.code) u.code = newCode(); }
    if (p.jy) { const a = cj(p.jy.us), b = cj(p.jy.rv); if (a && b) u.jy = { us: a, rv: b }; }
    if (p.nm) { const a = cn(p.nm.us), b = cn(p.nm.rv); if (a && b) u.nm = { us: a, rv: b }; }
    if (p.tn) u.tn = { us: cstr(p.tn.us, 12) || 'Mavi', rv: cstr(p.tn.rv, 12) || 'Kırmızı' };
    if (p.myNum !== undefined) u.myNum = num(p.myNum, 0, 99);
    if (p.sp !== undefined) u.sp = !!p.sp;
    if (p.ss !== undefined) u.ss = !!p.ss;
    if (p.pf && typeof p.pf === 'object') { const f = {}; for (const k of ['m', 'min', 'w', 'l', 'd', 'streak', 'g', 'a', 'mom', 'rs', 'rn']) f[k] = Math.max(0, Number(p.pf[k]) || 0); u.pf = f; }
    mark();
  }
  const byCode = c => Object.values(DB.users).find(u => u.code && u.code === c);
  const normCode = q => { const m = String(q || '').trim().match(/^#?(\d{4})$/); return m ? '#' + m[1] : null; };
  function find(q) {
    const c = normCode(q); if (c) return { u: byCode(c) };
    const n = cstr(q, 14).toLowerCase(); if (!n) return {};
    const l = Object.values(DB.users).filter(u => u.code && u.name.toLowerCase() === n);
    return l.length > 1 ? { multi: true } : { u: l[0] };
  }
  const brief = u => ({ code: u.code, name: u.name, online: !!sockOf[u.id], jy: u.jy && u.jy.us });
  const ofIds = ids => ids.map(i => DB.users[i]).filter(Boolean).map(brief);
  const lists = u => ({ ok: true, friends: ofIds(u.friends), sent: ofIds(u.sent), recv: ofIds(u.recv) });
  const emitTo = (id, ev, d) => { const s = sockOf[id]; if (s) s.emit(ev, d); };
  const tell = id => emitTo(id, 'fr:update', {});

  // ---------- odalar ----------
  const MAXP = 14, ORDER = [6, 4, 5, 3, 1, 2, 0];
  const rcode = () => { let c; do { c = String(10000 + Math.floor(Math.random() * 90000)); } while (rooms[c] || usedRoom.has(c)); return c; };
  const count = (r, t) => Object.values(r.pl).filter(p => p.team === t).length;
  function rstate(r) {
    const host = DB.users[r.host];
    return { code: r.code, host: host.code, phase: r.phase, dur: r.dur, pickMs: Math.max(0, r.pickEnd - Date.now()),
      cfg: { jy: host.jy, nm: host.nm, tn: host.tn },
      players: Object.keys(r.pl).map(id => { const u = DB.users[id], p = r.pl[id]; return { code: u.code, name: u.name, team: p.team, ready: p.ready, pos: p.pos, num: u.myNum }; }) };
  }
  function bcast(r) { const s = rstate(r); for (const id of Object.keys(r.pl)) emitTo(id, 'room:state', s); }
  function closeRoom(r) { clearTimeout(r.timer); usedRoom.add(r.code); delete rooms[r.code]; }
  function checkReady(r) {
    const ids = Object.keys(r.pl);
    if (r.phase === 'lobby' && ids.length && ids.every(i => r.pl[i].ready)) {
      r.phase = 'pick'; r.pickEnd = Date.now() + 30000;
      for (const i of ids) r.pl[i].pos = null;
      r.timer = setTimeout(() => finishPick(r), 30000);
    }
  }
  function finishPick(r) {
    if (r.phase !== 'pick') return;
    clearTimeout(r.timer);
    for (const t of [0, 1]) for (const id of Object.keys(r.pl)) {
      const p = r.pl[id]; if (p.team !== t || p.pos != null) continue;
      const free = ORDER.find(x => !Object.values(r.pl).some(q => q.team === t && q.pos === x));
      p.pos = free;
    }
    r.phase = 'play';
    const host = DB.users[r.host];
    const assign = Object.keys(r.pl).map(id => { const u = DB.users[id], p = r.pl[id]; return { code: u.code, name: u.name, team: p.team, pos: p.pos, num: u.myNum, sp: u.sp, ss: u.ss }; });
    const msg = { assign, cfg: { jy: host.jy, nm: host.nm, tn: host.tn }, dur: r.dur, host: host.code };
    for (const id of Object.keys(r.pl)) emitTo(id, 'match:start', msg);
    bcast(r);
  }
  function leaveRoom(u) {
    const r = u.room && rooms[u.room]; u.room = null; if (!r) return;
    delete r.pl[u.id];
    if (r.host === u.id) {
      for (const id of Object.keys(r.pl)) { DB.users[id].room = null; emitTo(id, 'room:closed', {}); }
      closeRoom(r);
    } else {
      if (r.phase === 'play') emitTo(r.host, 'peer:left', { code: u.code });
      if (!Object.keys(r.pl).length) closeRoom(r);
      else { if (r.phase === 'lobby') checkReady(r); else if (r.phase === 'pick') { if (Object.values(r.pl).every(p => p.pos != null)) finishPick(r); } bcast(r); }
    }
  }
  const cl = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  const sanI = I => ({ x: cl(I.x, -2, 2), y: cl(I.y, -2, 2), k: I.k ? 1 : 0, p: I.p ? 1 : 0, ks: cl(I.ks, 0, 1), kx: cl(I.kx, -1, 1), kh: cl(I.kh, -1, 1), ps: cl(I.ps, 0, 1), px: cl(I.px, -1, 1), sh: I.sh ? 1 : 0 });

  io.on('connection', socket => {
    const U = () => DB.users[socket.uid];
    const on = (ev, fn) => socket.on(ev, (d, ack) => {
      ack = typeof ack === 'function' ? ack : () => {};
      try { if (ev !== 'hello' && !socket.uid) return ack({ ok: false, msg: 'Önce bağlan' }); fn(d || {}, ack); }
      catch (e) { console.error(ev, e); try { ack({ ok: false, msg: 'Sunucu hatası' }); } catch (_) {} }
    });

    on('hello', (d, ack) => {
      const token = typeof d.token === 'string' ? d.token : '';
      if (token.length < 12) return ack({ ok: false, msg: 'Geçersiz oturum' });
      let u = DB.users[DB.tokens[token]] || newUser(token);
      socket.uid = u.id; sockOf[u.id] = socket;
      applyProfile(u, d.profile);
      for (const f of u.friends) tell(f);
      ack({ ok: true, me: { name: u.name, code: u.code }, lists: lists(u) });
    });
    on('profile', (d, ack) => { const u = U(); applyProfile(u, d); ack({ ok: true, name: u.name, code: u.code }); });

    // ----- arkadaşlar -----
    on('fr:list', (d, ack) => ack(lists(U())));
    on('fr:add', (d, ack) => {
      const me = U(); if (!me.code) return ack({ ok: false, msg: 'Önce profilde isim belirle' });
      const r = find(d.q); if (r.multi) return ack({ ok: false, msg: 'Aynı isimde birden fazla kişi var, #kodu yaz' });
      const t = r.u; if (!t) return ack({ ok: false, msg: 'Kullanıcı bulunamadı' });
      if (t.id === me.id) return ack({ ok: false, msg: 'Kendini ekleyemezsin' });
      if (t.blocked.includes(me.id)) return ack({ ok: false, msg: 'İstek gönderilemedi' });
      if (me.blocked.includes(t.id)) return ack({ ok: false, msg: 'Bu kişiyi engelledin' });
      if (me.friends.includes(t.id)) return ack({ ok: false, msg: 'Zaten arkadaşsınız' });
      if (me.sent.includes(t.id)) return ack({ ok: false, msg: 'İstek zaten gönderildi' });
      if (me.recv.includes(t.id)) { rm(me.recv, t.id); rm(t.sent, me.id); add(me.friends, t.id); add(t.friends, me.id); mark(); tell(t.id); return ack({ ok: true, msg: 'Arkadaş eklendi' }); }
      add(me.sent, t.id); add(t.recv, me.id); mark(); tell(t.id); ack({ ok: true, msg: 'İstek gönderildi' });
    });
    const other = d => byCode(normCode(d.code));
    on('fr:accept', (d, ack) => { const me = U(), t = other(d); if (!t || !me.recv.includes(t.id)) return ack({ ok: false, msg: 'İstek bulunamadı' }); rm(me.recv, t.id); rm(t.sent, me.id); add(me.friends, t.id); add(t.friends, me.id); mark(); tell(t.id); ack({ ok: true, msg: 'Arkadaş eklendi' }); });
    on('fr:reject', (d, ack) => { const me = U(), t = other(d); if (!t) return ack({ ok: false }); rm(me.recv, t.id); rm(t.sent, me.id); mark(); tell(t.id); ack({ ok: true, msg: 'İstek reddedildi' }); });
    on('fr:cancel', (d, ack) => { const me = U(), t = other(d); if (!t) return ack({ ok: false }); rm(me.sent, t.id); rm(t.recv, me.id); mark(); tell(t.id); ack({ ok: true, msg: 'İstek iptal edildi' }); });
    on('fr:remove', (d, ack) => { const me = U(), t = other(d); if (!t) return ack({ ok: false }); rm(me.friends, t.id); rm(t.friends, me.id); mark(); tell(t.id); ack({ ok: true, msg: 'Arkadaşlıktan çıkarıldı' }); });
    on('fr:block', (d, ack) => {
      const me = U(), t = other(d); if (!t) return ack({ ok: false });
      for (const [a, b] of [[me, t], [t, me]]) { rm(a.friends, b.id); rm(a.sent, b.id); rm(a.recv, b.id); }
      add(me.blocked, t.id); mark(); tell(t.id); ack({ ok: true, msg: 'Engellendi' });
    });
    on('fr:profile', (d, ack) => {
      const me = U(), t = other(d); if (!t || !me.friends.includes(t.id)) return ack({ ok: false, msg: 'Profil bulunamadı' });
      ack({ ok: true, p: { name: t.name, code: t.code, jy: t.jy, nm: t.nm, tn: t.tn, myNum: t.myNum, pf: t.pf, online: !!sockOf[t.id] } });
    });

    // ----- odalar -----
    on('room:create', (d, ack) => {
      const u = U(); if (!u.code) return ack({ ok: false, msg: 'Önce profilde isim belirle' });
      leaveRoom(u);
      const code = rcode();
      const r = { code, host: u.id, pl: {}, dur: [60, 120, 180, 300].includes(d.dur) ? d.dur : 180, phase: 'lobby', pickEnd: 0, timer: null };
      r.pl[u.id] = { team: 0, ready: false, pos: null }; rooms[code] = r; u.room = code;
      bcast(r); ack({ ok: true, code });
    });
    on('room:join', (d, ack) => {
      const u = U(); if (!u.code) return ack({ ok: false, msg: 'Önce profilde isim belirle' });
      const code = String(d.code || '').replace(/\D/g, ''), r = rooms[code];
      if (!r) return ack({ ok: false, msg: 'Oda bulunamadı' });
      if (u.room === code) return ack({ ok: true, code });
      if (r.phase !== 'lobby') return ack({ ok: false, msg: 'Bu odada maç başlamış' });
      if (Object.keys(r.pl).length >= MAXP) return ack({ ok: false, msg: 'Oda dolu' });
      if (DB.users[r.host].blocked.includes(u.id)) return ack({ ok: false, msg: 'Odaya girilemedi' });
      leaveRoom(u);
      let team = count(r, 0) <= count(r, 1) ? 0 : 1; if (count(r, team) >= 7) team = 1 - team;
      r.pl[u.id] = { team, ready: false, pos: null }; u.room = code; bcast(r); ack({ ok: true, code });
    });
    const myRoom = () => { const u = U(); return u && u.room && rooms[u.room]; };
    on('room:team', (d, ack) => {
      const r = myRoom(), u = U(); if (!r || r.host !== u.id || r.phase !== 'lobby') return ack({ ok: false });
      const t = byCode(d.code), team = d.team === 1 ? 1 : 0;
      if (!t || !r.pl[t.id] || r.pl[t.id].team === team) return ack({ ok: false });
      if (count(r, team) >= 7) return ack({ ok: false, msg: 'Takım dolu (7 kişi)' });
      r.pl[t.id].team = team; for (const id of Object.keys(r.pl)) r.pl[id].ready = false;
      bcast(r); ack({ ok: true });
    });
    on('room:dur', (d, ack) => { const r = myRoom(), u = U(); if (!r || r.host !== u.id || r.phase !== 'lobby' || ![60, 120, 180, 300].includes(d.dur)) return ack({ ok: false }); r.dur = d.dur; bcast(r); ack({ ok: true }); });
    on('room:ready', (d, ack) => {
      const r = myRoom(), u = U(); if (!r || r.phase !== 'lobby') return ack({ ok: false });
      r.pl[u.id].ready = !!d.ready; checkReady(r); bcast(r); ack({ ok: true });
    });
    on('room:pick', (d, ack) => {
      const r = myRoom(), u = U(); if (!r || r.phase !== 'pick') return ack({ ok: false });
      const pos = Math.floor(Number(d.pos)); if (!(pos >= 0 && pos <= 6)) return ack({ ok: false });
      const me = r.pl[u.id];
      if (Object.values(r.pl).some(p => p !== me && p.team === me.team && p.pos === pos)) return ack({ ok: false, msg: 'Mevki dolu' });
      me.pos = pos; ack({ ok: true });
      if (Object.values(r.pl).every(p => p.pos != null)) finishPick(r); else bcast(r);
    });
    on('room:leave', (d, ack) => { leaveRoom(U()); ack({ ok: true }); });
    on('room:invite', (d, ack) => {
      const r = myRoom(), u = U(); if (!r || r.host !== u.id || r.phase !== 'lobby') return ack({ ok: false });
      let n = 0;
      for (const c of Array.isArray(d.codes) ? d.codes.slice(0, 14) : []) {
        const t = byCode(normCode(c)); if (!t || !u.friends.includes(t.id) || !sockOf[t.id] || r.pl[t.id]) continue;
        emitTo(t.id, 'invite', { room: r.code, from: { name: u.name, code: u.code } }); n++;
      }
      ack({ ok: true, n });
    });

    // ----- canlı maç: ev sahibi simülasyonu çalıştırır -----
    socket.on('snap', s => {
      const r = myRoom(), u = U(); if (!r || r.host !== u.id || r.phase !== 'play') return;
      for (const id of Object.keys(r.pl)) if (id !== u.id) { const so = sockOf[id]; if (so) (so.volatile || so).emit('snap', s); }
    });
    socket.on('in', I => {
      const r = myRoom(), u = U(); if (!r || r.phase !== 'play' || r.host === u.id || !I || typeof I !== 'object') return;
      emitTo(r.host, 'in', { code: u.code, I: sanI(I) });
    });
    socket.on('m:end', res => {
      const r = myRoom(), u = U(); if (!r || r.host !== u.id || r.phase !== 'play') return;
      for (const id of Object.keys(r.pl)) if (id !== u.id) emitTo(id, 'm:end', res);
      r.phase = 'lobby'; for (const id of Object.keys(r.pl)) { r.pl[id].ready = false; r.pl[id].pos = null; }
      bcast(r);
    });

    socket.on('disconnect', () => {
      const u = U(); if (!u) return;
      if (sockOf[u.id] === socket) { delete sockOf[u.id]; leaveRoom(u); for (const f of u.friends) tell(f); }
    });
  });
  return { DB, rooms, sockOf };
}
module.exports = { attach };
