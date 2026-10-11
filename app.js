/* ByeBoer — offline beekeeping app: hives, harvests, quotes, invoices and money.
 * Everything is stored on this device only (IndexedDB in the browser). Nothing is uploaded.
 * Excel and PDF files (reports, quotes, invoices) are built on the device by export.js.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var I18N = window.BB_I18N;
  var FX = window.FX;
  var app = document.getElementById('app');

  var D = null;          // all data
  var TAB = 'home';      // current main tab
  var V = 'home';        // current view (a tab, or a sub view)
  var F = null;          // state for the current form / sub view
  var LS = { money: { ym: null, dir: 'all' }, fuel: { ym: null }, diary: { n: 20, q: '' }, docs: { n: 15, f: 'all' }, harvest: { n: 10 }, hist: { n: 20 } };
  var confirmKey = '';   // "tap again" confirmations

  /* ================================================================ */
  /* Lists and categories                                              */
  /* ================================================================ */
  var CATS = {
    'in': [{ k: 'honey' }, { k: 'wax' }, { k: 'colonies' }, { k: 'queens' }, { k: 'pollination' }, { k: 'services_in' },
           { k: 'products' }, { k: 'training' }, { k: 'grants' }, { k: 'interest_in' }, { k: 'other_in' }],
    out: [{ k: 'equipment' }, { k: 'foundation' }, { k: 'feed' }, { k: 'meds' }, { k: 'gear' }, { k: 'packaging' }, { k: 'bees_buy' },
          { k: 'transport' }, { k: 'site_rent' }, { k: 'repairs' }, { k: 'wages' }, { k: 'power' }, { k: 'insurance' }, { k: 'fees' },
          { k: 'marketing' }, { k: 'bank' }, { k: 'admin' }, { k: 'other_out' }]
  };
  var NO_VAT_DEFAULT = { wages: 1, bank: 1, insurance: 1, grants: 1, interest_in: 1, fees: 1 };
  var TAGS = ['weather', 'hives', 'harvest', 'swarms', 'flowering', 'clients', 'repairs', 'other'];
  var AP_KINDS = ['home', 'outyard', 'pollination', 'other'];
  var HIVE_TYPES = ['lang', 'topbar', 'nuc', 'catch', 'other'];
  var HIVE_SRC = ['swarm', 'removal', 'split', 'bought', 'other'];
  var HIVE_STATUS = ['active', 'dead', 'absconded', 'merged', 'sold'];
  var PROBS = ['afb', 'varroa', 'shb', 'waxmoth', 'queenless', 'qcells', 'laying', 'robbing', 'ants', 'badger', 'theft'];
  var BAD_PROBS = { afb: 1, queenless: 1, laying: 1, badger: 1, theft: 1 };
  var CARE_TYPES = ['feed', 'treat', 'super', 'requeen', 'split', 'move', 'other'];
  var PAY_METHODS = ['eft', 'cash', 'card', 'other'];
  var Q_STATUS = ['draft', 'sent', 'accepted', 'declined'];

  /* ================================================================ */
  /* Language                                                          */
  /* ================================================================ */
  function L() { return (D && D.settings.lang) || 'en'; }
  function t(key, vars) {
    var s = (I18N[L()] || I18N.en)[key];
    if (s == null) s = I18N.en[key];
    if (s == null) s = key;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return s;
  }
  function catLabel(k) { return !k ? '' : k.indexOf('c:') === 0 ? k.slice(2) : t('cat_' + k); }

  /* ================================================================ */
  /* Storage (IndexedDB, with localStorage fallback)                   */
  /* ================================================================ */
  var DB_NAME = 'byeboer', STORE = 'kv', PHOTOS = 'photos', LS_KEY = 'byeboer.data', useLS = false, dbp = null;
  function getDB() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no indexedDB'));
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS);
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function loadData() {
    return getDB().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction(STORE, 'readonly').objectStore(STORE).get('data');
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
    }).catch(function () {
      useLS = true;
      try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; }
    });
  }
  function save() {
    var copy = JSON.parse(JSON.stringify(D));
    if (useLS) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(copy)); return Promise.resolve(true); }
      catch (e) { toast(t('err_save') + ' ' + e.message); return Promise.resolve(false); }
    }
    return getDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(copy, 'data');
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function (e) { toast(t('err_save') + ' ' + (e && e.message || '')); return false; });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  /* Slip photos: kept in their own store, the records only hold the photo id */
  function photoTx(mode, fn) {
    return getDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(PHOTOS, mode), st = tx.objectStore(PHOTOS), out;
        var q = fn(st);
        if (q) q.onsuccess = function () { out = q.result; };
        tx.oncomplete = function () { res(out); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function photoPut(id, blob) { return photoTx('readwrite', function (st) { st.put(blob, id); }); }
  function photoGet(id) { return photoTx('readonly', function (st) { return st.get(id); }); }
  function photoDel(id) { return id ? photoTx('readwrite', function (st) { st.delete(id); }).catch(function () {}) : Promise.resolve(); }
  function photoClear() { return photoTx('readwrite', function (st) { st.clear(); }).catch(function () {}); }
  function photoAll() {
    return getDB().then(function (db) {
      return new Promise(function (res, rej) {
        var out = {}, tx = db.transaction(PHOTOS, 'readonly'), q = tx.objectStore(PHOTOS).openCursor();
        q.onsuccess = function () { var c = q.result; if (c) { out[c.key] = c.value; c.continue(); } };
        tx.oncomplete = function () { res(out); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  var photoUrls = {};   // id -> object URL (cache for showing thumbnails)
  function photoUrl(id) {
    if (photoUrls[id]) return Promise.resolve(photoUrls[id]);
    return photoGet(id).then(function (b) { if (!b) return null; photoUrls[id] = URL.createObjectURL(b); return photoUrls[id]; });
  }
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('photo')); };
      img.src = url;
    });
  }
  // Shrink a camera photo to max 1600 px JPEG (~150-350 KB) so the phone doesn't fill up
  function shrinkPhoto(file) {
    return loadImage(file).then(function (img) {
      var max = 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return new Promise(function (resolve, reject) { c.toBlob(function (b) { b ? resolve(b) : reject(new Error('photo')); }, 'image/jpeg', 0.72); });
    });
  }
  // Logo: max 700 x 350 px, on a white background, as a JPEG data URL (works in the PDF too)
  function makeLogo(file) {
    return loadImage(file).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 700 / w, 350 / h);
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      var g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return { url: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height };
    });
  }

  function blank() {
    var lang = /^af/i.test(navigator.language || '') ? 'af' : 'en';
    return {
      app: 'ByeBoer', v: 1,
      settings: { setup: false, lang: lang, biz: '', owner: '', phone: '', email: '', addr: '', regNo: '', regDue: '',
                  vat: false, vatRate: 15, vatNo: '', yearEnd: 2,
                  logo: '', logoW: 0, logoH: 0,
                  bankName: '', bankHolder: '', bankAcc: '', bankBranch: '', bankType: '',
                  qPrefix: 'Q-', iPrefix: 'INV-', nextQ: 1, nextI: 1, payDays: 7, quoteDays: 30, deposit: 0, terms: '',
                  fuelOn: false, travelDefault: false, kmRate: 0,
                  remind: true, remindTime: '18:00', cats: { 'in': [], out: [] }, svcs: [], lastBackup: '' },
      money: [], fuel: [], diary: [], recur: [],
      apiaries: [], hives: [], insp: [], harvests: [], care: [],
      clients: [], docs: []
    };
  }
  var LISTS = ['money', 'fuel', 'diary', 'recur', 'apiaries', 'hives', 'insp', 'harvests', 'care', 'clients', 'docs'];
  var COLL = { money: 'money', fuel: 'fuel', diary: 'diary', recur: 'recur', apiary: 'apiaries', hive: 'hives', insp: 'insp',
               harvest: 'harvests', care: 'care', client: 'clients', doc: 'docs' };
  function normalise(d) {
    var b = blank();
    if (!d || typeof d !== 'object') return b;
    d.settings = Object.assign(b.settings, d.settings || {});
    if (!d.settings.cats || !d.settings.cats.out) d.settings.cats = { 'in': [], out: [] };
    if (!Array.isArray(d.settings.svcs)) d.settings.svcs = [];
    LISTS.forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    d.app = 'ByeBoer'; d.v = 1;
    return d;
  }

  /* ================================================================ */
  /* Helpers                                                           */
  /* ================================================================ */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return dateStr(new Date()); }
  function parseD(s) { var p = String(s || '').split('-'); return new Date(+p[0], +p[1] - 1, +(p[2] || 1)); }
  function addMonths(ym, n) { var d = parseD(ym + '-01'); d.setMonth(d.getMonth() + n); return dateStr(d).slice(0, 7); }
  function addDays(d, n) { var x = parseD(d); x.setDate(x.getDate() + n); return dateStr(x); }
  function daysBetween(a, b) { return Math.round((parseD(b) - parseD(a)) / 864e5); }
  function monthName(m, short) { return t(short ? 'mon' : 'months').split(',')[m - 1]; }
  function ymLabel(ym) { var p = ym.split('-'); return monthName(+p[1]) + ' ' + p[0]; }
  function niceDate(s, noYear) {
    if (!s) return '';
    var d = parseD(s);
    return t('days').split(',')[d.getDay()] + ' ' + d.getDate() + ' ' + monthName(d.getMonth() + 1, true) + (noYear ? '' : ' ' + d.getFullYear());
  }
  function shortDate(s) { if (!s) return ''; var d = parseD(s); return d.getDate() + ' ' + monthName(d.getMonth() + 1, true) + ' ' + d.getFullYear(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) {
    var s = String(v == null ? '' : v).replace(/[\s R]/gi, '');
    if (!s) return NaN;
    if (s.indexOf(',') > -1 && s.indexOf('.') > -1) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    return /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
  }
  function r2(n) { return Math.round(n * 100) / 100; }
  function fmtNum(n, dec) {
    n = Number(n) || 0;
    var neg = n < 0, s = Math.abs(n).toFixed(dec).split('.');
    var i = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '-' : '') + i + (dec ? (L() === 'af' ? ',' : '.') + s[1] : '');
  }
  function fmtR(n) { n = Number(n) || 0; return (n < 0 ? '-' : '') + 'R ' + fmtNum(Math.abs(n), 2); }
  function fmtL(n) { return fmtNum(n, n % 1 ? 1 : 0) + ' L'; }
  function fmtKg(n) { return fmtNum(n, n % 1 ? 1 : 0) + ' kg'; }
  function fmtQ(n) { return fmtNum(n, n % 1 ? (n * 10 % 1 ? 2 : 1) : 0); }
  function numIn(n) { return n == null || n === '' || isNaN(n) ? '' : (L() === 'af' ? String(n).replace('.', ',') : String(n)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clean(s, max) { return String(s == null ? '' : s).replace(/[ \t]+/g, ' ').trim().slice(0, max || 200); }
  function cleanMulti(s, max) { return String(s == null ? '' : s).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max || 500); }
  function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }
  function byDateDesc(a, b) { return (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0); }
  function byDateAsc(a, b) { return -byDateDesc(a, b); }
  function byName(a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }
  function uniq(list, max) {
    var seen = {}, out = [];
    list.forEach(function (x) {
      var s = String(x || '').trim(), k = s.toLowerCase();
      if (s && !seen[k] && out.length < max) { seen[k] = 1; out.push(s); }
    });
    return out;
  }
  function catsFor(dir, keep) {
    var list = CATS[dir].map(function (c) { return c.k; });
    (D.settings.cats[dir] || []).forEach(function (n) { list.push('c:' + n); });
    if (keep && list.indexOf(keep) < 0) list.push(keep);
    return list;
  }
  function vatRate() { return Number(D.settings.vatRate) || 15; }
  function vatOf(amt, incl) { var r = vatRate(); return incl ? r2(amt * r / (100 + r)) : 0; }

  var toastT;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 2800);
  }

  /* Periods ------------------------------------------------------------ */
  function taxYear(offset) {
    var m = Number(D.settings.yearEnd) || 2, now = new Date();
    var endY = (now.getMonth() + 1 <= m ? now.getFullYear() : now.getFullYear() + 1) + (offset || 0);
    var start = new Date(endY - 1, m, 1), end = new Date(endY, m, 0);
    return [dateStr(start), dateStr(end)];
  }
  function presets() {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    var ty = taxYear(0), ly = taxYear(-1);
    return [
      ['p_this_month', dateStr(new Date(y, m, 1)), dateStr(new Date(y, m + 1, 0))],
      ['p_last_month', dateStr(new Date(y, m - 1, 1)), dateStr(new Date(y, m, 0))],
      ['p_this_tax', ty[0], ty[1]],
      ['p_last_tax', ly[0], ly[1]],
      ['p_last12', dateStr(new Date(y, m - 11, 1)), dateStr(new Date(y, m + 1, 0))],
      ['p_all', '', '']
    ];
  }
  function periodText(from, to) {
    if (!from && !to) return t('p_all');
    return (from ? shortDate(from) : '…') + ' – ' + (to ? shortDate(to) : '…');
  }

  /* Look-ups ------------------------------------------------------------ */
  function find(coll, id) { return id ? D[coll].filter(function (x) { return x.id === id; })[0] : null; }
  function apName(id) { var a = find('apiaries', id); return a ? a.name : ''; }
  function hiveLabel(h) { return h ? t('hive_n', { n: h.no }) : ''; }
  function hiveName(id) { return hiveLabel(find('hives', id)); }
  function clientName(id) { var c = find('clients', id); return c ? c.name : ''; }
  function activeHives(ap) { return D.hives.filter(function (h) { return h.status === 'active' && (!ap || h.ap === ap); }); }
  function apOpts(none) {
    var o = D.apiaries.slice().sort(byName).map(function (a) { return [a.id, a.name]; });
    return none ? [['', none]].concat(o) : o;
  }
  function hiveSort(a, b) { return String(a.no).localeCompare(String(b.no), undefined, { numeric: true }); }
  function hiveOpts(ap, none, keep) {
    var o = D.hives.filter(function (h) { return (h.status === 'active' || h.id === keep) && (!ap || h.ap === ap); }).sort(hiveSort)
      .map(function (h) { return [h.id, hiveLabel(h) + (ap ? '' : ' · ' + apName(h.ap))]; });
    return none ? [['', none]].concat(o) : o;
  }
  function lastInsp(hid) { return D.insp.filter(function (x) { return x.hive === hid; }).sort(byDateDesc)[0]; }
  function hiveState(h) {
    var li = lastInsp(h.id), tdy = today();
    if (h.status !== 'active') return { cls: '', text: t('hs_' + h.status), li: li };
    if (!li) return { cls: 'wait', text: t('not_inspected'), li: li };
    var bad = (li.probs || []).filter(function (p) { return BAD_PROBS[p]; });
    if (bad.length) return { cls: 'bad', text: bad.map(function (p) { return t('pr_' + p); }).join(', '), li: li };
    if (li.stores === 'low') return { cls: 'bad', text: t('st_low'), li: li };
    var age = daysBetween(li.date, tdy);
    if ((li.next && li.next <= tdy) || age > 35) return { cls: 'wait', text: t('insp_days_ago', { n: age }), li: li };
    return { cls: 'ok', text: (li.probs || []).length ? li.probs.map(function (p) { return t('pr_' + p); }).join(', ') : t('insp_days_ago', { n: age }), li: li };
  }
  // Inspections / care with a "next" date that has not been followed up yet
  function dueList(days) {
    var lim = addDays(today(), days == null ? 7 : days), out = [];
    D.insp.forEach(function (x) {
      if (!x.next || x.next > lim) return;
      var h = find('hives', x.hive);
      if (!h || h.status !== 'active') return;
      if (D.insp.some(function (o) { return o !== x && o.hive === x.hive && o.date > x.date; })) return;
      out.push({ k: 'insp', x: x, date: x.next });
    });
    D.care.forEach(function (x) {
      if (!x.next || x.next > lim) return;
      var p = String(x.product || '').toLowerCase();
      if (D.care.some(function (o) { return o !== x && o.type === x.type && o.ap === x.ap && o.hive === x.hive && String(o.product || '').toLowerCase() === p && o.date > x.date; })) return;
      out.push({ k: 'care', x: x, date: x.next });
    });
    return out.sort(function (a, b) { return a.date.localeCompare(b.date); });
  }
  function afbHives() {
    return activeHives().filter(function (h) { var li = lastInsp(h.id); return li && (li.probs || []).indexOf('afb') > -1; });
  }

  /* Quotes & invoices -------------------------------------------------- */
  function lineSum(lines) { return (lines || []).reduce(function (s, l) { return s + r2((Number(l.q) || 0) * (Number(l.p) || 0)); }, 0); }
  function docTotals(d) {
    var sub = r2(lineSum(d.lines) + (d.travel ? r2((Number(d.travel.km) || 0) * (Number(d.travel.rate) || 0)) : 0));
    var vat = d.vat ? r2(sub * (Number(d.vatRate) || 15) / 100) : 0, total = r2(sub + vat);
    var paid = r2((d.pays || []).reduce(function (s, p) { return s + p.amt; }, 0));
    return { sub: sub, vat: vat, total: total, paid: paid, bal: r2(total - paid) };
  }
  function docStatus(d) {
    if (d.type === 'q') return d.status || 'draft';
    var x = docTotals(d);
    if (x.total > 0 && x.bal <= 0.005) return 'paid';
    if (d.due && d.due < today()) return 'overdue';
    if (x.paid > 0) return 'part';
    return d.status === 'draft' ? 'draft' : 'unpaid';
  }
  var STATUS_CLS = { draft: '', sent: 'blue', accepted: 'ok', declined: 'bad', paid: 'ok', part: 'wait', unpaid: 'wait', overdue: 'bad' };
  function statusPill(d) { var s = docStatus(d); return '<span class="pill ' + (STATUS_CLS[s] || '') + '">' + esc(t('ds_' + s)) + '</span>'; }
  function docTitle(d) { return d.type === 'q' ? t('quote') : (d.vat ? t('tax_invoice') : t('invoice')); }
  function owing() { return D.docs.filter(function (d) { return d.type === 'i' && docTotals(d).bal > 0.005; }); }
  function openQuotes() { return D.docs.filter(function (d) { return d.type === 'q' && (d.status === 'sent' || d.status === 'draft' || !d.status); }); }
  function nextNo(type) {
    var s = D.settings, n = type === 'q' ? s.nextQ : s.nextI, pre = type === 'q' ? s.qPrefix : s.iPrefix, no;
    var used = {}; D.docs.forEach(function (d) { used[d.no] = 1; });
    do { no = pre + ('000' + n).slice(-Math.max(4, String(n).length)); n++; } while (used[no]);
    if (type === 'q') s.nextQ = n; else s.nextI = n;
    return no;
  }

  /* Totals for a period ------------------------------------------------ */
  function summary(from, to) {
    var s = { inT: 0, outT: 0, fuelT: 0, vatOut: 0, vatIn: 0, cin: {}, cout: {}, dL: 0, dAmt: 0, pL: 0, pAmt: 0,
              money: [], fuel: [], diary: [], insp: [], harvests: [], care: [], docs: [], pays: [],
              kg: 0, wax: 0, kgAp: {}, invoiced: 0, quoted: 0, received: 0 };
    D.money.forEach(function (m) {
      if (!inRange(m.date, from, to)) return;
      s.money.push(m);
      if (m.dir === 'in') { s.inT += m.amt; s.cin[m.cat] = (s.cin[m.cat] || 0) + m.amt; s.vatOut += m.vat || 0; }
      else { s.outT += m.amt; s.cout[m.cat] = (s.cout[m.cat] || 0) + m.amt; s.vatIn += m.vat || 0; }
    });
    D.fuel.forEach(function (f) {
      if (!inRange(f.date, from, to)) return;
      s.fuel.push(f);
      s.fuelT += f.amt; s.vatIn += f.vat || 0;
      if (f.kind === 'petrol') { s.pL += f.l; s.pAmt += f.amt; } else { s.dL += f.l; s.dAmt += f.amt; }
    });
    D.diary.forEach(function (d) { if (inRange(d.date, from, to)) s.diary.push(d); });
    D.insp.forEach(function (x) { if (inRange(x.date, from, to)) s.insp.push(x); });
    D.care.forEach(function (x) { if (inRange(x.date, from, to)) s.care.push(x); });
    D.harvests.forEach(function (x) {
      if (!inRange(x.date, from, to)) return;
      s.harvests.push(x); s.kg += x.kg || 0; s.wax += x.wax || 0;
      var k = apName(x.ap) || '?';
      s.kgAp[k] = (s.kgAp[k] || 0) + (x.kg || 0);
    });
    D.docs.forEach(function (d) {
      if (inRange(d.date, from, to)) {
        s.docs.push(d);
        if (d.type === 'i') s.invoiced += docTotals(d).total;
        if (d.type === 'q') s.quoted += docTotals(d).total;
      }
      (d.pays || []).forEach(function (p) { if (inRange(p.date, from, to)) { s.pays.push({ d: d, p: p }); s.received += p.amt; } });
    });
    ['money', 'fuel', 'diary', 'insp', 'care', 'harvests', 'docs'].forEach(function (k) { s[k].sort(byDateAsc); });
    s.pays.sort(function (a, b) { return a.p.date.localeCompare(b.p.date); });
    s.outAll = s.outT + s.fuelT;
    s.net = s.inT - s.outAll;
    return s;
  }
  function wroteDiaryToday() { var d = today(); return D.diary.some(function (x) { return x.date === d; }); }
  function totalEntries() { return LISTS.reduce(function (s, k) { return s + D[k].length; }, 0); }
  function needPhoto() { return D.money.concat(D.fuel).filter(function (x) { return x.photoLater && !x.photo; }); }

  /* ================================================================ */
  /* Icons                                                             */
  /* ================================================================ */
  function ico(p, s) {
    return '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }
  var IC = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    hives: '<path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/><path d="M8 9.5h8M7.5 13h9"/>',
    work: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    diary: '<path d="M5 4a2 2 0 0 1 2-2h12v17H7a2 2 0 0 0-2 2z"/><path d="M5 21V4"/><path d="M9 7h6M9 11h6"/>',
    fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M3 21h13"/><path d="M7 8h5"/><path d="M15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
    reports: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    down: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>',
    jar: '<path d="M8 3h8v3H8z"/><path d="M7 6h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M5 12h14"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    quote: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h3"/>',
    invoice: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    clip: '<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    med: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M12 10v7M8.5 13.5h7"/>',
    map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5A5 5 0 0 1 21 19"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    badge: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h4M14 14h4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'
  };

  /* ================================================================ */
  /* Small HTML builders                                               */
  /* ================================================================ */
  function fld(label, inner, hint) {
    return '<div class="fw"><label class="f">' + esc(label) + '</label>' + inner + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }
  function inp(k, o) {
    o = o || {};
    var v = F[k] == null ? '' : F[k];
    return '<input class="in' + (o.cls ? ' ' + o.cls : '') + '" data-k="' + k + '" type="' + (o.type || 'text') + '"' +
      (o.mode ? ' inputmode="' + o.mode + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') +
      (o.list ? ' list="' + o.list + '"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.focus ? ' data-focus="1"' : '') +
      (o.id ? ' id="' + o.id + '"' : '') + ' autocomplete="off" value="' + esc(v) + '">';
  }
  function area(k, ph, rows, focus) {
    return '<textarea class="in" data-k="' + k + '" rows="' + (rows || 5) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (focus ? ' data-focus="1"' : '') + '>' + esc(F[k] || '') + '</textarea>';
  }
  function sel(k, opts, rr) {
    return '<select class="in" data-k="' + k + '"' + (rr ? ' data-rr="1"' : '') + '>' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(F[k] == null ? '' : F[k]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function seg(k, opts, cls) {
    return '<div class="seg' + (cls ? ' ' + cls : '') + '">' + opts.map(function (o) {
      return '<button type="button" class="' + (String(F[k]) === String(o[0]) ? 'on' : '') + '" data-chip="' + k + '" data-v="' + esc(o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function chips(k, list, labelFn) {   // single value suggestions that fill a text field
    if (!list || !list.length) return '';
    return '<div class="chips">' + list.map(function (v) {
      var lab = labelFn ? labelFn(v) : v;
      var on = F[k] != null && String(F[k]).toLowerCase() === String(lab).toLowerCase();
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-chip="' + k + '" data-v="' + esc(lab) + '">' + esc(lab) + '</button>';
    }).join('') + '</div>';
  }
  function pick(k, list, labelFn) {   // single choice from fixed keys, shown as chips
    return '<div class="chips">' + list.map(function (v) {
      return '<button type="button" class="chip' + (String(F[k]) === String(v) ? ' on' : '') + '" data-chip="' + k + '" data-v="' + esc(v) + '">' + esc(labelFn(v)) + '</button>';
    }).join('') + '</div>';
  }
  function multi(k, list, labelFn) {
    var cur = F[k] || [];
    return '<div class="chips">' + list.map(function (v) {
      return '<button type="button" class="chip' + (cur.indexOf(v) > -1 ? ' on' : '') + '" data-multi="' + k + '" data-v="' + esc(v) + '">' + esc(labelFn(v)) + '</button>';
    }).join('') + '</div>';
  }
  function check(k, label) {
    return '<label class="chk"><input type="checkbox" data-k="' + k + '" data-rr="1"' + (F[k] ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }
  function msg(kind, text) { return text ? '<div class="msg ' + kind + '">' + text + '</div>' : ''; }
  function stat(label, value, cls) { return '<div class="stat"><span>' + esc(label) + '</span><b class="' + (cls || '') + '">' + value + '</b></div>'; }
  function empty(text) { return '<p class="muted" style="margin:10px 0 0">' + esc(text) + '</p>'; }
  function cardHead(title, btn) { return '<div class="row"><strong>' + esc(title) + '</strong>' + (btn || '') + '</div>'; }
  function addBtn(act, attrs, label) {
    return '<button class="secondary small" data-act="' + act + '" ' + (attrs || '') + '>' + ico(IC.plus, 18) + esc(label || t('add')) + '</button>';
  }
  function monthNav(view, ym) {
    return '<div class="mnav"><button class="icon" data-act="mprev" data-view="' + view + '" aria-label="' + esc(t('prev')) + '">' + ico(IC.back) + '</button>' +
      '<strong>' + esc(ymLabel(ym)) + '</strong>' +
      '<button class="icon" data-act="mnext" data-view="' + view + '" aria-label="' + esc(t('next')) + '"' + (ym >= today().slice(0, 7) ? ' disabled' : '') + '>' + ico(IC.next) + '</button></div>';
  }
  function confirmBtn(key, act, label, again) {
    return '<button class="text danger" data-act="' + act + '">' + esc(confirmKey === key ? again : label) + '</button>';
  }
  function moreBtn(view, total, shown) {
    return total > shown ? '<button class="text" data-act="more" data-view="' + view + '">' + esc(t('show_more')) + '</button>' : '';
  }

  /* ================================================================ */
  /* Navigation                                                        */
  /* ================================================================ */
  var TABS = ['home', 'hives', 'work', 'money', 'diary'];
  var DETAIL = ['hive', 'apiary', 'client', 'doc', 'fuelv', 'pending'];
  function isTab(v) { return TABS.indexOf(v) > -1; }
  function showTab(tab) {
    TAB = tab || TAB; V = TAB; F = null; confirmKey = '';
    render(); window.scrollTo(0, 0);
  }
  function openSub(view, state) {
    state = state || {};
    if ((view === 'form' || DETAIL.indexOf(view) > -1) && DETAIL.indexOf(V) > -1) state.back = { v: V, f: F };
    V = view; F = state; confirmKey = '';
    if (!(history.state && history.state.sub)) history.pushState({ sub: 1 }, '');
    render(); window.scrollTo(0, 0);
  }
  function closeSub() {
    if (F && F.back) { var b = F.back; V = b.v; F = b.f; confirmKey = ''; render(); window.scrollTo(0, 0); return; }
    if (history.state && history.state.sub) history.back();   // popstate -> showTab()
    else showTab();
  }
  function goView(view, state) {   // replace the current sub view (e.g. form -> document) without a new history step
    state = state || {};
    if (F && F.back) state.back = F.back;
    V = view; F = state; confirmKey = '';
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', function () {
    if (!D || isTab(V)) return;
    if (F && F.back) { history.pushState({ sub: 1 }, ''); closeSub(); }   // phone back button: one step back
    else showTab();
  });

  /* ================================================================ */
  /* Render                                                            */
  /* ================================================================ */
  function render() {
    document.documentElement.lang = L();
    var setup = !D.settings.setup;
    document.body.classList.toggle('nonav', setup);
    renderHeader(setup);
    renderNav(setup);
    if (setup) return setupScreen();
    switch (V) {
      case 'home': return home();
      case 'hives': return hivesScreen();
      case 'work': return workScreen();
      case 'money': return moneyList();
      case 'diary': return diaryList();
      case 'form': return formScreen();
      case 'hive': return hiveScreen();
      case 'apiary': return apiaryScreen();
      case 'client': return clientScreen();
      case 'doc': return docScreen();
      case 'fuelv': return fuelList();
      case 'pending': return pendingScreen();
      case 'reports': return reportsScreen();
      case 'settings': return settingsScreen();
    }
  }
  function renderHeader(setup) {
    var title = setup ? 'ByeBoer' : (isTab(V) ? (V === 'home' ? (D.settings.biz || 'ByeBoer') : t('tab_' + V)) : subTitle());
    var h = '';
    if (!isTab(V) && !setup) h += '<button class="icon" data-act="close" aria-label="' + esc(t('back')) + '">' + ico(IC.back) + '</button>';
    h += '<h1>' + esc(title) + '</h1><div class="hbtns">';
    h += '<button id="installBtn" class="secondary small' + (installEvt ? '' : ' hidden') + '" type="button" data-act="install">' + esc(t('install')) + '</button>';
    if (!setup && isTab(V)) {
      h += '<button class="secondary small" data-act="reports">' + ico(IC.reports, 18) + '<span class="hide-xs">' + esc(t('reports')) + '</span></button>';
      h += '<button class="icon" data-act="settings" aria-label="' + esc(t('settings')) + '">' + ico(IC.settings) + '</button>';
    }
    document.getElementById('hdr').innerHTML = h + '</div>';
  }
  function subTitle() {
    if (V === 'reports') return t('reports');
    if (V === 'settings') return t('settings');
    if (V === 'form') {
      var k = F.kind, suf = (k === 'money' || k === 'recur') ? '_' + F.dir : k === 'doc' ? '_' + F.dtype : '';
      if (k === 'doc' && F.id) { var dd = find('docs', F.id); return dd ? dd.no : t('edit_doc' + suf); }
      return t((F.id || F.pid ? 'edit_' : 'new_') + k + suf);
    }
    if (V === 'hive') return hiveName(F.id) || t('hives');
    if (V === 'apiary') return apName(F.id) || t('apiaries');
    if (V === 'client') return clientName(F.id) || t('clients');
    if (V === 'doc') { var d = find('docs', F.id); return d ? d.no : t('tab_work'); }
    if (V === 'fuelv') return t('fuel');
    if (V === 'pending') return t('slips_needed');
    return 'ByeBoer';
  }
  function renderNav(setup) {
    var nav = document.getElementById('nav');
    if (setup) { nav.innerHTML = ''; return; }
    nav.innerHTML = '<div class="brand">ByeBoer</div>' + TABS.map(function (k) {
      return '<button data-act="tab" data-tab="' + k + '" class="' + (TAB === k ? 'on' : '') + '"' + (TAB === k ? ' aria-current="page"' : '') + '>' + ico(IC[k]) + '<span>' + esc(t('tab_' + k)) + '</span></button>';
    }).join('') + '<div class="side-extra"><button data-act="reports" class="' + (V === 'reports' ? 'on' : '') + '">' + ico(IC.reports) + '<span>' + esc(t('reports')) + '</span></button>' +
      '<button data-act="settings" class="' + (V === 'settings' ? 'on' : '') + '">' + ico(IC.settings) + '<span>' + esc(t('settings')) + '</span></button></div>';
  }

  /* ---------------- Setup (first run) ---------------- */
  function setupScreen() {
    if (!F || !F.setup) F = { setup: 1, lang: D.settings.lang, biz: D.settings.biz, owner: D.settings.owner, phone: D.settings.phone, vat: D.settings.vat ? '1' : '0', fuelOn: D.settings.fuelOn ? '1' : '0' };
    var h = '<div class="card hero"><div class="logo">' + ico(IC.hives, 34) + '</div>' +
      '<h2>' + esc(t('welcome')) + '</h2><p class="muted">' + esc(t('welcome_sub')) + '</p>' +
      fld(t('language'), seg('lang', [['en', 'English'], ['af', 'Afrikaans']])) +
      fld(t('biz_name'), inp('biz', { ph: t('biz_name_ph'), max: 60 }), esc(t('biz_name_hint'))) +
      fld(t('your_name'), inp('owner', { max: 60 })) +
      fld(t('phone'), inp('phone', { max: 20, mode: 'tel' })) +
      fld(t('vat_registered'), seg('vat', [['0', t('no')], ['1', t('yes')]]), esc(t('vat_hint'))) +
      fld(t('fuel_track_q'), seg('fuelOn', [['0', t('no')], ['1', t('yes')]]), esc(t('fuel_track_hint'))) +
      msg('err', F.err) +
      '<div style="margin-top:22px"><button class="primary" data-act="finishSetup">' + esc(t('start_using')) + '</button></div>' +
      '<p class="muted center" style="margin-top:16px">' + esc(t('stored_here')) + '</p>' +
      '<button class="text" data-act="restorePick">' + esc(t('restore_backup')) + '</button>' +
      '</div>';
    app.innerHTML = h;
  }
  function finishSetup() {
    if (!clean(F.biz) && !clean(F.owner)) { F.err = esc(t('err_biz')); return render(); }
    var s = D.settings;
    s.lang = F.lang; s.biz = clean(F.biz, 60); s.owner = clean(F.owner, 60); s.phone = clean(F.phone, 20);
    s.vat = F.vat === '1'; s.fuelOn = F.fuelOn === '1'; s.setup = true;
    if (!s.svcs.length) s.svcs = ['svc_d1', 'svc_d2', 'svc_d3', 'svc_d4', 'svc_d5', 'svc_d6'].map(function (k) { return { id: uid() + k.slice(-1), name: t(k), price: 0 }; });
    save(); F = null; TAB = 'home'; showTab('home');
    toast(t('ready'));
  }

  /* ---------------- Home ---------------- */
  function home() {
    var now = new Date(), ym = today().slice(0, 7);
    var m = summary(ym + '-01', dateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    var h = '';
    if (D.settings.remind && !wroteDiaryToday()) {
      h += '<div class="card nudge">' + ico(IC.diary, 26) + '<div class="grow"><strong>' + esc(t('diary_nudge')) + '</strong>' +
        '<div class="muted">' + esc(t('diary_nudge_sub')) + '</div></div>' +
        '<button class="primary small" data-act="new" data-kind="diary">' + esc(t('write')) + '</button></div>';
    }
    var last = D.settings.lastBackup, days = last ? Math.floor((Date.now() - parseD(last).getTime()) / 864e5) : 999;
    if (totalEntries() >= 10 && days > 30) {
      h += '<div class="card warnc"><div class="grow"><strong>' + esc(t('backup_nudge')) + '</strong><div class="muted">' +
        esc(last ? t('backup_last', { d: shortDate(last) }) : t('backup_never')) + '</div></div>' +
        '<button class="secondary small" data-act="backup">' + esc(t('backup_now')) + '</button></div>';
    }
    h += alertsHtml();
    h += '<div class="quick home">' +
      qa('insp', '', IC.search, t('q_insp')) + qa('harvest', '', IC.jar, t('q_harvest')) + qa('care', '', IC.med, t('q_care')) +
      qa('doc', 'q', IC.quote, t('q_quote'), 'b') + qa('doc', 'i', IC.invoice, t('q_invoice'), 'b') +
      qa('money', 'in', IC.plus, t('q_income'), 'g') + qa('money', 'out', IC.minus, t('q_expense'), 'r') +
      qa('diary', '', IC.diary, t('q_diary')) +
      '</div>';

    h += '<div class="grid">';
    h += '<div class="card tap" data-act="tab" data-tab="money"><div class="row"><span class="step">' + esc(ymLabel(ym)) + '</span><span class="pill">' + esc(t('tab_money')) + '</span></div>' +
      '<div class="stats">' + stat(t('income'), fmtR(m.inT), 'pos') + stat(D.settings.fuelOn ? t('expenses_incl_fuel') : t('expenses'), fmtR(m.outAll), 'neg') +
      stat(t('net'), fmtR(m.net), m.net >= 0 ? 'pos' : 'neg') + '</div></div>';

    var ow = owing(), owR = ow.reduce(function (s, d) { return s + docTotals(d).bal; }, 0), oq = openQuotes();
    h += '<div class="card tap" data-act="tab" data-tab="work"><div class="row"><span class="step">' + esc(t('quotes_invoices')) + '</span><span class="pill">' + esc(t('tab_work')) + '</span></div>' +
      '<div class="stats">' + stat(t('owed_to_you'), fmtR(owR), owR ? 'neg' : '') + stat(t('unpaid_invoices'), String(ow.length)) + stat(t('open_quotes'), String(oq.length)) + '</div></div>';

    var act = activeHives(), ty = taxYear(0), yr = summary(ty[0], ty[1]);
    var inspected = act.filter(function (hv) { var li = lastInsp(hv.id); return li && daysBetween(li.date, today()) <= 30; }).length;
    h += '<div class="card tap" data-act="tab" data-tab="hives"><div class="row"><span class="step">' + esc(t('hives')) + '</span><span class="pill">' + esc(t('tab_hives')) + '</span></div>' +
      (D.apiaries.length ? '<div class="stats">' + stat(t('active_hives'), String(act.length)) + stat(t('apiaries'), String(D.apiaries.length)) + stat(t('inspected_30'), inspected + ' / ' + act.length) + '</div>'
        : '<p class="muted" style="margin:10px 0 0">' + esc(t('no_apiaries_short')) + '</p>') + '</div>';
    h += '<div class="card tap" data-act="tab" data-tab="hives"><div class="row"><span class="step">' + esc(t('honey_tax_year')) + '</span><span class="pill">' + esc(t('harvests')) + '</span></div>' +
      '<div class="stats">' + stat(t('honey'), fmtKg(yr.kg)) + stat(t('wax'), fmtKg(yr.wax)) + stat(t('per_hive'), act.length ? fmtKg(r2(yr.kg / act.length)) : '–') + '</div></div>';
    h += '</div>';

    var recent = [].concat(
      D.money.map(function (x) { return { k: 'money', x: x }; }), D.insp.map(function (x) { return { k: 'insp', x: x }; }),
      D.harvests.map(function (x) { return { k: 'harvest', x: x }; }), D.care.map(function (x) { return { k: 'care', x: x }; }),
      D.docs.map(function (x) { return { k: 'doc', x: x }; }), D.diary.map(function (x) { return { k: 'diary', x: x }; }),
      D.fuel.map(function (x) { return { k: 'fuel', x: x }; })
    ).sort(function (a, b) { return (b.x.ts || 0) - (a.x.ts || 0); }).slice(0, 6);
    h += '<div class="card"><strong>' + esc(t('recent')) + '</strong>';
    if (!recent.length) h += empty(t('recent_empty'));
    else h += '<div class="list">' + recent.map(function (r) { return itemHtml(r.k, r.x, true); }).join('') + '</div>';
    h += '</div>';
    h += '<p class="muted center foot">' + esc(t('stored_here')) + '</p>';
    app.innerHTML = h;
  }
  function qa(kind, dir, icon, label, color) {
    return '<button class="qa' + (color ? ' ' + color : '') + '" data-act="new" data-kind="' + kind + '"' + (dir ? ' data-dir="' + dir + '"' : '') + '>' +
      ico(icon, 24) + '<span>' + esc(label) + '</span></button>';
  }
  function alertsHtml() {
    var rows = [], tdy = today(), due = dueList(7), afb = afbHives(), ow = owing(), np = needPhoto();
    if (afb.length) rows.push(['hive', afb[0].id, IC.alert, t('alert_afb', { n: afb.length }), afb.slice(0, 3).map(function (x) { return hiveLabel(x) + ' · ' + apName(x.ap); }).join(', '), 'r']);
    due.slice(0, 5).forEach(function (d) {
      var x = d.x, late = d.date < tdy;
      if (d.k === 'insp') rows.push(['hive', x.hive, IC.search, t(late ? 'alert_insp_late' : 'alert_insp', { h: hiveName(x.hive) }), apName((find('hives', x.hive) || {}).ap) + ' · ' + shortDate(d.date), late ? 'r' : '']);
      else rows.push(['editc', x.id, IC.med, t(late ? 'alert_care_late' : 'alert_care', { what: t('ct_' + x.type).toLowerCase(), where: x.hive ? hiveName(x.hive) : apName(x.ap) }),
        (x.product ? x.product + ' · ' : '') + shortDate(d.date), late ? 'r' : '']);
    });
    if (due.length > 5) rows.push(['tab', 'hives', IC.hives, t('alert_more_due', { n: due.length - 5 }), '', '']);
    var late = ow.filter(function (d) { return docStatus(d) === 'overdue'; });
    if (late.length) rows.push(['tab', 'work', IC.invoice, t('alert_overdue', { n: late.length, r: fmtR(late.reduce(function (s, d) { return s + docTotals(d).bal; }, 0)) }),
      late.slice(0, 3).map(function (d) { return d.no + ' ' + clientName(d.client); }).join(', '), 'r']);
    var waitQ = openQuotes().filter(function (d) { return d.status === 'sent' && daysBetween(d.sent || d.date, tdy) >= 7; });
    if (waitQ.length) rows.push(['tab', 'work', IC.quote, t('alert_quotes', { n: waitQ.length }), waitQ.slice(0, 3).map(function (d) { return d.no + ' ' + clientName(d.client); }).join(', '), '']);
    var reg = D.settings.regDue;
    if (reg && reg <= addDays(tdy, 30)) rows.push(['settings', '', IC.badge, t(reg < tdy ? 'alert_reg_late' : 'alert_reg', { d: shortDate(reg) }), t('alert_reg_sub'), reg < tdy ? 'r' : '']);
    if (np.length) rows.push(['pending', '', IC.cam, t('alert_photos', { n: np.length }), t('alert_photos_sub'), '']);
    if (!rows.length) return '';
    return '<div class="card alerts">' + rows.map(function (r) {
      var attrs = r[0] === 'tab' ? 'data-act="tab" data-tab="' + r[1] + '"' : r[0] === 'hive' ? 'data-act="hive" data-id="' + esc(r[1]) + '"' :
        r[0] === 'editc' ? 'data-act="careDone" data-id="' + esc(r[1]) + '"' : 'data-act="' + r[0] + '"';
      return '<button class="arow ' + r[5] + '" ' + attrs + '>' + ico(r[2], 22) + '<span class="grow"><b>' + esc(r[3]) + '</b><span class="muted">' + esc(r[4]) + '</span></span>' + ico(IC.next, 18) + '</button>';
    }).join('') + '</div>';
  }

  /* List items (shared) ------------------------------------------------ */
  function itemHtml(kind, x, withKind) {
    var title = '', sub = [], right = '', cls = '', act = 'edit', extra = '';
    if (kind === 'money') {
      title = x.desc || catLabel(x.cat);
      sub = [niceDate(x.date), x.desc ? catLabel(x.cat) : '', x.party];
      right = (x.dir === 'in' ? '+' : '−') + fmtR(x.amt); cls = x.dir === 'in' ? 'pos' : 'neg';
    } else if (kind === 'fuel') {
      title = fmtL(x.l) + ' ' + t(x.kind).toLowerCase();
      sub = [niceDate(x.date), x.mach, t('use_' + x.use)];
      right = fmtR(x.amt);
    } else if (kind === 'diary') {
      title = x.text.length > 70 ? x.text.slice(0, 70) + '…' : x.text; sub = [niceDate(x.date)];
    } else if (kind === 'insp') {
      var hv = find('hives', x.hive);
      title = hiveLabel(hv) + ': ' + inspSummary(x);
      sub = [niceDate(x.date), hv ? apName(hv.ap) : '', x.next ? t('next_on', { d: shortDate(x.next) }) : ''];
      if ((x.probs || []).some(function (p) { return BAD_PROBS[p]; })) cls = 'neg';
    } else if (kind === 'harvest') {
      title = fmtKg(x.kg || 0) + ' ' + t('honey').toLowerCase() + (x.wax ? ' · ' + fmtKg(x.wax) + ' ' + t('wax').toLowerCase() : '');
      sub = [niceDate(x.date), x.hive ? hiveName(x.hive) : t('whole_apiary'), apName(x.ap), x.frames ? t('frames_n', { n: x.frames }) : ''];
    } else if (kind === 'care') {
      title = t('ct_' + x.type) + (x.product ? ': ' + x.product : '') + (x.qty ? ' (' + x.qty + ')' : '');
      sub = [niceDate(x.date), x.hive ? hiveName(x.hive) : t('all_hives_at', { ap: apName(x.ap) }), x.type === 'move' && x.to ? '→ ' + apName(x.to) : '',
        x.next ? t('next_on', { d: shortDate(x.next) }) : ''];
    } else if (kind === 'doc') {
      var tt = docTotals(x);
      title = x.no + ' · ' + (clientName(x.client) || '?');
      sub = [niceDate(x.date), x.job, x.type === 'i' && tt.paid && tt.bal > 0.005 ? t('bal_due', { r: fmtR(tt.bal) }) : ''];
      right = fmtR(tt.total); act = 'doc';
      extra = statusPill(x);
    }
    var label = withKind ? '<span class="kind">' + esc(t('kind_' + (kind === 'doc' ? (x.type === 'q' ? 'quote' : 'invoice') : kind))) + '</span>' : '';
    var mark = (kind === 'money' || kind === 'fuel') ? (x.photo ? '<span class="pmark" title="' + esc(t('has_photo')) + '">' + ico(IC.clip, 15) + '</span>'
      : x.photoLater ? '<span class="pmark need" title="' + esc(t('photo_needed')) + '">' + ico(IC.cam, 15) + '</span>' : '') : '';
    return '<button class="item" data-act="' + act + '" data-kind="' + kind + '" data-id="' + esc(x.id) + '"><div class="row"><span class="ttl">' + label + esc(title) + mark + '</span>' +
      (right ? '<span class="amt ' + cls + '">' + esc(right) + '</span>' : '') + '</div>' +
      '<div class="row"><span class="muted grow">' + esc(sub.filter(Boolean).join(' · ')) + '</span>' + extra + '</div></button>';
  }
  function inspSummary(x) {
    var bits = [];
    if (x.queen) bits.push(t('qs_' + x.queen));
    if (x.brood) bits.push(t('br_' + x.brood));
    if (x.stores) bits.push(t('st_' + x.stores));
    if (x.temper && x.temper !== 'calm') bits.push(t('tm_' + x.temper));
    (x.probs || []).forEach(function (p) { bits.push(t('pr_' + p)); });
    return bits.join(', ') || t('inspected');
  }

  /* ---------------- Hives ---------------- */
  function hivesScreen() {
    var h = '<div class="two-btn"><button class="primary" data-act="new" data-kind="insp"' + (activeHives().length ? '' : ' disabled') + '>' + ico(IC.search) + esc(t('q_insp')) + '</button>' +
      '<button class="primary g" data-act="new" data-kind="harvest"' + (D.apiaries.length ? '' : ' disabled') + '>' + ico(IC.jar) + esc(t('q_harvest')) + '</button></div>' +
      '<div class="two-btn"><button class="secondary" data-act="new" data-kind="care"' + (D.apiaries.length ? '' : ' disabled') + '>' + ico(IC.med, 20) + esc(t('q_care')) + '</button>' +
      '<button class="secondary" data-act="new" data-kind="hive"' + (D.apiaries.length ? '' : ' disabled') + '>' + ico(IC.plus, 20) + esc(t('add_hive')) + '</button></div>';
    if (!D.apiaries.length) {
      h += '<div class="card"><strong>' + esc(t('start_apiary')) + '</strong><p class="muted">' + esc(t('start_apiary_sub')) + '</p>' +
        '<button class="primary" data-act="new" data-kind="apiary">' + ico(IC.pin) + esc(t('add_apiary')) + '</button></div>';
      app.innerHTML = h; return;
    }
    var due = dueList(14), tdy = today();
    if (due.length) {
      h += '<div class="card"><strong>' + esc(t('coming_up')) + '</strong><div class="list">' + due.map(function (d) {
        var x = d.x, late = d.date < tdy;
        var ttl = d.k === 'insp' ? t('insp_of', { h: hiveName(x.hive) }) : t('ct_' + x.type) + ': ' + (x.hive ? hiveName(x.hive) : t('all_hives_at', { ap: apName(x.ap) }));
        return '<button class="item" data-act="' + (d.k === 'insp' ? 'inspAgain' : 'careDone') + '" data-id="' + esc(d.k === 'insp' ? x.hive : x.id) + '"><div class="row"><span class="ttl">' + esc(ttl) + '</span>' +
          '<span class="amt ' + (late ? 'neg' : '') + '">' + esc(shortDate(d.date)) + '</span></div><div class="muted">' +
          esc([d.k === 'care' ? x.product : apName((find('hives', x.hive) || {}).ap), late ? t('overdue') : t('tap_when_done')].filter(Boolean).join(' · ')) + '</div></button>';
      }).join('') + '</div></div>';
    }
    D.apiaries.slice().sort(byName).forEach(function (a) {
      var hs = activeHives(a.id).sort(hiveSort);
      h += '<div class="card"><div class="row"><button class="plain grow" data-act="apiary" data-id="' + esc(a.id) + '"><span class="ttl">' + esc(a.name) + ' ' + ico(IC.next, 16) + '</span>' +
        '<span class="muted">' + esc([t('ak_' + a.kind), t('n_hives', { n: hs.length }), a.place].filter(Boolean).join(' · ')) + '</span></button>' +
        addBtn('new', 'data-kind="hive" data-ap="' + esc(a.id) + '"', t('hive')) + '</div>';
      if (hs.length) h += '<div class="hivegrid">' + hs.map(hiveTile).join('') + '</div>';
      else h += empty(t('no_hives_here'));
      h += '</div>';
    });
    h += '<button class="secondary" data-act="new" data-kind="apiary">' + ico(IC.pin, 20) + esc(t('add_apiary')) + '</button><div style="height:14px"></div>';
    var hv = D.harvests.slice().sort(byDateDesc), ty = taxYear(0), yr = summary(ty[0], ty[1]);
    h += '<div class="card">' + cardHead(t('harvests'), addBtn('new', 'data-kind="harvest"')) +
      '<div class="stats">' + stat(t('honey_tax_year'), fmtKg(yr.kg)) + stat(t('wax'), fmtKg(yr.wax)) + stat(t('harvests_n'), String(yr.harvests.length)) + '</div>';
    h += hv.length ? '<div class="list">' + hv.slice(0, LS.harvest.n).map(function (x) { return itemHtml('harvest', x); }).join('') + '</div>' + moreBtn('harvest', hv.length, LS.harvest.n) : empty(t('harvest_empty'));
    h += '</div>';
    var gone = D.hives.filter(function (x) { return x.status !== 'active'; }).sort(hiveSort);
    if (gone.length) h += '<div class="card"><strong>' + esc(t('hives_gone')) + '</strong><div class="list">' + gone.map(function (x) {
      return '<button class="item" data-act="hive" data-id="' + esc(x.id) + '"><div class="row"><span class="ttl">' + esc(hiveLabel(x)) + '</span><span class="pill">' + esc(t('hs_' + x.status)) + '</span></div>' +
        '<div class="muted">' + esc([apName(x.ap), x.ended ? shortDate(x.ended) : ''].filter(Boolean).join(' · ')) + '</div></button>';
    }).join('') + '</div></div>';
    app.innerHTML = h;
  }
  function hiveTile(x) {
    var st = hiveState(x);
    return '<button class="hv" data-act="hive" data-id="' + esc(x.id) + '"><b><span class="dot ' + st.cls + '"></span>' + esc(hiveLabel(x)) + '</b>' +
      '<span class="muted">' + esc(st.text) + '</span></button>';
  }
  function hiveScreen() {
    var x = find('hives', F.id);
    if (!x) { app.innerHTML = ''; return closeSub(); }
    var st = hiveState(x), kg = D.harvests.filter(function (r) { return r.hive === x.id; }).reduce(function (s, r) { return s + (r.kg || 0); }, 0);
    var h = '<div class="card"><div class="row"><span><span class="dot ' + st.cls + '"></span>' + esc(st.text) + '</span>' +
      '<button class="secondary small" data-act="edit" data-kind="hive" data-id="' + esc(x.id) + '">' + esc(t('edit')) + '</button></div>' +
      '<table class="kv">' + [[t('apiary'), apName(x.ap)], [t('hive_type'), t('ht_' + x.type)], [t('source'), t('hsrc_' + x.source)],
        [t('started'), shortDate(x.date)], [t('queen'), [x.queenYear, x.queenMark].filter(Boolean).join(' · ') || '–'],
        [t('last_insp'), st.li ? shortDate(st.li.date) : '–'], [t('honey_from_hive'), fmtKg(kg)]].map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>';
      }).join('') + '</table>' + (x.notes ? '<p class="muted" style="margin:10px 0 0;white-space:pre-wrap">' + esc(x.notes) + '</p>' : '') + '</div>';
    if (st.li && (st.li.probs || []).indexOf('afb') > -1) h += msg('err', ico(IC.alert, 18) + ' ' + esc(t('afb_warn'))).replace('margin: 14px 0 0', '') + '<div style="height:14px"></div>';
    if (x.status === 'active') h += '<div class="quick">' +
      '<button class="qa" data-act="hiveNew" data-kind="insp" data-id="' + esc(x.id) + '">' + ico(IC.search, 22) + '<span>' + esc(t('q_insp')) + '</span></button>' +
      '<button class="qa g" data-act="hiveNew" data-kind="harvest" data-id="' + esc(x.id) + '">' + ico(IC.jar, 22) + '<span>' + esc(t('q_harvest')) + '</span></button>' +
      '<button class="qa" data-act="hiveNew" data-kind="care" data-id="' + esc(x.id) + '">' + ico(IC.med, 22) + '<span>' + esc(t('q_care')) + '</span></button>' +
      '</div>';
    var hist = [].concat(
      D.insp.filter(function (r) { return r.hive === x.id; }).map(function (r) { return { k: 'insp', x: r }; }),
      D.care.filter(function (r) { return r.hive === x.id || (!r.hive && r.ap === x.ap && r.date >= (x.date || '')); }).map(function (r) { return { k: 'care', x: r }; }),
      D.harvests.filter(function (r) { return r.hive === x.id; }).map(function (r) { return { k: 'harvest', x: r }; })
    ).sort(function (a, b) { return byDateDesc(a.x, b.x); });
    h += '<div class="card"><strong>' + esc(t('history')) + '</strong>';
    h += hist.length ? '<div class="list">' + hist.slice(0, LS.hist.n).map(function (r) { return itemHtml(r.k, r.x, true); }).join('') + '</div>' + moreBtn('hist', hist.length, LS.hist.n) : empty(t('history_empty'));
    app.innerHTML = h + '</div>';
  }
  function apiaryScreen() {
    var a = find('apiaries', F.id);
    if (!a) { app.innerHTML = ''; return closeSub(); }
    var hs = activeHives(a.id).sort(hiveSort), ty = taxYear(0);
    var kg = D.harvests.filter(function (r) { return r.ap === a.id && inRange(r.date, ty[0], ty[1]); }).reduce(function (s, r) { return s + (r.kg || 0); }, 0);
    var h = '<div class="card"><div class="row"><span class="pill">' + esc(t('ak_' + a.kind)) + '</span>' +
      '<button class="secondary small" data-act="edit" data-kind="apiary" data-id="' + esc(a.id) + '">' + esc(t('edit')) + '</button></div>' +
      '<div class="stats">' + stat(t('active_hives'), String(hs.length)) + stat(t('honey_tax_year'), fmtKg(kg)) + stat(t('per_hive'), hs.length ? fmtKg(r2(kg / hs.length)) : '–') + '</div>' +
      '<table class="kv">' + [[t('place'), a.place], [t('landowner'), [a.contact, a.phone].filter(Boolean).join(' · ')], [t('gps'), a.gps]].filter(function (r) { return r[1]; }).map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>';
      }).join('') + '</table>' +
      (a.gps ? '<a class="btn secondary" style="margin-top:12px" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + encodeURIComponent(a.gps) + '">' + ico(IC.map, 20) + esc(t('open_map')) + '</a>' : '') +
      (a.notes ? '<p class="muted" style="margin:10px 0 0;white-space:pre-wrap">' + esc(a.notes) + '</p>' : '') + '</div>';
    h += '<div class="quick">' +
      '<button class="qa" data-act="apNew" data-kind="hive" data-id="' + esc(a.id) + '">' + ico(IC.plus, 22) + '<span>' + esc(t('add_hive')) + '</span></button>' +
      (hs.length ? '<button class="qa" data-act="apNew" data-kind="insp" data-id="' + esc(a.id) + '">' + ico(IC.search, 22) + '<span>' + esc(t('q_insp')) + '</span></button>' : '') +
      '<button class="qa g" data-act="apNew" data-kind="harvest" data-id="' + esc(a.id) + '">' + ico(IC.jar, 22) + '<span>' + esc(t('q_harvest')) + '</span></button>' +
      '<button class="qa" data-act="apNew" data-kind="care" data-id="' + esc(a.id) + '">' + ico(IC.med, 22) + '<span>' + esc(t('q_care')) + '</span></button>' +
      '</div>';
    h += '<div class="card"><strong>' + esc(t('hives')) + '</strong>' + (hs.length ? '<div class="hivegrid">' + hs.map(hiveTile).join('') + '</div>' : empty(t('no_hives_here'))) + '</div>';
    var hist = [].concat(
      D.care.filter(function (r) { return r.ap === a.id; }).map(function (r) { return { k: 'care', x: r }; }),
      D.harvests.filter(function (r) { return r.ap === a.id; }).map(function (r) { return { k: 'harvest', x: r }; })
    ).sort(function (p, q) { return byDateDesc(p.x, q.x); });
    if (hist.length) h += '<div class="card"><strong>' + esc(t('history')) + '</strong><div class="list">' + hist.slice(0, LS.hist.n).map(function (r) { return itemHtml(r.k, r.x, true); }).join('') + '</div>' + moreBtn('hist', hist.length, LS.hist.n) + '</div>';
    app.innerHTML = h;
  }

  /* ---------------- Work: quotes, invoices, clients, services ---------------- */
  function workScreen() {
    var st = LS.docs;
    var h = '<div class="two-btn"><button class="primary b" data-act="new" data-kind="doc" data-dir="q">' + ico(IC.quote) + esc(t('q_quote')) + '</button>' +
      '<button class="primary" data-act="new" data-kind="doc" data-dir="i">' + ico(IC.invoice) + esc(t('q_invoice')) + '</button></div>';
    if (!D.settings.logo || !D.settings.bankAcc) {
      h += '<div class="card nudge">' + ico(IC.image, 26) + '<div class="grow"><strong>' + esc(t('setup_docs')) + '</strong><div class="muted">' +
        esc(!D.settings.logo ? t('setup_docs_logo') : t('setup_docs_bank')) + '</div></div><button class="secondary small" data-act="settings" data-to="docs">' + esc(t('set_up')) + '</button></div>';
    }
    var ow = owing().sort(function (a, b) { return (a.due || a.date).localeCompare(b.due || b.date); });
    var owR = ow.reduce(function (s, d) { return s + docTotals(d).bal; }, 0);
    h += '<div class="card">' + cardHead(t('owed_to_you')) + '<div class="stats">' + stat(t('total'), fmtR(owR), owR ? 'neg' : '') + stat(t('unpaid_invoices'), String(ow.length)) + '</div>';
    h += ow.length ? '<div class="list">' + ow.map(function (d) { return itemHtml('doc', d); }).join('') + '</div>' : empty(t('nothing_owed'));
    h += '</div>';
    var oq = openQuotes().sort(byDateDesc);
    if (oq.length) h += '<div class="card"><strong>' + esc(t('open_quotes')) + '</strong><div class="list">' + oq.map(function (d) { return itemHtml('doc', d); }).join('') + '</div></div>';
    var all = D.docs.filter(function (d) { return st.f === 'all' || d.type === st.f; }).sort(byDateDesc);
    h += '<div class="card"><strong>' + esc(t('all_docs')) + '</strong><div class="filter">' + [['all', t('all')], ['q', t('quotes')], ['i', t('invoices')]].map(function (o) {
      return '<button class="chip' + (st.f === o[0] ? ' on' : '') + '" data-act="dfilter" data-v="' + o[0] + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
    h += all.length ? '<div class="list">' + all.slice(0, st.n).map(function (d) { return itemHtml('doc', d); }).join('') + '</div>' + moreBtn('docs', all.length, st.n) : empty(t('docs_empty'));
    h += '</div>';
    var cl = D.clients.slice().sort(byName);
    h += '<div class="card">' + cardHead(t('clients'), addBtn('new', 'data-kind="client"')) +
      (cl.length ? '<div class="list">' + cl.map(function (c) {
        var ds = D.docs.filter(function (d) { return d.client === c.id; }), bal = ds.filter(function (d) { return d.type === 'i'; }).reduce(function (s, d) { return s + Math.max(0, docTotals(d).bal); }, 0);
        return '<button class="item" data-act="client" data-id="' + esc(c.id) + '"><div class="row"><span class="ttl">' + esc(c.name) + '</span>' + (bal > 0.005 ? '<span class="amt neg">' + esc(fmtR(bal)) + '</span>' : '') + '</div>' +
          '<div class="muted">' + esc([c.phone, c.email, t('n_docs', { n: ds.length })].filter(Boolean).join(' · ')) + '</div></button>';
      }).join('') + '</div>' : empty(t('clients_empty'))) + '</div>';
    var sv = D.settings.svcs;
    h += '<div class="card">' + cardHead(t('my_services'), addBtn('new', 'data-kind="svc"')) + '<div class="hint">' + esc(t('services_hint')) + '</div>' +
      (sv.length ? '<div class="list">' + sv.map(function (s) {
        return '<button class="item" data-act="edit" data-kind="svc" data-id="' + esc(s.id) + '"><div class="row"><span class="ttl">' + esc(s.name) + '</span><span class="amt' + (s.price ? '' : ' neg') + '">' +
          esc(s.price ? fmtR(s.price) : t('set_price')) + '</span></div></button>';
      }).join('') + '</div>' : '') + '</div>';
    app.innerHTML = h;
  }
  function clientScreen() {
    var c = find('clients', F.id);
    if (!c) { app.innerHTML = ''; return closeSub(); }
    var ds = D.docs.filter(function (d) { return d.client === c.id; }).sort(byDateDesc);
    var inv = ds.filter(function (d) { return d.type === 'i'; });
    var billed = inv.reduce(function (s, d) { return s + docTotals(d).total; }, 0), paid = inv.reduce(function (s, d) { return s + docTotals(d).paid; }, 0);
    var h = '<div class="card"><div class="row"><strong>' + esc(c.name) + '</strong><button class="secondary small" data-act="edit" data-kind="client" data-id="' + esc(c.id) + '">' + esc(t('edit')) + '</button></div>' +
      '<table class="kv">' + [[t('phone'), c.phone], [t('email'), c.email], [t('address'), c.addr], [t('vat_no'), c.vatNo]].filter(function (r) { return r[1]; }).map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td style="white-space:pre-wrap">' + esc(r[1]) + '</td></tr>';
      }).join('') + '</table>' +
      '<div class="stats">' + stat(t('invoiced'), fmtR(billed)) + stat(t('paid'), fmtR(paid), 'pos') + stat(t('owes'), fmtR(billed - paid), billed - paid > 0.005 ? 'neg' : '') + '</div>' +
      (c.phone ? '<div class="two" style="margin-top:12px"><a class="btn secondary" href="tel:' + esc(c.phone.replace(/[^\d+]/g, '')) + '">' + ico(IC.phone, 18) + esc(t('call')) + '</a>' +
        '<a class="btn secondary" target="_blank" rel="noopener" href="https://wa.me/' + esc(waNumber(c.phone)) + '">' + esc(t('whatsapp')) + '</a></div>' : '') + '</div>';
    h += '<div class="two-btn"><button class="primary b" data-act="clientDoc" data-dir="q" data-id="' + esc(c.id) + '">' + ico(IC.quote) + esc(t('q_quote')) + '</button>' +
      '<button class="primary" data-act="clientDoc" data-dir="i" data-id="' + esc(c.id) + '">' + ico(IC.invoice) + esc(t('q_invoice')) + '</button></div>';
    h += '<div class="card"><strong>' + esc(t('all_docs')) + '</strong>' + (ds.length ? '<div class="list">' + ds.map(function (d) { return itemHtml('doc', d); }).join('') + '</div>' : empty(t('docs_empty'))) + '</div>';
    app.innerHTML = h;
  }
  function waNumber(p) { var d = String(p || '').replace(/\D/g, ''); return d.charAt(0) === '0' ? '27' + d.slice(1) : d; }

  function docScreen() {
    var d = find('docs', F.id);
    if (!d) { app.innerHTML = ''; return closeSub(); }
    var x = docTotals(d), c = find('clients', d.client) || {}, s = docStatus(d), q = d.type === 'q';
    var h = '<div class="card"><div class="row"><span class="step">' + esc(docTitle(d)) + '</span>' + statusPill(d) + '</div>' +
      '<h2 style="margin:6px 0 2px">' + esc(c.name || '?') + '</h2>' +
      '<div class="muted">' + esc([d.job, d.site].filter(Boolean).join(' · ')) + '</div>' +
      '<table class="kv">' + [[t('date'), shortDate(d.date)], q ? [t('valid_until'), d.valid ? shortDate(d.valid) : '–'] : [t('due_date'), d.due ? shortDate(d.due) : '–']]
        .concat(d.from ? [[t('from_quote'), (find('docs', d.from) || {}).no || '–']] : [])
        .concat(d.inv ? [[t('invoice'), (find('docs', d.inv) || {}).no || '–']] : []).map(function (r) {
          return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>';
        }).join('') + '</table>';
    h += '<div class="list" style="margin-top:12px">' + d.lines.map(function (l) {
      return '<div class="item static"><div class="row"><span class="ttl" style="white-space:normal">' + esc(l.d) + '</span><span class="amt">' + esc(fmtR(r2(l.q * l.p))) + '</span></div>' +
        '<div class="muted">' + esc(fmtQ(l.q) + ' × ' + fmtR(l.p)) + '</div></div>';
    }).join('') + (d.travel ? '<div class="item static"><div class="row"><span class="ttl">' + esc(t('travel')) + '</span><span class="amt">' + esc(fmtR(r2(d.travel.km * d.travel.rate))) + '</span></div>' +
      '<div class="muted">' + esc(t('km_line', { km: fmtQ(d.travel.km), r: fmtR(d.travel.rate) })) + '</div></div>' : '') + '</div>';
    h += '<div class="totals">' + (d.vat ? '<div class="row"><span>' + esc(t('subtotal')) + '</span><b>' + esc(fmtR(x.sub)) + '</b></div><div class="row"><span>' + esc(t('vat_pct', { r: fmtNum(d.vatRate || 15, (d.vatRate || 15) % 1 ? 1 : 0) })) + '</span><b>' + esc(fmtR(x.vat)) + '</b></div>' : '') +
      '<div class="row big"><span>' + esc(t('total')) + '</span><span>' + esc(fmtR(x.total)) + '</span></div>' +
      (!q && x.paid ? '<div class="row"><span>' + esc(t('paid')) + '</span><b class="pos">' + esc(fmtR(x.paid)) + '</b></div><div class="row"><span>' + esc(t('balance_due')) + '</span><b class="' + (x.bal > 0.005 ? 'neg' : 'pos') + '">' + esc(fmtR(x.bal)) + '</b></div>' : '') +
      (q && Number(D.settings.deposit) > 0 ? '<div class="row muted"><span>' + esc(t('deposit_line', { p: D.settings.deposit })) + '</span><span>' + esc(fmtR(r2(x.total * D.settings.deposit / 100))) + '</span></div>' : '') +
      '</div>' + (d.notes ? '<p class="muted" style="white-space:pre-wrap;margin:12px 0 0">' + esc(d.notes) + '</p>' : '') + '</div>';

    // actions
    h += '<div class="card"><strong>' + esc(t('send_doc')) + '</strong><p class="muted" style="margin:6px 0 12px">' + esc(t('send_doc_sub')) + '</p><div class="stack">' +
      (canShare ? '<button class="primary" data-act="docShare">' + ico(IC.share) + esc(t('share_pdf_wa')) + '</button>' : '') +
      '<button class="' + (canShare ? 'secondary' : 'primary') + '" data-act="docPdf">' + ico(IC.down) + esc(t('save_pdf')) + '</button>' +
      (c.phone ? '<a class="btn secondary" target="_blank" rel="noopener" href="https://wa.me/' + esc(waNumber(c.phone)) + '?text=' + encodeURIComponent(waText(d, x)) + '">' + esc(t('wa_message')) + '</a>' : '') +
      '</div></div>';
    h += '<div class="card"><strong>' + esc(t('what_next')) + '</strong><div class="stack" style="margin-top:12px">';
    if (q) {
      if (d.status !== 'sent' && d.status !== 'accepted') h += '<button class="secondary" data-act="docStatus" data-v="sent">' + esc(t('mark_sent')) + '</button>';
      if (d.status !== 'accepted') h += '<button class="secondary g" data-act="docStatus" data-v="accepted">' + ico(IC.check, 20) + esc(t('mark_accepted')) + '</button>';
      if (d.status !== 'declined' && d.status !== 'accepted') h += '<button class="secondary" data-act="docStatus" data-v="declined">' + esc(t('mark_declined')) + '</button>';
      h += d.inv && find('docs', d.inv) ? '<button class="primary" data-act="doc" data-id="' + esc(d.inv) + '">' + esc(t('open_invoice')) + '</button>'
        : '<button class="primary" data-act="toInvoice">' + ico(IC.invoice) + esc(t('make_invoice')) + '</button><div class="hint">' + esc(t('make_invoice_hint')) + '</div>';
    } else {
      if (d.status === 'draft') h += '<button class="secondary" data-act="docStatus" data-v="sent">' + esc(t('mark_sent')) + '</button>';
      if (x.bal > 0.005) h += '<button class="primary g" data-act="payNew">' + ico(IC.plus) + esc(t('record_payment')) + '</button><div class="hint">' + esc(t('record_payment_hint')) + '</div>';
    }
    h += '<button class="secondary" data-act="edit" data-kind="doc" data-id="' + esc(d.id) + '">' + ico(IC.edit, 20) + esc(t('edit')) + '</button>' +
      '<button class="secondary" data-act="copyDoc">' + esc(t(q ? 'copy_quote' : 'copy_invoice')) + '</button></div></div>';
    if (!q && (d.pays || []).length) {
      h += '<div class="card"><strong>' + esc(t('payments')) + '</strong><div class="list">' + d.pays.slice().sort(byDateDesc).map(function (p) {
        return '<button class="item" data-act="payEdit" data-id="' + esc(p.id) + '"><div class="row"><span class="ttl">' + esc(t('pm_' + (p.method || 'eft'))) + '</span><span class="amt pos">' + esc(fmtR(p.amt)) + '</span></div>' +
          '<div class="muted">' + esc(niceDate(p.date)) + '</div></button>';
      }).join('') + '</div></div>';
    }
    if (c.id) h += '<button class="text" data-act="client" data-id="' + esc(c.id) + '">' + esc(t('open_client', { n: c.name })) + '</button>';
    app.innerHTML = h;
  }
  function waText(d, x) {
    var s = D.settings, bits = [t('wa_hello', { n: clientName(d.client) })];
    bits.push(t(d.type === 'q' ? 'wa_quote' : 'wa_invoice', { no: d.no, r: fmtR(d.type === 'q' ? x.total : x.bal), job: d.job || '' }).replace(' ()', ''));
    if (d.type === 'i' && s.bankAcc) bits.push(t('wa_bank', { bank: s.bankName, acc: s.bankAcc, br: s.bankBranch, ref: d.no }));
    bits.push(t('wa_thanks', { n: s.owner || s.biz }));
    return bits.join('\n\n');
  }

  /* ---------------- Money ---------------- */
  function moneyList() {
    var st = LS.money, ym = st.ym || (st.ym = today().slice(0, 7));
    var list = D.money.filter(function (m) { return m.date.slice(0, 7) === ym; }).sort(byDateDesc);
    var tin = 0, tout = 0;
    list.forEach(function (m) { if (m.dir === 'in') tin += m.amt; else tout += m.amt; });
    var shown = list.filter(function (m) { return st.dir === 'all' || m.dir === st.dir; });
    var h = '<div class="two-btn"><button class="primary g" data-act="new" data-kind="money" data-dir="in">' + ico(IC.plus) + esc(t('q_income')) + '</button>' +
      '<button class="primary r" data-act="new" data-kind="money" data-dir="out">' + ico(IC.minus) + esc(t('q_expense')) + '</button></div>';
    var np = needPhoto().length;
    h += '<div class="two-btn">' + (D.settings.fuelOn || D.fuel.length ? '<button class="secondary" data-act="fuelv">' + ico(IC.fuel, 20) + esc(t('fuel')) + '</button>' : '') +
      '<button class="secondary" data-act="pending"' + (np ? '' : ' disabled') + '>' + ico(IC.cam, 20) + esc(t('slips_needed')) + (np ? ' <span class="badge">' + np + '</span>' : '') + '</button></div>';
    h += '<div class="card">' + monthNav('money', ym) +
      '<div class="stats">' + stat(t('income'), fmtR(tin), 'pos') + stat(t('expenses'), fmtR(tout), 'neg') + stat(t('net'), fmtR(tin - tout), tin - tout >= 0 ? 'pos' : 'neg') + '</div>' +
      '<div class="filter">' + [['all', t('all')], ['in', t('income')], ['out', t('expenses')]].map(function (o) {
        return '<button class="chip' + (st.dir === o[0] ? ' on' : '') + '" data-act="mfilter" data-v="' + o[0] + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
    h += shown.length ? '<div class="list">' + shown.map(function (m) { return itemHtml('money', m); }).join('') + '</div>' : empty(t('money_empty'));
    h += '</div>';
    var rules = D.recur.slice().sort(function (a, b) { return (b.on - a.on) || a.day - b.day; });
    h += '<div class="card">' + cardHead(t('repeating'), addBtn('new', 'data-kind="recur"')) + '<div class="hint">' + esc(t('repeating_hint')) + '</div>';
    if (rules.length) h += '<div class="list">' + rules.map(function (r) {
      return '<button class="item" data-act="edit" data-kind="recur" data-id="' + esc(r.id) + '"><div class="row"><span class="ttl">' + esc(r.desc || catLabel(r.cat)) + '</span>' +
        '<span class="amt ' + (r.dir === 'in' ? 'pos' : 'neg') + '">' + (r.dir === 'in' ? '+' : '−') + esc(fmtR(r.amt)) + '</span></div>' +
        '<div class="muted">' + esc((r.on ? t('every_month_on', { d: r.day }) : t('stopped')) + ' · ' + catLabel(r.cat) + (r.party ? ' · ' + r.party : '')) + '</div></button>';
    }).join('') + '</div>';
    h += '</div><p class="muted center foot">' + esc(t('invoice_money_note')) + '</p>';
    app.innerHTML = h;
  }

  /* ---------------- Fuel (optional) ---------------- */
  function fuelList() {
    var st = LS.fuel, ym = st.ym || (st.ym = today().slice(0, 7));
    var list = D.fuel.filter(function (f) { return f.date.slice(0, 7) === ym; }).sort(byDateDesc);
    var dl = 0, pl = 0, amt = 0;
    list.forEach(function (f) { if (f.kind === 'petrol') pl += f.l; else dl += f.l; amt += f.amt; });
    var h = '<button class="primary" data-act="new" data-kind="fuel">' + ico(IC.plus) + esc(t('fuel_bought_btn')) + '</button>';
    h += '<div class="card" style="margin-top:14px">' + monthNav('fuel', ym) +
      '<div class="stats">' + stat(t('diesel'), fmtL(dl)) + stat(t('petrol'), fmtL(pl)) + stat(t('spent'), fmtR(amt)) + '</div></div>';
    h += '<div class="card"><strong>' + esc(t('fuel_bought')) + '</strong>';
    h += list.length ? '<div class="list">' + list.map(function (f) { return itemHtml('fuel', f); }).join('') + '</div>' : empty(t('fuel_empty'));
    h += '</div><p class="muted center foot">' + esc(t('fuel_note')) + '</p>';
    app.innerHTML = h;
  }

  /* ---------------- Diary ---------------- */
  function diaryList() {
    var st = LS.diary, q = (st.q || '').toLowerCase();
    var list = D.diary.filter(function (d) {
      return !q || d.text.toLowerCase().indexOf(q) > -1 || (d.tags || []).some(function (g) { return t('tag_' + g).toLowerCase().indexOf(q) > -1; });
    }).sort(byDateDesc);
    var h = '<button class="primary" data-act="new" data-kind="diary">' + ico(IC.plus) + esc(t('write_today')) + '</button>';
    h += '<div class="card" style="margin-top:14px"><input class="in" id="dsearch" type="search" placeholder="' + esc(t('search_diary')) + '" value="' + esc(st.q || '') + '">';
    if (!list.length) h += '<p class="muted" style="margin:12px 0 0">' + esc(q ? t('no_results') : t('diary_empty')) + '</p>';
    else {
      var lastDate = '';
      h += '<div class="list">' + list.slice(0, st.n).map(function (d) {
        var head = d.date !== lastDate ? '<div class="dhead">' + esc(niceDate(d.date)) + '</div>' : '';
        lastDate = d.date;
        return head + '<button class="item diary" data-act="edit" data-kind="diary" data-id="' + esc(d.id) + '">' +
          '<div class="dtext">' + esc(d.text) + '</div>' +
          ((d.tags || []).length ? '<div class="tags">' + d.tags.map(function (g) { return '<span class="pill">' + esc(t('tag_' + g)) + '</span>'; }).join('') + '</div>' : '') +
          '</button>';
      }).join('') + '</div>' + moreBtn('diary', list.length, st.n);
    }
    h += '</div>';
    if (D.settings.remind) h += '<p class="muted center foot">' + esc(t('reminder_where')) + ' <a href="#" data-act="settings">' + esc(t('settings')) + '</a></p>';
    app.innerHTML = h;
  }

  /* ---------------- Slips still needing a photo ---------------- */
  function pendingScreen() {
    var list = needPhoto().map(function (x) { return { k: D.money.indexOf(x) > -1 ? 'money' : 'fuel', x: x }; }).sort(function (a, b) { return byDateDesc(a.x, b.x); });
    var h = '<div class="card"><p class="muted" style="margin:0">' + esc(t('pending_hint')) + '</p>';
    h += list.length ? '<div class="list">' + list.map(function (r) { return itemHtml(r.k, r.x); }).join('') + '</div>' : '<p>' + esc(t('pending_none')) + '</p>';
    app.innerHTML = h + '</div>';
  }

  /* ================================================================ */
  /* Forms                                                             */
  /* ================================================================ */
  function openNew(kind, opts) {
    opts = opts || {};
    var s = { kind: kind, date: today() };
    var hv = opts.hive ? find('hives', opts.hive) : null;
    var ap = opts.ap || (hv ? hv.ap : '') || (D.apiaries.length === 1 ? D.apiaries[0].id : '');
    if (kind === 'money' || kind === 'recur') {
      s.dir = opts.dir || 'out'; s.cat = catsFor(s.dir)[0]; s.vatIncl = !NO_VAT_DEFAULT[s.cat];
      if (kind === 'recur') { s.day = String(Math.min(28, new Date().getDate())); s.on = true; }
    } else if (kind === 'fuel') {
      var lastF = D.fuel.slice().sort(byDateDesc)[0];
      s.fkind = lastF ? lastF.kind : 'diesel'; s.use = 'hives'; s.vatIncl = true; s.mach = lastF ? lastF.mach : '';
    } else if (kind === 'diary') { s.tags = []; }
    else if (kind === 'apiary') { s.akind = D.apiaries.length ? 'outyard' : 'home'; s.date = undefined; }
    else if (kind === 'hive') {
      var maxNo = D.hives.reduce(function (m, x) { var n = parseInt(x.no, 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
      Object.assign(s, { ap: ap || (D.apiaries[0] || {}).id || '', no: String(maxNo + 1), htype: 'lang', source: opts.source || 'swarm', status: 'active', queenYear: '' });
    } else if (kind === 'insp') {
      var hid = opts.hive || (ap ? (activeHives(ap).sort(hiveSort)[0] || {}).id : '') || '';
      if (!hid) { var li = D.insp.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); })[0]; if (li && find('hives', li.hive) && find('hives', li.hive).status === 'active') hid = li.hive; }
      if (!hid) hid = (activeHives().sort(hiveSort)[0] || {}).id || '';
      var h0 = find('hives', hid);
      Object.assign(s, { ap: h0 ? h0.ap : ap, hive: hid, queen: 'seen', brood: 'good', stores: 'ok', temper: 'calm', probs: [] });
    } else if (kind === 'harvest') { Object.assign(s, { ap: ap || (D.apiaries[0] || {}).id || '', hive: opts.hive || '' }); }
    else if (kind === 'care') {
      var lastC = D.care.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); })[0];
      Object.assign(s, { ap: ap || (D.apiaries[0] || {}).id || '', hive: opts.hive || '', ctype: lastC ? lastC.type : 'feed', to: '' });
    }
    else if (kind === 'client') { s.date = undefined; }
    else if (kind === 'svc') { s.date = undefined; }
    else if (kind === 'doc') {
      var st = D.settings;
      Object.assign(s, { dtype: opts.dir === 'i' ? 'i' : 'q', client: opts.client || (D.clients.length ? '' : '__new'), n: 1, travelOn: !!st.travelDefault,
        km: '', kmRate: st.kmRate ? numIn(st.kmRate) : '', addVat: !!st.vat, cat: 'services_in', valid: addDays(today(), +st.quoteDays || 30), due: addDays(today(), +st.payDays || 7) });
      if (opts.copy) {
        var c = opts.copy;
        Object.assign(s, { client: c.client, job: c.job, site: c.site, notes: c.notes, cat: c.cat || 'services_in', addVat: !!c.vat, travelOn: !!c.travel,
          km: c.travel ? numIn(c.travel.km) : '', kmRate: c.travel ? numIn(c.travel.rate) : s.kmRate });
        setLines(s, c.lines);
      }
    }
    openSub('form', s);
  }
  function setLines(s, lines) {
    s.n = Math.max(1, lines.length);
    lines.forEach(function (l, i) { s['l' + i + 'd'] = l.d; s['l' + i + 'q'] = numIn(l.q); s['l' + i + 'p'] = numIn(l.p); });
  }
  function openEdit(kind, id) {
    if (kind === 'svc') {
      var sv = D.settings.svcs.filter(function (x) { return x.id === id; })[0];
      if (sv) openSub('form', { kind: 'svc', id: id, name: sv.name, price: numIn(sv.price || '') });
      return;
    }
    var x = find(COLL[kind], id);
    if (!x) return;
    var s = { kind: kind, id: id, date: x.date };
    if (kind === 'money') Object.assign(s, { dir: x.dir, amt: numIn(x.amt), cat: x.cat, desc: x.desc, party: x.party, ref: x.ref, vatIncl: !!x.vat,
      photo: x.photo || '', photoLater: !!x.photoLater, docLink: x.doc || '' });
    else if (kind === 'recur') Object.assign(s, { dir: x.dir, amt: numIn(x.amt), cat: x.cat, desc: x.desc, party: x.party, vatIncl: !!x.vatIncl, day: String(x.day), on: x.on !== false });
    else if (kind === 'fuel') Object.assign(s, { fkind: x.kind, l: numIn(x.l), amt: numIn(x.amt), use: x.use, mach: x.mach, sup: x.sup, ref: x.ref, vatIncl: !!x.vat,
      photo: x.photo || '', photoLater: !!x.photoLater });
    else if (kind === 'diary') Object.assign(s, { text: x.text, tags: (x.tags || []).slice() });
    else if (kind === 'apiary') Object.assign(s, { name: x.name, akind: x.kind, place: x.place, gps: x.gps, contact: x.contact, phone: x.phone, notes: x.notes });
    else if (kind === 'hive') Object.assign(s, { ap: x.ap, no: x.no, htype: x.type, source: x.source, status: x.status, ended: x.ended || '', queenYear: x.queenYear, queenMark: x.queenMark, notes: x.notes });
    else if (kind === 'insp') { var h0 = find('hives', x.hive); Object.assign(s, { ap: h0 ? h0.ap : '', hive: x.hive, queen: x.queen, brood: x.brood, stores: x.stores, temper: x.temper, frames: numIn(x.frames || ''), probs: (x.probs || []).slice(), notes: x.notes, next: x.next || '' }); }
    else if (kind === 'harvest') Object.assign(s, { ap: x.ap, hive: x.hive || '', kg: numIn(x.kg || ''), wax: numIn(x.wax || ''), frames: numIn(x.frames || ''), notes: x.notes });
    else if (kind === 'care') Object.assign(s, { ap: x.ap, hive: x.hive || '', ctype: x.type, product: x.product, qty: x.qty, next: x.next || '', to: x.to || '', notes: x.notes });
    else if (kind === 'client') Object.assign(s, { name: x.name, phone: x.phone, email: x.email, addr: x.addr, vatNo: x.vatNo, notes: x.notes });
    else if (kind === 'doc') {
      Object.assign(s, { dtype: x.type, client: x.client, job: x.job, site: x.site, notes: x.notes, cat: x.cat || 'services_in', addVat: !!x.vat,
        travelOn: !!x.travel, km: x.travel ? numIn(x.travel.km) : '', kmRate: x.travel ? numIn(x.travel.rate) : numIn(D.settings.kmRate || ''),
        valid: x.valid || '', due: x.due || '' });
      setLines(s, x.lines);
    }
    openSub('form', s);
  }
  function payForm(docId, payId) {
    var d = find('docs', docId);
    if (!d) return;
    var p = payId ? (d.pays || []).filter(function (x) { return x.id === payId; })[0] : null;
    openSub('form', p ? { kind: 'pay', doc: d.id, pid: p.id, date: p.date, amt: numIn(p.amt), method: p.method || 'eft' }
      : { kind: 'pay', doc: d.id, date: today(), amt: numIn(docTotals(d).bal), method: 'eft' });
  }

  var FORMS = {};
  function formScreen() {
    var k = F.kind, h = '<div class="card form">';
    h += FORMS[k]();
    h += msg('err', F.err);
    h += '<div class="stack" style="margin-top:22px"><button class="primary" data-act="saveForm">' + esc(t(k === 'doc' && !F.id ? 'save_doc_' + F.dtype : 'save')) + '</button>';
    if (F.id || F.pid) h += confirmBtn('del', 'deleteForm', k === 'recur' ? t('delete_rule') : t('delete'), F.delAgain || t('delete_again'));
    else h += '<button class="text" data-act="close">' + esc(t('cancel')) + '</button>';
    h += '</div></div>';
    if (F.after) h = msg('info', F.after) + h;
    app.innerHTML = h;
    if (F.photo && !F.photoSrc) photoUrl(F.photo).then(function (u) { if (u && V === 'form' && F) { F.photoSrc = u; render(); } });
    var first = app.querySelector('[data-focus]');
    if (first && !F.id && window.matchMedia('(min-width: 900px)').matches) first.focus();
  }

  // Slip photo block for money & fuel purchases
  function photoBlock() {
    if (useLS) return '';
    var h = '<div class="fw"><label class="f">' + esc(t('slip_photo')) + '</label>';
    if (F.photoSrc && !F.photoRemoved) {
      h += '<div class="photo"><img src="' + F.photoSrc + '" alt="' + esc(t('slip_photo')) + '" data-act="viewPhoto"></div>' +
        '<div class="two" style="margin-top:8px"><label class="btn secondary small wide" for="camIn">' + ico(IC.cam, 18) + esc(t('retake')) + '</label>' +
        '<button class="text danger" data-act="rmPhoto">' + esc(t('remove_photo')) + '</button></div>';
    } else {
      h += '<div class="two"><label class="btn secondary" for="camIn">' + ico(IC.cam, 20) + esc(t('take_photo')) + '</label>' +
        '<label class="btn secondary" for="galIn">' + ico(IC.image, 20) + esc(t('choose_photo')) + '</label></div>' +
        '<div style="margin-top:12px">' + check('photoLater', t('photo_later')) + '</div>';
    }
    h += '<input type="file" accept="image/*" capture="environment" id="camIn" class="hidden"><input type="file" accept="image/*" id="galIn" class="hidden">';
    return h + '</div>';
  }
  function nextChips() {
    return '<div class="chips">' + [7, 14, 21, 30].map(function (n) {
      return '<button type="button" class="chip' + (F.next === addDays(F.date || today(), n) ? ' on' : '') + '" data-act="nextIn" data-v="' + n + '">' + esc(t('in_days', { n: n })) + '</button>';
    }).join('') + '</div>';
  }

  FORMS.money = function () { return moneyForm(); };
  FORMS.recur = function () { return moneyForm(); };
  function moneyForm() {
    var rec = F.kind === 'recur';
    var cats = catsFor(F.dir, F.cat).map(function (c) { return [c, catLabel(c)]; }).concat([['__new', t('new_category')]]);
    var amtN = num(F.amt), days = [];
    for (var d = 1; d <= 28; d++) days.push([String(d), String(d)]);
    var h = '';
    if (F.docLink) { var dl = find('docs', F.docLink); if (dl) h += msg('info', esc(t('money_from_doc', { no: dl.no }))).replace('margin: 0 0 14px', ''); }
    h += seg('dir', [['in', t('income')], ['out', t('expense')]], 'big2') +
      '<div class="two">' + fld(t('amount'), inp('amt', { mode: 'decimal', ph: '0.00', cls: 'money', id: 'f-amt', focus: 1 })) +
      (rec ? fld(t('day_of_month'), sel('day', days)) : fld(t('date'), inp('date', { type: 'date' }))) + '</div>' +
      fld(t('category'), sel('cat', cats, true));
    if (F.cat === '__new') h += fld(t('new_category_name'), inp('newCat', { max: 40 }));
    h += fld(t('description'), inp('desc', { ph: t(rec ? 'desc_rec_ph' : F.dir === 'in' ? 'desc_in_ph' : 'desc_out_ph'), max: 120 }));
    var parties = uniq(D.money.slice().sort(byDateDesc).filter(function (m) { return m.dir === F.dir; }).map(function (m) { return m.party; }), 6);
    h += fld(t(F.dir === 'in' ? 'party_in' : 'party_out'), inp('party', { max: 80 }) + chips('party', parties));
    if (!rec) h += fld(t('reference'), inp('ref', { max: 40, ph: t('reference_ph') }));
    if (D.settings.vat) {
      h += '<div style="margin-top:16px">' + check('vatIncl', t('includes_vat', { r: D.settings.vatRate })) + '</div>' +
        '<div class="hint" id="live-vat">' + vatLine(amtN) + '</div>';
    }
    if (rec) {
      h += '<div style="margin-top:16px">' + check('on', t('repeat_on')) + '</div><div class="hint">' + esc(t('repeat_rule_hint')) + '</div>';
    } else {
      h += photoBlock();
      if (!F.id) h += '<div style="margin-top:16px">' + check('repeat', t('repeat_monthly')) + '</div>' +
        (F.repeat ? '<div class="hint">' + esc(t('repeat_monthly_hint', { d: Math.min(28, parseD(F.date || today()).getDate()) })) + '</div>' : '');
    }
    return h;
  }
  function vatLine(amtN) {
    if (!F.vatIncl) return esc(t('vat_none'));
    if (isNaN(amtN)) return '&nbsp;';
    var v = vatOf(amtN, true);
    return esc(t('vat_line', { v: fmtR(v), x: fmtR(amtN - v) }));
  }
  FORMS.fuel = function () {
    var lN = num(F.l), aN = num(F.amt);
    var mach = uniq(D.fuel.slice().sort(byDateDesc).map(function (f) { return f.mach; }), 6);
    var sup = uniq(D.fuel.slice().sort(byDateDesc).map(function (f) { return f.sup; }), 4);
    var h = seg('fkind', [['diesel', t('diesel')], ['petrol', t('petrol')]], 'big2') +
      '<div class="two">' + fld(t('litres'), inp('l', { mode: 'decimal', ph: '0', cls: 'money', id: 'f-l', focus: 1 })) +
      fld(t('total_paid'), inp('amt', { mode: 'decimal', ph: '0.00', cls: 'money', id: 'f-amt' })) + '</div>' +
      '<div class="hint" id="live-ppl">' + pplLine(lN, aN) + '</div>' +
      fld(t('date'), inp('date', { type: 'date' })) +
      fld(t('used_for'), seg('use', [['hives', t('use_hives')], ['jobs', t('use_jobs')], ['other', t('use_other')]], 'wrap3')) +
      fld(t('vehicle'), inp('mach', { max: 60, ph: t('vehicle_ph') }) + chips('mach', mach)) +
      fld(t('supplier'), inp('sup', { max: 60 }) + chips('sup', sup)) +
      fld(t('reference'), inp('ref', { max: 40, ph: t('reference_ph') }));
    if (D.settings.vat) h += '<div style="margin-top:16px">' + check('vatIncl', t('includes_vat', { r: D.settings.vatRate })) + '</div><div class="hint" id="live-vat">' + vatLine(aN) + '</div>';
    return h + photoBlock();
  };
  function pplLine(lN, aN) {
    if (isNaN(lN) || isNaN(aN) || !lN) return '&nbsp;';
    return esc(t('per_litre', { p: fmtR(aN / lN) }));
  }
  FORMS.diary = function () {
    return fld(t('date'), inp('date', { type: 'date' })) +
      fld(t('what_happened'), area('text', t('diary_ph'), 7, true)) +
      fld(t('tags'), multi('tags', TAGS, function (g) { return t('tag_' + g); }));
  };
  FORMS.apiary = function () {
    return fld(t('apiary_name'), inp('name', { max: 50, ph: t('apiary_name_ph'), focus: 1 })) +
      fld(t('apiary_kind'), seg('akind', AP_KINDS.map(function (k) { return [k, esc(t('ak_' + k))]; }), 'wrap3')) +
      fld(t('place'), inp('place', { max: 80, ph: t('place_ph') })) +
      fld(t('gps'), '<div class="yield" style="grid-template-columns:minmax(0,1fr) auto">' + inp('gps', { max: 40, ph: '-25.74, 28.19' }) +
        '<button type="button" class="secondary small" data-act="gps">' + ico(IC.pin, 18) + esc(t('here')) + '</button></div>', esc(t('gps_hint'))) +
      '<div class="two">' + fld(t('landowner'), inp('contact', { max: 60, ph: t('optional') })) + fld(t('phone'), inp('phone', { max: 20, mode: 'tel', ph: t('optional') })) + '</div>' +
      fld(t('notes'), area('notes', t('apiary_notes_ph'), 3));
  };
  var MARKS = { 1: 'white', 6: 'white', 2: 'yellow', 7: 'yellow', 3: 'red', 8: 'red', 4: 'green', 9: 'green', 5: 'blue', 0: 'blue' };
  FORMS.hive = function () {
    var yr = new Date().getFullYear(), years = [];
    for (var y = yr; y > yr - 4; y--) years.push(String(y));
    var mk = /^\d{4}$/.test(F.queenYear || '') ? MARKS[+F.queenYear.slice(-1)] : '';
    var h = '<div class="two">' + fld(t('hive_no'), inp('no', { max: 12, focus: 1 })) + fld(t('apiary'), sel('ap', apOpts())) + '</div>' +
      fld(t('hive_type'), seg('htype', HIVE_TYPES.map(function (k) { return [k, esc(t('ht_' + k))]; }), 'wrap3')) +
      fld(t('source'), seg('source', HIVE_SRC.map(function (k) { return [k, esc(t('hsrc_' + k))]; }), 'wrap3')) +
      fld(t('started'), inp('date', { type: 'date' })) +
      '<div class="two">' + fld(t('queen_year'), inp('queenYear', { max: 4, mode: 'numeric', ph: t('optional') }) + chips('queenYear', years)) +
      fld(t('queen_mark'), inp('queenMark', { max: 20, ph: t('optional') }) + (mk ? chips('queenMark', [t('mk_' + mk)]) : '')) + '</div>' +
      (mk ? '<div class="hint">' + esc(t('mark_hint', { y: F.queenYear, c: t('mk_' + mk).toLowerCase() })) + '</div>' : '');
    if (F.id) {
      h += fld(t('status'), seg('status', HIVE_STATUS.map(function (k) { return [k, esc(t('hs_' + k))]; }), 'wrap3'));
      if (F.status !== 'active') h += fld(t('ended'), inp('ended', { type: 'date' }));
    }
    return h + fld(t('notes'), area('notes', t('hive_notes_ph'), 3));
  };
  FORMS.insp = function () {
    var hs = hiveOpts(F.ap, '', F.hive);
    var h = '<div class="two">' + fld(t('apiary'), sel('ap', apOpts(t('all_apiaries')), true)) + fld(t('hive'), sel('hive', hs.length ? hs : [['', t('no_hives_here')]])) + '</div>' +
      fld(t('date'), inp('date', { type: 'date' })) +
      fld(t('queen'), seg('queen', [['seen', t('qs_seen')], ['eggs', t('qs_eggs')], ['no', t('qs_no')]], 'wrap3')) +
      fld(t('brood'), seg('brood', [['good', t('br_good')], ['patchy', t('br_patchy')], ['none', t('br_none')]], 'wrap3')) +
      fld(t('stores'), seg('stores', [['low', t('st_low')], ['ok', t('st_ok')], ['full', t('st_full')]], 'wrap3')) +
      fld(t('temper'), seg('temper', [['calm', t('tm_calm')], ['nervous', t('tm_nervous')], ['aggressive', t('tm_aggressive')]], 'wrap3')) +
      fld(t('frames_bees'), inp('frames', { mode: 'decimal', ph: t('optional'), max: 5 })) +
      fld(t('problems'), multi('probs', PROBS, function (p) { return t('pr_' + p); }), esc(t('problems_hint')));
    if ((F.probs || []).indexOf('afb') > -1) h += msg('err', ico(IC.alert, 18) + ' ' + esc(t('afb_warn')));
    if ((F.probs || []).indexOf('laying') > -1) h += msg('warn', ico(IC.alert, 18) + ' ' + esc(t('laying_warn')));
    h += fld(t('notes'), area('notes', t('insp_notes_ph'), 3)) +
      fld(t('next_insp'), inp('next', { type: 'date' }) + nextChips(), esc(t('next_hint')));
    return h;
  };
  FORMS.harvest = function () {
    return fld(t('apiary'), sel('ap', apOpts(), true)) +
      fld(t('from_hive'), sel('hive', hiveOpts(F.ap, t('whole_apiary'), F.hive))) +
      fld(t('date'), inp('date', { type: 'date' })) +
      '<div class="two">' + fld(t('honey_kg'), inp('kg', { mode: 'decimal', ph: '0', cls: 'money', focus: 1 })) + fld(t('wax_kg'), inp('wax', { mode: 'decimal', ph: '0', cls: 'money' })) + '</div>' +
      fld(t('frames_taken'), inp('frames', { mode: 'numeric', ph: t('optional') })) +
      fld(t('notes'), area('notes', t('harvest_notes_ph'), 2));
  };
  FORMS.care = function () {
    var prods = uniq(D.care.slice().sort(byDateDesc).filter(function (x) { return x.type === F.ctype; }).map(function (x) { return x.product; }), 8);
    var sugg = { feed: [t('sugar_syrup'), t('pollen_patty')], treat: [], super: [], requeen: [], split: [], move: [], other: [] }[F.ctype] || [];
    var h = fld(t('what_done'), seg('ctype', CARE_TYPES.map(function (k) { return [k, esc(t('ct_' + k))]; }), 'wrap3')) +
      '<div class="two">' + fld(t('apiary'), sel('ap', apOpts(), true)) + fld(t('hive'), sel('hive', hiveOpts(F.ap, t('all_hives'), F.hive))) + '</div>' +
      fld(t('date'), inp('date', { type: 'date' }));
    if (F.ctype === 'move') h += fld(t('move_to'), sel('to', apOpts(t('none_choose'))), esc(t('move_hint')));
    if (['feed', 'treat', 'other'].indexOf(F.ctype) > -1) h += fld(t(F.ctype === 'feed' ? 'feed_what' : 'product'), inp('product', { max: 60, ph: t(F.ctype === 'treat' ? 'treat_ph' : 'optional') }) + chips('product', uniq(prods.concat(sugg), 8)));
    if (['feed', 'treat'].indexOf(F.ctype) > -1) h += fld(t('how_much'), inp('qty', { max: 40, ph: t(F.ctype === 'feed' ? 'qty_feed_ph' : 'qty_treat_ph') }));
    if (F.ctype === 'split') h += '<div class="hint">' + esc(t('split_hint')) + '</div>';
    if (F.ctype === 'requeen') h += '<div class="hint">' + esc(t('requeen_hint')) + '</div>';
    h += fld(t('notes'), area('notes', t('optional'), 2)) +
      fld(t('next_due'), inp('next', { type: 'date' }) + nextChips(), esc(t('next_hint')));
    return h;
  };
  FORMS.client = function () {
    return fld(t('client_name'), inp('name', { max: 80, focus: 1 })) +
      '<div class="two">' + fld(t('phone'), inp('phone', { max: 20, mode: 'tel' })) + fld(t('email'), inp('email', { max: 80, type: 'email' })) + '</div>' +
      fld(t('address'), area('addr', t('address_ph'), 3)) +
      fld(t('client_vat'), inp('vatNo', { max: 20, ph: t('optional') }), esc(t('client_vat_hint'))) +
      fld(t('notes'), area('notes', t('optional'), 2));
  };
  FORMS.svc = function () {
    return fld(t('service_name'), inp('name', { max: 120, focus: 1 })) +
      fld(t(D.settings.vat ? 'price_excl' : 'price'), inp('price', { mode: 'decimal', ph: '0.00', cls: 'money' }), esc(t('service_price_hint')));
  };
  FORMS.pay = function () {
    var d = find('docs', F.doc), x = d ? docTotals(d) : { bal: 0 };
    var old = d && F.pid ? (d.pays || []).filter(function (p) { return p.id === F.pid; })[0] : null;
    var room = r2(x.bal + (old ? old.amt : 0));
    return msg('info', esc(t('pay_for', { no: d ? d.no : '', c: d ? clientName(d.client) : '', r: fmtR(room) }))).replace('margin: 0 0 14px', '') +
      '<div class="two">' + fld(t('amount_received'), inp('amt', { mode: 'decimal', ph: '0.00', cls: 'money', focus: 1 })) + fld(t('date'), inp('date', { type: 'date' })) + '</div>' +
      fld(t('pay_method'), seg('method', PAY_METHODS.map(function (k) { return [k, esc(t('pm_' + k))]; }), 'wrap3')) +
      '<div class="hint">' + esc(t('pay_money_hint')) + '</div>';
  };
  FORMS.doc = function () {
    var q = F.dtype === 'q', st = D.settings;
    var cl = [['', t('choose_client')]].concat(D.clients.slice().sort(byName).map(function (c) { return [c.id, c.name]; })).concat([['__new', t('new_client')]]);
    var h = '<div class="two">' + fld(t('date'), inp('date', { type: 'date' })) +
      (q ? fld(t('valid_until'), inp('valid', { type: 'date' })) : fld(t('due_date'), inp('due', { type: 'date' }))) + '</div>' +
      fld(t('client'), sel('client', cl, true));
    if (F.client === '__new') {
      h += '<div class="line">' + fld(t('client_name'), inp('cName', { max: 80, focus: 1 })) +
        '<div class="two">' + fld(t('phone'), inp('cPhone', { max: 20, mode: 'tel' })) + fld(t('email'), inp('cEmail', { max: 80, type: 'email' })) + '</div>' +
        fld(t('address'), area('cAddr', t('address_ph'), 2)) + '</div>';
    }
    var jobs = uniq(D.docs.slice().sort(byDateDesc).map(function (d) { return d.job; }), 5);
    h += fld(t('job'), inp('job', { max: 100, ph: t('job_ph') }) + chips('job', jobs)) +
      fld(t('site'), inp('site', { max: 120, ph: t('site_ph') }));
    h += '<label class="f">' + esc(t(st.vat && F.addVat ? 'items_excl' : 'items')) + '</label>';
    for (var i = 0; i < F.n; i++) {
      h += '<div class="line"><div class="lhead"><b>' + esc(t('item_n', { n: i + 1 })) + '</b>' +
        (F.n > 1 ? '<button type="button" class="text small danger" data-act="rmLine" data-i="' + i + '">' + esc(t('remove')) + '</button>' : '') + '</div>' +
        fld(t('description'), inp('l' + i + 'd', { max: 200, ph: t('line_ph') })) +
        '<div class="qtyp">' + fld(t('qty'), inp('l' + i + 'q', { mode: 'decimal', ph: '1' })) + fld(t('unit_price'), inp('l' + i + 'p', { mode: 'decimal', ph: '0.00' })) +
        '<div class="lt" id="live-l' + i + '">' + esc(fmtR(lineVal(i))) + '</div></div></div>';
    }
    var sv = st.svcs;
    h += '<div class="hint" style="margin-top:12px">' + esc(t(sv.length ? 'add_from_services' : 'no_services_yet')) + '</div><div class="chips">' + sv.map(function (s) {
      return '<button type="button" class="chip" data-act="addSvc" data-id="' + esc(s.id) + '">+ ' + esc(s.name) + (s.price ? ' · ' + esc(fmtR(s.price)) : '') + '</button>';
    }).join('') + '<button type="button" class="chip" data-act="addLine">+ ' + esc(t('blank_line')) + '</button></div>';
    h += '<div style="margin-top:18px">' + check('travelOn', t('charge_travel')) + '</div>';
    if (F.travelOn) h += '<div class="two">' + fld(t('km'), inp('km', { mode: 'decimal', ph: '0' })) + fld(t('rate_per_km'), inp('kmRate', { mode: 'decimal', ph: '0.00' })) + '</div>' +
      '<div class="hint">' + esc(t('travel_hint')) + '</div>';
    if (st.vat || F.addVat) h += '<div style="margin-top:16px">' + check('addVat', t('add_vat', { r: st.vatRate })) + '</div>';
    if (!q) h += fld(t('income_cat'), sel('cat', catsFor('in', F.cat).map(function (c) { return [c, catLabel(c)]; })), esc(t('income_cat_hint')));
    h += fld(t('doc_notes'), area('notes', t('doc_notes_ph'), 3));
    h += '<div class="totals card" style="margin:16px 0 0;background:var(--soft);border:0" id="live-tot">' + totalsHtml() + '</div>';
    return h;
  };
  function lineVal(i) { var q = F['l' + i + 'q'] === '' || F['l' + i + 'q'] == null ? 1 : num(F['l' + i + 'q']), p = num(F['l' + i + 'p']); return isNaN(q) || isNaN(p) ? 0 : r2(q * p); }
  function totalsHtml() {
    var sub = 0;
    for (var i = 0; i < F.n; i++) sub += lineVal(i);
    if (F.travelOn) { var km = num(F.km), rt = num(F.kmRate); if (!isNaN(km) && !isNaN(rt)) sub += r2(km * rt); }
    sub = r2(sub);
    var vat = F.addVat ? r2(sub * vatRate() / 100) : 0;
    return (F.addVat ? '<div class="row"><span>' + esc(t('subtotal')) + '</span><b>' + esc(fmtR(sub)) + '</b></div><div class="row"><span>' + esc(t('vat_pct', { r: D.settings.vatRate })) + '</span><b>' + esc(fmtR(vat)) + '</b></div>' : '') +
      '<div class="row big"><span>' + esc(t('total')) + '</span><span>' + esc(fmtR(sub + vat)) + '</span></div>';
  }
  function addLine(d, p) {
    var i = F.n - 1;
    var lastEmpty = !clean(F['l' + i + 'd']) && !clean(F['l' + i + 'p']);
    if (!lastEmpty) { F.n++; i = F.n - 1; }
    F['l' + i + 'd'] = d || ''; F['l' + i + 'q'] = d ? '1' : ''; F['l' + i + 'p'] = p ? numIn(p) : '';
  }
  function rmLine(i) {
    for (var j = i; j < F.n - 1; j++) ['d', 'q', 'p'].forEach(function (c) { F['l' + j + c] = F['l' + (j + 1) + c]; });
    ['d', 'q', 'p'].forEach(function (c) { delete F['l' + (F.n - 1) + c]; });
    F.n = Math.max(1, F.n - 1);
  }

  /* Save ---------------------------------------------------------------- */
  function saveForm() {
    var k = F.kind;
    if (k === 'svc') return saveSvc();
    if (k === 'pay') return savePay();
    var rec = { id: F.id || uid(), ts: Date.now() }, e = '';
    var old = F.id ? find(COLL[k], F.id) : null;
    if (old) rec.ts = old.ts || rec.ts;
    if (['apiary', 'client', 'recur'].indexOf(k) < 0) { if (!F.date) e = t('err_date'); rec.date = F.date; }
    var extra = [], after = null;

    if (k === 'money' || k === 'recur') {
      var a = num(F.amt);
      if (isNaN(a) || a <= 0) e = t('err_amount');
      var cat = F.cat;
      if (cat === '__new') {
        var name = clean(F.newCat, 40);
        if (!name) e = t('err_newcat');
        else {
          cat = 'c:' + name;
          var list = D.settings.cats[F.dir];
          if (!list.some(function (n) { return n.toLowerCase() === name.toLowerCase(); })) list.push(name);
        }
      }
      Object.assign(rec, { dir: F.dir, amt: r2(a), cat: cat, desc: clean(F.desc, 120), party: clean(F.party, 80) });
      if (k === 'money') {
        Object.assign(rec, { ref: clean(F.ref, 40), vat: D.settings.vat ? vatOf(r2(a), !!F.vatIncl) : 0 });
        if (old && old.rid) rec.rid = old.rid;
        if (old && old.doc) { rec.doc = old.doc; rec.pay = old.pay; }
      } else {
        var day = Math.max(1, Math.min(28, +F.day || 1)), cur = today().slice(0, 7);
        Object.assign(rec, { vatIncl: !!F.vatIncl, day: day, on: !!F.on,
          last: old ? old.last : (day < new Date().getDate() ? cur : addMonths(cur, -1)) });
      }
    } else if (k === 'fuel') {
      var l = num(F.l), amt = num(F.amt);
      if (isNaN(l) || l <= 0) e = t('err_litres');
      else if (isNaN(amt) || amt < 0) e = t('err_amount');
      Object.assign(rec, { kind: F.fkind, l: r2(l), amt: r2(amt), use: F.use, mach: clean(F.mach, 60), sup: clean(F.sup, 60), ref: clean(F.ref, 40),
        vat: D.settings.vat ? vatOf(r2(amt), !!F.vatIncl) : 0 });
    } else if (k === 'diary') {
      var tx = String(F.text || '').replace(/\r/g, '').trim().slice(0, 5000);
      if (!tx) e = t('err_text');
      Object.assign(rec, { text: tx, tags: (F.tags || []).slice() });
    } else if (k === 'apiary') {
      var an = clean(F.name, 50);
      if (!an) e = t('err_name');
      else if (D.apiaries.some(function (x) { return x.id !== rec.id && x.name.toLowerCase() === an.toLowerCase(); })) e = t('err_apiary_dup');
      Object.assign(rec, { name: an, kind: F.akind || 'outyard', place: clean(F.place, 80), gps: clean(F.gps, 40), contact: clean(F.contact, 60), phone: clean(F.phone, 20), notes: cleanMulti(F.notes, 500) });
    } else if (k === 'hive') {
      var no = clean(F.no, 12);
      if (!no) e = t('err_hive_no');
      else if (!F.ap) e = t('err_apiary');
      else if (F.status === 'active' && D.hives.some(function (x) { return x.id !== rec.id && x.status === 'active' && String(x.no).toLowerCase() === no.toLowerCase(); })) e = t('err_hive_dup', { n: no });
      else if (F.queenYear && !/^\d{4}$/.test(F.queenYear)) e = t('err_year');
      Object.assign(rec, { no: no, ap: F.ap, type: F.htype || 'lang', source: F.source || 'other', status: F.status || 'active', queenYear: clean(F.queenYear, 4), queenMark: clean(F.queenMark, 20),
        ended: F.status && F.status !== 'active' ? (F.ended || today()) : '', notes: cleanMulti(F.notes, 500) });
    } else if (k === 'insp') {
      var fr = F.frames ? num(F.frames) : 0;
      if (!F.hive || !find('hives', F.hive)) e = t('err_hive');
      else if (isNaN(fr) || fr < 0 || fr > 100) e = t('err_frames');
      else if (F.next && F.next < F.date) e = t('err_next');
      Object.assign(rec, { hive: F.hive, queen: F.queen, brood: F.brood, stores: F.stores, temper: F.temper, frames: fr || 0, probs: (F.probs || []).slice(), notes: cleanMulti(F.notes, 500), next: F.next || '' });
    } else if (k === 'harvest') {
      var kg = F.kg ? num(F.kg) : 0, wax = F.wax ? num(F.wax) : 0, frm = F.frames ? num(F.frames) : 0;
      if (!F.ap) e = t('err_apiary');
      else if (isNaN(kg) || kg < 0 || isNaN(wax) || wax < 0) e = t('err_kg');
      else if (!kg && !wax) e = t('err_kg');
      else if (isNaN(frm) || frm < 0) e = t('err_frames');
      Object.assign(rec, { ap: F.ap, hive: F.hive || '', kg: r2(kg || 0), wax: r2(wax || 0), frames: frm || 0, notes: cleanMulti(F.notes, 300) });
    } else if (k === 'care') {
      if (!F.ap) e = t('err_apiary');
      else if (F.ctype === 'move' && (!F.to || F.to === F.ap)) e = t('err_move');
      else if (F.next && F.next < F.date) e = t('err_next');
      Object.assign(rec, { ap: F.ap, hive: F.hive || '', type: F.ctype, product: clean(F.product, 60), qty: clean(F.qty, 40), to: F.ctype === 'move' ? F.to : '', next: F.next || '', notes: cleanMulti(F.notes, 300) });
    } else if (k === 'client') {
      if (!clean(F.name)) e = t('err_client_name');
      Object.assign(rec, { name: clean(F.name, 80), phone: clean(F.phone, 20), email: clean(F.email, 80), addr: cleanMulti(F.addr, 300), vatNo: clean(F.vatNo, 20), notes: cleanMulti(F.notes, 500) });
    } else if (k === 'doc') {
      var res = collectDoc(old);
      e = e || res.e; rec = Object.assign(res.rec, { id: rec.id, ts: rec.ts, date: F.date });
      if (res.client) extra.push(['client', res.client]);
    }
    if (e) { F.err = esc(e); render(); return; }

    // slip photo
    if (k === 'money' || k === 'fuel') {
      var oldPhoto = old ? old.photo || '' : '';
      rec.photo = F.photoRemoved ? '' : oldPhoto;
      if (F.newPhoto) {
        var pid = 'p' + uid();
        rec.photo = pid;
        photoPut(pid, F.newPhoto).catch(function () { toast(t('err_photo_save')); });
        photoUrls[pid] = F.photoSrc;
      }
      if (oldPhoto && oldPhoto !== rec.photo) photoDel(oldPhoto);
      rec.photoLater = !rec.photo && !!F.photoLater;
    }

    extra.forEach(function (x) { upsert(COLL[x[0]], x[1]); });
    if (k === 'doc' && !old) rec.no = nextNo(rec.type);
    upsert(COLL[k], rec);

    // follow-ups
    if (k === 'money' && F.repeat && !F.id) {
      D.recur.push({ id: uid(), ts: Date.now(), dir: rec.dir, amt: rec.amt, cat: rec.cat, desc: rec.desc, party: rec.party,
        vatIncl: !!F.vatIncl, day: Math.min(28, parseD(rec.date).getDate()), on: true, last: rec.date.slice(0, 7) });
      rec.rid = D.recur[D.recur.length - 1].id;
    }
    if (k === 'money' && rec.doc) {   // keep the invoice payment in step
      var dd = find('docs', rec.doc), pp = dd && (dd.pays || []).filter(function (p) { return p.id === rec.pay; })[0];
      if (pp) { pp.amt = rec.amt; pp.date = rec.date; }
    }
    if (k === 'care' && rec.type === 'move' && !old) {
      var moved = rec.hive ? [find('hives', rec.hive)] : activeHives(rec.ap);
      moved.forEach(function (x) { if (x) x.ap = rec.to; });
    }
    if (k === 'care' && rec.type === 'requeen' && rec.hive && !old) {
      var hq = find('hives', rec.hive);
      if (hq) { hq.queenYear = rec.date.slice(0, 4); hq.queenMark = ''; }
    }
    if (k === 'care' && rec.type === 'split' && !old) after = { kind: 'hive', ap: rec.ap };
    save();
    toast(t('saved'));
    if (k === 'doc') { if (!old) LS.docs.f = 'all'; goView('doc', { id: rec.id }); return; }
    if (after) {
      var back = F.back;
      openNew('hive', { ap: after.ap, source: 'split' });
      F.after = esc(t('split_new_hive')); F.back = back; render();
      return;
    }
    closeSub();
  }
  function collectDoc(old) {
    var e = '', lines = [], q = F.dtype === 'q';
    for (var i = 0; i < F.n; i++) {
      var d = clean(F['l' + i + 'd'], 200), qs = clean(F['l' + i + 'q']), ps = clean(F['l' + i + 'p']);
      if (!d && !ps && !qs) continue;
      var qn = qs ? num(qs) : 1, pn = num(ps);
      if (!d) e = e || t('err_line_desc', { n: i + 1 });
      else if (isNaN(qn) || qn <= 0) e = e || t('err_line_qty', { n: i + 1 });
      else if (isNaN(pn) || pn < 0) e = e || t('err_line_price', { n: i + 1 });
      lines.push({ d: d, q: Math.round(qn * 100) / 100, p: r2(pn || 0) });
    }
    if (!lines.length) e = e || t('err_lines');
    var client = null, cid = F.client;
    if (cid === '__new') {
      var nm = clean(F.cName, 80);
      if (!nm) e = e || t('err_client_name');
      else {
        var same = D.clients.filter(function (c) { return c.name.toLowerCase() === nm.toLowerCase(); })[0];
        if (same) cid = same.id;
        else { client = { id: uid(), ts: Date.now(), name: nm, phone: clean(F.cPhone, 20), email: clean(F.cEmail, 80), addr: cleanMulti(F.cAddr, 300), vatNo: '', notes: '' }; cid = client.id; }
      }
    } else if (!cid || !find('clients', cid)) e = e || t('err_client');
    var travel = null;
    if (F.travelOn) {
      var km = num(F.km), rt = num(F.kmRate);
      if (isNaN(km) || km <= 0) e = e || t('err_km');
      else if (isNaN(rt) || rt < 0) e = e || t('err_km_rate');
      else { travel = { km: Math.round(km * 10) / 10, rate: r2(rt) }; if (!D.settings.kmRate) D.settings.kmRate = r2(rt); }
    }
    if (q && F.valid && F.valid < F.date) e = e || t('err_valid');
    if (!q && F.due && F.due < F.date) e = e || t('err_due');
    if (!e) lines.forEach(function (l) {   // learn prices for services that have none yet
      D.settings.svcs.forEach(function (s) { if (!s.price && l.p && s.name.toLowerCase() === l.d.toLowerCase()) s.price = l.p; });
    });
    var rec = { type: F.dtype, no: old ? old.no : '', client: cid, job: clean(F.job, 100), site: clean(F.site, 120), lines: lines, travel: travel,
      vat: !!F.addVat, vatRate: vatRate(), notes: cleanMulti(F.notes, 800), status: old ? old.status : 'draft', pays: old ? old.pays || [] : [],
      from: old ? old.from || '' : (F.from || ''), inv: old ? old.inv || '' : '', sent: old ? old.sent || '' : '' };
    if (q) rec.valid = F.valid || ''; else { rec.due = F.due || ''; rec.cat = F.cat || 'services_in'; }
    if (!q && old && old.cat && old.cat !== rec.cat) D.money.forEach(function (m) { if (m.doc === old.id) m.cat = rec.cat; });
    return { e: e, rec: rec, client: client };
  }
  function saveSvc() {
    var name = clean(F.name, 120), p = clean(F.price) ? num(F.price) : 0;
    if (!name) { F.err = esc(t('err_name')); return render(); }
    if (isNaN(p) || p < 0) { F.err = esc(t('err_amount')); return render(); }
    var list = D.settings.svcs, x = F.id ? list.filter(function (s) { return s.id === F.id; })[0] : null;
    if (x) { x.name = name; x.price = r2(p); } else list.push({ id: uid(), name: name, price: r2(p) });
    save(); toast(t('saved')); closeSub();
  }
  function savePay() {
    var d = find('docs', F.doc);
    if (!d) return closeSub();
    var a = num(F.amt), x = docTotals(d), old = F.pid ? d.pays.filter(function (p) { return p.id === F.pid; })[0] : null;
    var room = r2(x.bal + (old ? old.amt : 0));
    if (isNaN(a) || a <= 0) { F.err = esc(t('err_amount')); return render(); }
    if (a > room + 0.005) { F.err = esc(t('err_overpay', { r: fmtR(room) })); return render(); }
    if (!F.date) { F.err = esc(t('err_date')); return render(); }
    var vat = d.vat ? r2(a * (d.vatRate || 15) / (100 + (d.vatRate || 15))) : 0;
    if (old) {
      old.amt = r2(a); old.date = F.date; old.method = F.method;
      var m = find('money', old.mid);
      if (m) { m.amt = r2(a); m.date = F.date; m.vat = vat; }
    } else {
      var pay = { id: uid(), date: F.date, amt: r2(a), method: F.method || 'eft', mid: uid() };
      (d.pays = d.pays || []).push(pay);
      D.money.push({ id: pay.mid, ts: Date.now(), date: F.date, dir: 'in', amt: pay.amt, cat: d.cat || 'services_in', desc: t('pay_desc', { no: d.no, job: d.job || '' }).replace(/ – $/, ''),
        party: clientName(d.client), ref: d.no, vat: vat, doc: d.id, pay: pay.id });
      if (d.status === 'draft') d.status = 'sent';
    }
    save();
    toast(docTotals(d).bal <= 0.005 ? t('paid_in_full') : t('saved'));
    closeSub();
  }
  function upsert(coll, rec) {
    var list = D[coll], i = list.findIndex(function (r) { return r.id === rec.id; });
    if (i > -1) list[i] = rec; else list.push(rec);
  }

  /* Delete -------------------------------------------------------------- */
  function deleteForm() {
    var k = F.kind;
    if (k === 'svc') {
      if (confirmKey !== 'del') { confirmKey = 'del'; return render(); }
      D.settings.svcs = D.settings.svcs.filter(function (s) { return s.id !== F.id; });
      save(); toast(t('deleted')); return closeSub();
    }
    if (k === 'pay') {
      if (confirmKey !== 'del') { confirmKey = 'del'; return render(); }
      var d = find('docs', F.doc), p = d && d.pays.filter(function (x) { return x.id === F.pid; })[0];
      if (p) { d.pays = d.pays.filter(function (x) { return x !== p; }); D.money = D.money.filter(function (m) { return m.id !== p.mid; }); }
      save(); toast(t('deleted')); return closeSub();
    }
    var coll = COLL[k], x = find(coll, F.id);
    if (k === 'apiary' && D.hives.some(function (h) { return h.ap === F.id; })) { F.err = esc(t('err_apiary_used')); return render(); }
    if (k === 'client' && D.docs.some(function (dd) { return dd.client === F.id; })) { F.err = esc(t('err_client_used')); return render(); }
    if (k === 'doc' && x && (x.pays || []).length) F.delAgain = t('delete_doc_again', { n: x.pays.length });
    if (k === 'hive') { var n = D.insp.filter(function (r) { return r.hive === F.id; }).length; if (n) F.delAgain = t('delete_hive_again', { n: n }); }
    if (confirmKey !== 'del') { confirmKey = 'del'; return render(); }
    D[coll] = D[coll].filter(function (r) { return r.id !== F.id; });
    if (x && x.photo) photoDel(x.photo);
    if (k === 'money' && x && x.doc) { var dd = find('docs', x.doc); if (dd) dd.pays = (dd.pays || []).filter(function (p) { return p.mid !== x.id; }); }
    if (k === 'doc' && x) {
      var mids = (x.pays || []).map(function (p) { return p.mid; });
      D.money = D.money.filter(function (m) { return mids.indexOf(m.id) < 0; });
      D.docs.forEach(function (o) { if (o.inv === x.id) o.inv = ''; if (o.from === x.id) o.from = ''; });
    }
    if (k === 'hive') {
      D.insp = D.insp.filter(function (r) { return r.hive !== F.id; });
      D.harvests.forEach(function (r) { if (r.hive === F.id) r.hive = ''; });
      D.care.forEach(function (r) { if (r.hive === F.id) r.hive = ''; });
    }
    save(); toast(t('deleted'));
    closeSub();
  }

  /* Repeating entries: add any that are due (runs when the app opens) */
  function runRecurring() {
    var cur = today().slice(0, 7), dnow = new Date().getDate(), added = 0;
    D.recur.forEach(function (r) {
      if (!r.on) return;
      var m = addMonths(r.last || addMonths(cur, -1), 1), guard = 0;
      while (m <= cur && guard++ < 60) {
        if (m === cur && r.day > dnow) break;
        D.money.push({ id: uid(), ts: Date.now() + added, date: m + '-' + pad(r.day), dir: r.dir, amt: r.amt, cat: r.cat, desc: r.desc, party: r.party,
          ref: '', vat: D.settings.vat ? vatOf(r.amt, !!r.vatIncl) : 0, rid: r.id });
        r.last = m; added++;
        m = addMonths(m, 1);
      }
    });
    if (added) { save(); toast(t('recur_added', { n: added })); }
    return added;
  }

  /* Quote / invoice actions -------------------------------------------- */
  function setDocStatus(v) {
    var d = find('docs', F.id);
    if (!d) return;
    d.status = v;
    if (v === 'sent' && !d.sent) d.sent = today();
    save(); toast(t('ds_' + v)); render();
  }
  function toInvoice() {
    var q = find('docs', F.id);
    if (!q) return;
    var inv = { id: uid(), ts: Date.now(), type: 'i', no: nextNo('i'), date: today(), client: q.client, job: q.job, site: q.site,
      lines: JSON.parse(JSON.stringify(q.lines)), travel: q.travel ? Object.assign({}, q.travel) : null, vat: q.vat, vatRate: q.vatRate,
      due: addDays(today(), +D.settings.payDays || 7), cat: 'services_in', notes: '', status: 'draft', pays: [], from: q.id, inv: '', sent: '' };
    D.docs.push(inv);
    q.inv = inv.id; q.status = 'accepted';
    save(); toast(t('invoice_made', { no: inv.no }));
    goView('doc', { id: inv.id });
  }

  /* Quote / invoice PDF ------------------------------------------------- */
  function buildDocPdf(d) {
    var s = D.settings, x = docTotals(d), c = find('clients', d.client) || {}, q = d.type === 'q';
    var P = FX.PDF, ACC = P.ACCENT, MUT = P.MUTED, INK = P.INK;
    var doc = new P({ footer: [s.biz || s.owner, s.phone, s.email].filter(Boolean).join('  ·  '), pageLabel: t('page') });
    var M = doc.M, W = doc.W, top = M, ly = top;
    if (s.logo && s.logoW && s.logoH) {
      var k = Math.min(170 / s.logoW, 72 / s.logoH), lw = s.logoW * k, lh = s.logoH * k;
      doc.image(s.logo, s.logoW, s.logoH, M, top, lw, lh);
      ly = top + lh + 10;
    }
    doc.text(W - M, top + 22, docTitle(d).toUpperCase(), 22, true, ACC, 'r');
    var ry = top + 44;
    [[t(q ? 'quote_no' : 'invoice_no'), d.no], [t('date'), shortDate(d.date)], q ? [t('valid_until'), shortDate(d.valid)] : [t('due_date'), shortDate(d.due)]].forEach(function (r) {
      if (!r[1]) return;
      doc.text(W - M - 96, ry, r[0], 9.5, false, MUT, 'r');
      doc.text(W - M, ry, r[1], 9.5, true, INK, 'r');
      ry += 14;
    });
    var biz = [[s.biz || s.owner, 12, true]];
    if (s.biz && s.owner) biz.push([s.owner, 9.5]);
    String(s.addr || '').split('\n').forEach(function (a) { if (clean(a)) biz.push([a, 9.5]); });
    if (s.phone) biz.push([t('tel') + ' ' + s.phone, 9.5]);
    if (s.email) biz.push([s.email, 9.5]);
    if (s.vat && s.vatNo) biz.push([t('vat_no') + ' ' + s.vatNo, 9.5]);
    if (s.regNo) biz.push([t('reg_no_short') + ' ' + s.regNo, 9.5]);
    biz.forEach(function (b) { doc.text(M, ly + 11, b[0], b[1], !!b[2], b[2] ? INK : MUT, 'l', 280); ly += b[1] > 10 ? 16 : 13; });
    doc.y = Math.max(ly, ry) + 10;
    doc.hline(M, W - M, doc.y, ACC, 1.2);
    doc.y += 18;
    var y0 = doc.y, half = (W - 2 * M) / 2;
    doc.text(M, y0, t(q ? 'quote_for' : 'bill_to').toUpperCase(), 8.5, true, MUT);
    var cy = y0 + 16;
    doc.text(M, cy, c.name || '?', 11, true, INK, 'l', half - 10); cy += 15;
    String(c.addr || '').split('\n').forEach(function (a) { if (clean(a)) { doc.text(M, cy, a, 9.5, false, INK, 'l', half - 10); cy += 13; } });
    [c.phone, c.email, c.vatNo ? t('vat_no') + ' ' + c.vatNo : ''].forEach(function (a) { if (a) { doc.text(M, cy, a, 9.5, false, MUT, 'l', half - 10); cy += 13; } });
    var jy = y0;
    if (d.job || d.site) {
      doc.text(M + half + 10, jy, t('job').toUpperCase(), 8.5, true, MUT); jy += 16;
      if (d.job) P.wrap(d.job, half - 10, 10, true).forEach(function (l) { doc.text(M + half + 10, jy, l, 10, true, INK); jy += 13; });
      if (d.site) P.wrap(d.site, half - 10, 9.5, false).forEach(function (l) { doc.text(M + half + 10, jy, l, 9.5, false, MUT); jy += 13; });
    }
    doc.y = Math.max(cy, jy) + 10;
    var rows = d.lines.map(function (l) { return [l.d, fmtQ(l.q), fmtR(l.p), fmtR(r2(l.q * l.p))]; });
    if (d.travel) rows.push([t('travel_line', { km: fmtQ(d.travel.km) }), fmtQ(d.travel.km), fmtR(d.travel.rate), fmtR(r2(d.travel.km * d.travel.rate))]);
    doc.table([{ h: t('description'), wrap: true }, { h: t('qty'), w: 50, a: 'r' }, { h: t(d.vat ? 'unit_price_excl' : 'unit_price'), w: 92, a: 'r' }, { h: t('amount_r'), w: 96, a: 'r' }], rows, { size: 9.5 });
    function trow(label, val, bold) {
      doc.ensure(18);
      doc.text(W - M - 110, doc.y + 11, label, bold ? 11 : 9.5, !!bold, bold ? INK : MUT, 'r');
      doc.text(W - M, doc.y + 11, val, bold ? 11 : 9.5, !!bold, INK, 'r');
      doc.y += bold ? 19 : 15;
    }
    doc.y -= 4;
    if (d.vat) { trow(t('subtotal'), fmtR(x.sub)); trow(t('vat_pct', { r: fmtNum(d.vatRate || 15, (d.vatRate || 15) % 1 ? 1 : 0) }), fmtR(x.vat)); }
    doc.hline(W - M - 240, W - M, doc.y + 2, INK, 0.8); doc.y += 5;
    trow(t('total'), fmtR(x.total), true);
    if (!q && x.paid) { trow(t('paid'), fmtR(x.paid)); trow(t('balance_due'), fmtR(x.bal), true); }
    if (q && Number(s.deposit) > 0) trow(t('deposit_line', { p: s.deposit }), fmtR(r2(x.total * s.deposit / 100)));
    doc.y += 8;
    if (s.bankAcc) {
      doc.heading(t('banking_details'));
      doc.kv([[t('bank'), s.bankName], [t('acc_holder'), s.bankHolder || s.biz], [t('acc_no'), s.bankAcc], [t('branch_code'), s.bankBranch], [t('acc_type'), s.bankType],
        [t('pay_ref'), d.no, true]].filter(function (r) { return r[1]; }), 320);
    }
    if (d.notes) { doc.heading(t('notes')); String(d.notes).split('\n').forEach(function (l) { if (clean(l)) doc.note(l); }); }
    if (q) doc.note(t('quote_valid_note', { d: shortDate(d.valid) }));
    if (s.terms) { doc.heading(t('terms')); String(s.terms).split('\n').forEach(function (l) { if (clean(l)) doc.note(l); }); }
    doc.y += 6;
    doc.text(M, doc.y + 10, t('thanks_business'), 10, true, ACC);
    return doc.blob();
  }
  function docFile(d) {
    var nm = (clientName(d.client) || '').replace(/[\\\/:*?"<>|]+/g, ' ').trim();
    return (d.no + ' ' + nm).trim() + '.pdf';
  }
  function exportDoc(share) {
    var d = find('docs', F.id);
    if (!d) return;
    try {
      deliver(buildDocPdf(d), docFile(d), share);
      if (d.status === 'draft') { d.status = 'sent'; d.sent = today(); save(); render(); }
    } catch (e) { console.error(e); toast(t('export_failed') + ' ' + e.message); }
  }

  /* ================================================================ */
  /* Reports & export                                                  */
  /* ================================================================ */
  function openReports() {
    var p = presets()[2];
    openSub('reports', { preset: 2, from: p[1], to: p[2] });
  }
  function reportsScreen() {
    var s = summary(F.from, F.to), vat = D.settings.vat;
    var h = '<div class="card"><strong>' + esc(t('period')) + '</strong><div class="chips" style="margin-top:10px">' +
      presets().map(function (p, i) { return '<button class="chip' + (F.preset === i ? ' on' : '') + '" data-preset="' + i + '">' + esc(t(p[0])) + '</button>'; }).join('') + '</div>' +
      '<div class="two">' + fld(t('from'), inp('from', { type: 'date' })) + fld(t('to'), inp('to', { type: 'date' })) + '</div>' +
      '<div class="muted" style="margin-top:10px">' + esc(periodText(F.from, F.to)) + '</div></div>';
    h += '<div class="card" id="rsum">' + reportSummaryHtml(s, vat) + '</div>';
    var none = !hasAny(s);
    h += '<div class="card"><strong>' + esc(t('export')) + '</strong><p class="muted" style="margin:6px 0 14px">' + esc(t('export_sub')) + '</p><div class="stack">' +
      '<button class="primary" data-act="xls"' + (none ? ' disabled' : '') + '>' + ico(IC.down) + esc(t('save_excel')) + '</button>' +
      '<button class="primary" data-act="pdf"' + (none ? ' disabled' : '') + '>' + ico(IC.down) + esc(t('save_pdf')) + '</button>' +
      (canShare ? '<div class="two"><button class="secondary" data-act="shareXls"' + (none ? ' disabled' : '') + '>' + ico(IC.share, 18) + esc(t('share_excel')) + '</button>' +
        '<button class="secondary" data-act="sharePdf"' + (none ? ' disabled' : '') + '>' + ico(IC.share, 18) + esc(t('share_pdf')) + '</button></div>' : '') +
      '</div>' + (none ? '<p class="muted" style="margin:12px 0 0">' + esc(t('nothing_in_period')) + '</p>' : '') + '</div>';
    h += backupCard();
    app.innerHTML = h;
  }
  function backupCard() {
    return '<div class="card"><strong>' + esc(t('backup')) + '</strong><p class="muted" style="margin:6px 0 14px">' + esc(t('backup_sub')) + '</p>' +
      '<div class="two"><button class="secondary" data-act="backup">' + esc(t('backup_now')) + '</button><button class="secondary" data-act="restorePick">' + esc(t('restore_backup')) + '</button></div>' +
      '<div class="muted" style="margin-top:10px">' + esc(D.settings.lastBackup ? t('backup_last', { d: shortDate(D.settings.lastBackup) }) : t('backup_never')) + '</div></div>';
  }
  function hasAny(s) { return !!(s.money.length + s.fuel.length + s.diary.length + s.insp.length + s.harvests.length + s.care.length + s.docs.length + s.pays.length); }
  function photoMark(x) { return x.photo ? t('yes') : x.photoLater ? t('photo_later_short') : ''; }
  function owedNow() { return owing().reduce(function (a, d) { return a + docTotals(d).bal; }, 0); }
  function reportSummaryHtml(s, vat) {
    var h = '<strong>' + esc(t('summary')) + '</strong><div class="stats">' + stat(t('income'), fmtR(s.inT), 'pos') +
      stat(s.fuelT ? t('expenses_incl_fuel') : t('expenses'), fmtR(s.outAll), 'neg') + stat(t('net'), fmtR(s.net), s.net >= 0 ? 'pos' : 'neg') + '</div>';
    var rows = [];
    if (vat) rows.push([t('vat_out'), fmtR(s.vatOut)], [t('vat_in'), fmtR(s.vatIn)], [t('vat_net'), fmtR(s.vatOut - s.vatIn)]);
    rows.push([t('honey'), fmtKg(s.kg)], [t('wax'), fmtKg(s.wax)], [t('active_hives_now'), String(activeHives().length)], [t('inspections'), String(s.insp.length)],
      [t('quoted'), fmtR(s.quoted)], [t('invoiced'), fmtR(s.invoiced)], [t('received_from_clients'), fmtR(s.received)], [t('owed_now'), fmtR(owedNow())]);
    if (s.fuel.length || D.settings.fuelOn) rows.push([t('diesel'), fmtL(s.dL) + ' · ' + fmtR(s.dAmt)], [t('petrol'), fmtL(s.pL) + ' · ' + fmtR(s.pAmt)]);
    rows.push([t('diary_entries'), String(s.diary.length)]);
    h += '<table class="kv">' + rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>';
    return h;
  }
  function fileBase() {
    var biz = (D.settings.biz || D.settings.owner || 'ByeBoer').replace(/[\\\/:*?"<>|]+/g, ' ').trim();
    return 'ByeBoer ' + biz + ' ' + (F.from || F.to ? (F.from || 'start') + ' to ' + (F.to || today()) : 'all ' + today());
  }
  function hiveKg(hid, from, to) { return D.harvests.filter(function (r) { return r.hive === hid && inRange(r.date, from, to); }).reduce(function (a, r) { return a + (r.kg || 0); }, 0); }

  function buildExcel() {
    var s = summary(F.from, F.to), vat = D.settings.vat;
    var M = function (v) { return { v: r2(v), f: 'money' }; }, N1 = function (v) { return { v: v, f: 'num1' }; };
    var sumRows = [];
    sumRows.push({ c: [D.settings.biz || 'ByeBoer'], sec: true });
    sumRows.push([t('period'), periodText(F.from, F.to)]);
    if (D.settings.owner) sumRows.push([t('your_name'), D.settings.owner]);
    if (D.settings.regNo) sumRows.push([t('reg_no'), D.settings.regNo]);
    if (vat && D.settings.vatNo) sumRows.push([t('vat_no'), D.settings.vatNo]);
    sumRows.push([t('generated'), shortDate(today())]);
    sumRows.push([]);
    sumRows.push({ c: [t('income')], sec: true });
    Object.keys(s.cin).sort().forEach(function (c) { sumRows.push([catLabel(c), M(s.cin[c])]); });
    sumRows.push({ c: [t('total_income'), M(s.inT)], b: true });
    sumRows.push([]);
    sumRows.push({ c: [t('expenses')], sec: true });
    Object.keys(s.cout).sort().forEach(function (c) { sumRows.push([catLabel(c), M(s.cout[c])]); });
    if (s.dAmt) sumRows.push([t('fuel_diesel'), M(s.dAmt)]);
    if (s.pAmt) sumRows.push([t('fuel_petrol'), M(s.pAmt)]);
    sumRows.push({ c: [t('total_expenses'), M(s.outAll)], b: true });
    sumRows.push([]);
    sumRows.push({ c: [t('net'), M(s.net)], b: true });
    if (vat) {
      sumRows.push([]);
      sumRows.push({ c: [t('vat')], sec: true });
      sumRows.push([t('vat_out'), M(s.vatOut)], [t('vat_in'), M(s.vatIn)], { c: [t('vat_net'), M(s.vatOut - s.vatIn)], b: true });
    }
    sumRows.push([]);
    sumRows.push({ c: [t('quotes_invoices')], sec: true });
    sumRows.push([t('quoted'), M(s.quoted)], [t('invoiced'), M(s.invoiced)], [t('received_from_clients'), M(s.received)], [t('owed_now'), M(owedNow())]);
    sumRows.push([]);
    sumRows.push({ c: [t('harvests')], sec: true });
    Object.keys(s.kgAp).sort().forEach(function (k) { sumRows.push([t('honey') + ' – ' + k + ' (kg)', N1(s.kgAp[k])]); });
    sumRows.push({ c: [t('honey_kg'), N1(s.kg)], b: true }, [t('wax_kg'), N1(s.wax)]);
    sumRows.push([]);
    sumRows.push({ c: [t('hives')], sec: true });
    D.apiaries.slice().sort(byName).forEach(function (a) { sumRows.push([a.name, { v: activeHives(a.id).length, f: 'int' }]); });
    sumRows.push({ c: [t('active_hives_now'), { v: activeHives().length, f: 'int' }], b: true }, [t('inspections'), { v: s.insp.length, f: 'int' }]);
    if (s.fuel.length) {
      sumRows.push([]);
      sumRows.push({ c: [t('fuel')], sec: true });
      sumRows.push([t('diesel_litres'), N1(s.dL)], [t('petrol_litres'), N1(s.pL)]);
    }
    var sheets = [{ name: t('summary'), plain: true, cols: [{ w: 44, f: 'text' }, { w: 24, f: 'money' }], rows: sumRows }];

    var mCols = [{ h: t('date'), w: 12, f: 'date' }, { h: t('type'), w: 10 }, { h: t('category'), w: 30 }, { h: t('description'), w: 34 }, { h: t('party_col'), w: 24 },
      { h: t('reference'), w: 14 }, { h: t('income_r'), w: 15, f: 'money' }, { h: t('expense_r'), w: 15, f: 'money' }];
    if (vat) mCols.push({ h: t('vat_r'), w: 13, f: 'money' }, { h: t('excl_vat_r'), w: 15, f: 'money' });
    mCols.push({ h: t('slip_photo'), w: 12 });
    sheets.push({ name: t('sheet_money'), cols: mCols, sumCols: vat ? [6, 7, 8, 9] : [6, 7], totalLabel: t('total'), rows: s.money.map(function (m) {
      var r = [m.date, m.dir === 'in' ? t('income') : t('expense'), catLabel(m.cat), m.desc, m.party, m.ref, m.dir === 'in' ? m.amt : null, m.dir === 'out' ? m.amt : null];
      if (vat) r.push(m.vat || 0, r2(m.amt - (m.vat || 0)));
      r.push(photoMark(m));
      return r;
    }) });
    if (s.fuel.length || D.settings.fuelOn) {
      var fCols = [{ h: t('date'), w: 12, f: 'date' }, { h: t('fuel'), w: 10 }, { h: t('litres'), w: 11, f: 'num2' }, { h: t('amount_r'), w: 15, f: 'money' },
        { h: t('r_per_litre'), w: 12, f: 'money' }, { h: t('used_for'), w: 22 }, { h: t('vehicle'), w: 22 }, { h: t('supplier'), w: 20 }, { h: t('reference'), w: 14 }];
      if (vat) fCols.push({ h: t('vat_r'), w: 13, f: 'money' });
      fCols.push({ h: t('slip_photo'), w: 12 });
      sheets.push({ name: t('fuel'), cols: fCols, sumCols: vat ? [2, 3, 9] : [2, 3], totalLabel: t('total'), rows: s.fuel.map(function (f) {
        var r = [f.date, t(f.kind), f.l, f.amt, f.l ? r2(f.amt / f.l) : null, t('use_' + f.use), f.mach, f.sup, f.ref];
        if (vat) r.push(f.vat || 0);
        r.push(photoMark(f));
        return r;
      }) });
    }
    sheets.push({ name: t('sheet_docs'), cols: [{ h: t('number'), w: 12 }, { h: t('type'), w: 12 }, { h: t('date'), w: 12, f: 'date' }, { h: t('client'), w: 24 }, { h: t('job'), w: 32 },
      { h: t('status'), w: 14 }, { h: t('subtotal'), w: 14, f: 'money' }, { h: t('vat_r'), w: 12, f: 'money' }, { h: t('total'), w: 14, f: 'money' }, { h: t('paid'), w: 14, f: 'money' },
      { h: t('balance_due'), w: 14, f: 'money' }, { h: t('due_valid'), w: 13, f: 'date' }],
      rows: s.docs.map(function (d) { var x = docTotals(d); return [d.no, d.type === 'q' ? t('quote') : t('invoice'), d.date, clientName(d.client), d.job, t('ds_' + docStatus(d)), x.sub, x.vat, x.total,
        d.type === 'i' ? x.paid : null, d.type === 'i' ? x.bal : null, d.type === 'q' ? d.valid : d.due]; }) });
    sheets.push({ name: t('payments'), cols: [{ h: t('date'), w: 12, f: 'date' }, { h: t('invoice'), w: 12 }, { h: t('client'), w: 26 }, { h: t('pay_method'), w: 14 }, { h: t('amount_r'), w: 15, f: 'money' }],
      sumCols: [4], totalLabel: t('total'), rows: s.pays.map(function (r) { return [r.p.date, r.d.no, clientName(r.d.client), t('pm_' + (r.p.method || 'eft')), r.p.amt]; }) });
    sheets.push({ name: t('clients'), cols: [{ h: t('client_name'), w: 26 }, { h: t('phone'), w: 16 }, { h: t('email'), w: 26 }, { h: t('address'), w: 36, f: 'wrap' }, { h: t('vat_no'), w: 14 },
      { h: t('invoiced'), w: 14, f: 'money' }, { h: t('owes'), w: 14, f: 'money' }],
      rows: D.clients.slice().sort(byName).map(function (c) {
        var inv = D.docs.filter(function (d) { return d.client === c.id && d.type === 'i'; });
        return [c.name, c.phone, c.email, c.addr, c.vatNo, inv.reduce(function (a, d) { return a + docTotals(d).total; }, 0), inv.reduce(function (a, d) { return a + Math.max(0, docTotals(d).bal); }, 0)];
      }) });
    sheets.push({ name: t('hives'), cols: [{ h: t('hive_no'), w: 10 }, { h: t('apiary'), w: 20 }, { h: t('hive_type'), w: 16 }, { h: t('source'), w: 16 }, { h: t('started'), w: 12, f: 'date' },
      { h: t('status'), w: 12 }, { h: t('queen'), w: 16 }, { h: t('last_insp'), w: 13, f: 'date' }, { h: t('honey_kg'), w: 12, f: 'num1' }, { h: t('notes'), w: 30, f: 'wrap' }],
      rows: D.hives.slice().sort(hiveSort).map(function (x) { var li = lastInsp(x.id); return [x.no, apName(x.ap), t('ht_' + x.type), t('hsrc_' + x.source), x.date, t('hs_' + x.status),
        [x.queenYear, x.queenMark].filter(Boolean).join(' '), li ? li.date : '', hiveKg(x.id, F.from, F.to) || null, x.notes]; }) });
    sheets.push({ name: t('inspections'), cols: [{ h: t('date'), w: 12, f: 'date' }, { h: t('hive'), w: 10 }, { h: t('apiary'), w: 18 }, { h: t('queen'), w: 14 }, { h: t('brood'), w: 13 },
      { h: t('stores'), w: 12 }, { h: t('temper'), w: 12 }, { h: t('frames_bees'), w: 10, f: 'num1' }, { h: t('problems'), w: 30, f: 'wrap' }, { h: t('notes'), w: 34, f: 'wrap' }, { h: t('next_insp'), w: 13, f: 'date' }],
      rows: s.insp.map(function (x) { var hv = find('hives', x.hive) || {}; return [x.date, hv.no, apName(hv.ap), t('qs_' + x.queen), t('br_' + x.brood), t('st_' + x.stores), t('tm_' + x.temper),
        x.frames || null, (x.probs || []).map(function (p) { return t('pr_' + p); }).join(', '), x.notes, x.next]; }) });
    sheets.push({ name: t('harvests'), cols: [{ h: t('date'), w: 12, f: 'date' }, { h: t('apiary'), w: 20 }, { h: t('hive'), w: 12 }, { h: t('honey_kg'), w: 12, f: 'num1' }, { h: t('wax_kg'), w: 10, f: 'num1' },
      { h: t('frames_taken'), w: 12, f: 'int' }, { h: t('notes'), w: 34, f: 'wrap' }], sumCols: [3, 4], totalLabel: t('total'),
      rows: s.harvests.map(function (x) { return [x.date, apName(x.ap), x.hive ? (find('hives', x.hive) || {}).no : t('whole_apiary'), x.kg || 0, x.wax || 0, x.frames || null, x.notes]; }) });
    sheets.push({ name: t('sheet_care'), cols: [{ h: t('date'), w: 12, f: 'date' }, { h: t('what_done'), w: 18 }, { h: t('apiary'), w: 20 }, { h: t('hive'), w: 12 }, { h: t('product'), w: 22 },
      { h: t('how_much'), w: 16 }, { h: t('move_to'), w: 18 }, { h: t('next_due'), w: 13, f: 'date' }, { h: t('notes'), w: 30, f: 'wrap' }],
      rows: s.care.map(function (x) { return [x.date, t('ct_' + x.type), apName(x.ap), x.hive ? (find('hives', x.hive) || {}).no : t('all_hives'), x.product, x.qty, apName(x.to), x.next, x.notes]; }) });
    sheets.push({ name: t('apiaries'), cols: [{ h: t('apiary_name'), w: 22 }, { h: t('apiary_kind'), w: 16 }, { h: t('place'), w: 26 }, { h: t('gps'), w: 22 }, { h: t('landowner'), w: 20 },
      { h: t('phone'), w: 14 }, { h: t('active_hives'), w: 10, f: 'int' }, { h: t('honey_kg'), w: 12, f: 'num1' }, { h: t('notes'), w: 30, f: 'wrap' }],
      rows: D.apiaries.slice().sort(byName).map(function (a) { return [a.name, t('ak_' + a.kind), a.place, a.gps, a.contact, a.phone, activeHives(a.id).length,
        D.harvests.filter(function (r) { return r.ap === a.id && inRange(r.date, F.from, F.to); }).reduce(function (q, r) { return q + (r.kg || 0); }, 0), a.notes]; }) });
    sheets.push({ name: t('tab_diary'), cols: [{ h: t('date'), w: 12, f: 'date' }, { h: t('tags'), w: 20, f: 'wrap' }, { h: t('entry'), w: 90, f: 'wrap' }],
      rows: s.diary.map(function (d) { return [d.date, (d.tags || []).map(function (g) { return t('tag_' + g); }).join(', '), d.text]; }) });
    return FX.xlsx(sheets);
  }

  function buildPdf() {
    var s = summary(F.from, F.to), vat = D.settings.vat;
    var doc = new FX.PDF({ footer: 'ByeBoer · ' + (D.settings.biz || '') + ' · ' + periodText(F.from, F.to), pageLabel: t('page') });
    var subs = [t('period') + ': ' + periodText(F.from, F.to)];
    if (D.settings.owner) subs.push(D.settings.owner + (vat && D.settings.vatNo ? ' · ' + t('vat_no') + ' ' + D.settings.vatNo : '') + (D.settings.regNo ? ' · ' + t('reg_no_short') + ' ' + D.settings.regNo : ''));
    subs.push(t('generated') + ': ' + shortDate(today()));
    if (D.settings.logo && D.settings.logoW) {
      var k = Math.min(110 / D.settings.logoW, 46 / D.settings.logoH);
      doc.image(D.settings.logo, D.settings.logoW, D.settings.logoH, doc.W - doc.M - D.settings.logoW * k, doc.M, D.settings.logoW * k, D.settings.logoH * k);
    }
    doc.title((D.settings.biz || 'ByeBoer') + ' – ' + t('biz_report'), subs);

    doc.heading(t('summary'));
    doc.kv([[t('total_income'), fmtR(s.inT)], [t('total_expenses'), fmtR(s.outAll)], [t('net'), fmtR(s.net), true]]);
    var cin = Object.keys(s.cin).sort(function (a, b) { return s.cin[b] - s.cin[a]; });
    doc.heading(t('income_by_cat'));
    doc.table([{ h: t('category') }, { h: t('amount_r'), w: 110, a: 'r' }], cin.map(function (c) { return [catLabel(c), fmtR(s.cin[c])]; }), { total: [t('total'), fmtR(s.inT)], empty: t('none') });
    var cout = Object.keys(s.cout).sort(function (a, b) { return s.cout[b] - s.cout[a]; }).map(function (c) { return [catLabel(c), s.cout[c]]; });
    if (s.dAmt) cout.push([t('fuel_diesel'), s.dAmt]);
    if (s.pAmt) cout.push([t('fuel_petrol'), s.pAmt]);
    doc.heading(t('expenses_by_cat'));
    doc.table([{ h: t('category') }, { h: t('amount_r'), w: 110, a: 'r' }], cout.map(function (c) { return [c[0], fmtR(c[1])]; }), { total: [t('total'), fmtR(s.outAll)], empty: t('none') });
    if (vat) {
      doc.heading(t('vat'));
      doc.kv([[t('vat_out'), fmtR(s.vatOut)], [t('vat_in'), fmtR(s.vatIn)], [t('vat_net'), fmtR(s.vatOut - s.vatIn), true]]);
      doc.note(t('vat_note'));
    }
    doc.heading(t('quotes_invoices'));
    doc.kv([[t('quoted'), fmtR(s.quoted)], [t('invoiced'), fmtR(s.invoiced)], [t('received_from_clients'), fmtR(s.received)], [t('owed_now'), fmtR(owedNow()), true]]);
    var ow = owing();
    if (ow.length) doc.table([{ h: t('invoice'), w: 70 }, { h: t('client') }, { h: t('date'), w: 66 }, { h: t('due_date'), w: 66 }, { h: t('balance_due'), w: 90, a: 'r' }],
      ow.sort(byDateAsc).map(function (d) { return [d.no, clientName(d.client), shortDate(d.date), shortDate(d.due), fmtR(docTotals(d).bal)]; }), { size: 8.5 });

    doc.heading(t('harvests'));
    var ka = Object.keys(s.kgAp).sort();
    if (ka.length) doc.bars(ka.map(function (k) { return [k, s.kgAp[k], fmtKg(s.kgAp[k])]; }), { labelW: 120, color: [0.89, 0.6, 0.07] });
    doc.kv([[t('honey'), fmtKg(s.kg), true], [t('wax'), fmtKg(s.wax)], [t('harvests_n'), String(s.harvests.length)]]);

    doc.heading(t('hives'));
    doc.table([{ h: t('apiary') }, { h: t('apiary_kind'), w: 90 }, { h: t('active_hives'), w: 80, a: 'r' }, { h: t('honey_kg'), w: 80, a: 'r' }],
      D.apiaries.slice().sort(byName).map(function (a) { return [a.name, t('ak_' + a.kind), String(activeHives(a.id).length), fmtNum(s.kgAp[a.name] || 0, 1)]; }),
      { total: [t('total'), '', String(activeHives().length), fmtNum(s.kg, 1)], empty: t('none') });

    if (s.docs.length) {
      doc.heading(t('sheet_docs'));
      doc.table([{ h: t('number'), w: 62 }, { h: t('date'), w: 58 }, { h: t('client'), wrap: true }, { h: t('status'), w: 70 }, { h: t('total'), w: 78, a: 'r' }, { h: t('balance_due'), w: 78, a: 'r' }],
        s.docs.map(function (d) { var x = docTotals(d); return [d.no, shortDate(d.date), clientName(d.client) + (d.job ? ' – ' + d.job : ''), t('ds_' + docStatus(d)), fmtR(x.total), d.type === 'i' ? fmtR(x.bal) : '']; }), { size: 8 });
    }
    if (s.money.length) {
      doc.heading(t('sheet_money'));
      doc.table([{ h: t('date'), w: 58 }, { h: t('description'), wrap: true }, { h: t('category'), w: 120 }, { h: t('income_r'), w: 72, a: 'r' }, { h: t('expense_r'), w: 72, a: 'r' }],
        s.money.map(function (m) { return [shortDate(m.date), (m.desc || catLabel(m.cat)) + (m.party ? ' – ' + m.party : ''), catLabel(m.cat), m.dir === 'in' ? fmtR(m.amt) : '', m.dir === 'out' ? fmtR(m.amt) : '']; }),
        { size: 8, total: [t('total'), '', '', fmtR(s.inT), fmtR(s.outT)] });
    }
    if (s.fuel.length) {
      doc.heading(t('fuel'));
      doc.table([{ h: t('date'), w: 58 }, { h: t('fuel'), w: 58 }, { h: t('litres'), w: 50, a: 'r' }, { h: t('amount_r'), w: 72, a: 'r' }, { h: t('used_for'), w: 110 }, { h: t('vehicle') }],
        s.fuel.map(function (f) { return [shortDate(f.date), t(f.kind), fmtNum(f.l, f.l % 1 ? 1 : 0), fmtR(f.amt), t('use_' + f.use), f.mach]; }),
        { size: 8, total: [t('total'), '', fmtNum(s.dL + s.pL, (s.dL + s.pL) % 1 ? 1 : 0), fmtR(s.fuelT), '', ''] });
    }
    if (s.harvests.length) {
      doc.heading(t('harvest_list'));
      doc.table([{ h: t('date'), w: 58 }, { h: t('apiary'), w: 110 }, { h: t('hive'), w: 70 }, { h: t('honey_kg'), w: 64, a: 'r' }, { h: t('wax_kg'), w: 56, a: 'r' }, { h: t('notes'), wrap: true }],
        s.harvests.map(function (x) { return [shortDate(x.date), apName(x.ap), x.hive ? hiveName(x.hive) : t('whole_apiary'), fmtNum(x.kg || 0, 1), fmtNum(x.wax || 0, 1), x.notes]; }),
        { size: 8, total: [t('total'), '', '', fmtNum(s.kg, 1), fmtNum(s.wax, 1), ''] });
    }
    if (s.insp.length) {
      doc.heading(t('inspections'));
      doc.table([{ h: t('date'), w: 58 }, { h: t('hive'), w: 60 }, { h: t('apiary'), w: 90 }, { h: t('details'), wrap: true }],
        s.insp.map(function (x) { var hv = find('hives', x.hive) || {}; return [shortDate(x.date), hiveLabel(hv), apName(hv.ap), inspSummary(x) + (x.notes ? ' · ' + x.notes : '')]; }), { size: 8 });
    }
    if (s.care.length) {
      doc.heading(t('sheet_care'));
      doc.table([{ h: t('date'), w: 58 }, { h: t('what_done'), w: 80 }, { h: t('where'), w: 130 }, { h: t('details'), wrap: true }],
        s.care.map(function (x) { return [shortDate(x.date), t('ct_' + x.type), x.hive ? hiveName(x.hive) + ' · ' + apName(x.ap) : t('all_hives_at', { ap: apName(x.ap) }),
          [x.product, x.qty, x.to ? '→ ' + apName(x.to) : '', x.notes].filter(Boolean).join(' · ')]; }), { size: 8 });
    }
    if (s.diary.length) {
      doc.heading(t('tab_diary'));
      doc.table([{ h: t('date'), w: 62 }, { h: t('entry'), wrap: true }],
        s.diary.map(function (d) { return [shortDate(d.date), d.text + ((d.tags || []).length ? '  [' + d.tags.map(function (g) { return t('tag_' + g); }).join(', ') + ']' : '')]; }), { size: 8.5 });
    }
    return doc.blob();
  }

  function deliver(blob, name, share) {
    if (share && canShare) {
      var file = new File([blob], name, { type: blob.type });
      navigator.share({ files: [file], title: name }).catch(function (e) { if (e && e.name !== 'AbortError') toast(t('share_failed')); });
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    toast(t('file_saved'));
  }
  function exportFile(type, share) {
    try {
      var blob = type === 'pdf' ? buildPdf() : buildExcel();
      deliver(blob, fileBase() + (type === 'pdf' ? '.pdf' : '.xlsx'), share);
    } catch (e) {
      console.error(e);
      toast(t('export_failed') + ' ' + e.message);
    }
  }
  var canShare = (function () {
    try {
      var probe = new File([new Blob(['x'])], 'x.pdf', { type: 'application/pdf' });
      return !!(navigator.canShare && navigator.canShare({ files: [probe] }));
    } catch (e) { return false; }
  })();

  /* Backup / restore --------------------------------------------------- */
  function blobToDataUrl(b) {
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { res(null); }; r.readAsDataURL(b); });
  }
  function dataUrlToBlob(u) {
    var m = /^data:([^;,]+);base64,(.*)$/.exec(u || '');
    if (!m) return null;
    var bin = atob(m[2]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  }
  function backup() {
    D.settings.lastBackup = today();
    save();
    var name = 'ByeBoer backup ' + (D.settings.biz || '').replace(/[\\\/:*?"<>|]+/g, ' ').trim() + ' ' + today() + '.json';
    var used = {};
    D.money.concat(D.fuel).forEach(function (x) { if (x.photo) used[x.photo] = 1; });
    var getPhotos = useLS || !Object.keys(used).length ? Promise.resolve({}) : photoAll();
    getPhotos.then(function (all) {
      var ids = Object.keys(all).filter(function (k) { return used[k]; });
      return Promise.all(ids.map(function (k) { return blobToDataUrl(all[k]); })).then(function (urls) {
        var photos = {}; ids.forEach(function (k, i) { if (urls[i]) photos[k] = urls[i]; });
        return photos;
      });
    }).catch(function () { return {}; }).then(function (photos) {
      var out = Object.assign({}, D, { photos: photos });
      deliver(new Blob([JSON.stringify(out)], { type: 'application/json' }), name);
      if (V === 'home' || V === 'reports' || V === 'settings') render();
    });
  }
  function restorePick() {
    var input = document.getElementById('restoreFile');
    input.value = ''; input.click();
  }
  var pendingRestore = null, pendingPhotos = {};
  function restoreFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var d;
      try { d = JSON.parse(reader.result); } catch (e) { d = null; }
      if (!d || d.app !== 'ByeBoer' || !d.settings) { toast(t('restore_bad')); return; }
      var photos = d.photos || {};
      delete d.photos;
      pendingRestore = normalise(d);
      pendingPhotos = photos;
      var n = LISTS.reduce(function (s2, k) { return s2 + pendingRestore[k].length; }, 0);
      if (!D.settings.setup || totalEntries() === 0) return applyRestore();
      openSub('settings', { restoreN: n, restoreBiz: pendingRestore.settings.biz });
      var el = document.getElementById('restoreBox');
      if (el) el.scrollIntoView({ block: 'center' });
    };
    reader.readAsText(file);
  }
  function applyRestore() {
    if (!pendingRestore) return;
    D = pendingRestore; pendingRestore = null;
    D.settings.setup = true;
    var photos = pendingPhotos; pendingPhotos = {};
    photoUrls = {};
    var ph = useLS ? Promise.resolve() : photoClear().then(function () {
      return Promise.all(Object.keys(photos).map(function (k) { var b = dataUrlToBlob(photos[k]); return b ? photoPut(k, b) : null; }));
    }).catch(function () {});
    Promise.all([save(), ph]).then(function () { toast(t('restored')); });
    if (history.state && history.state.sub) history.back();
    showTab('home');
  }

  /* Calendar reminder -------------------------------------------------- */
  function appUrl() { return location.href.split('#')[0].split('?')[0]; }
  function reminderIcs() {
    var blob = FX.ics({ time: D.settings.remindTime || '18:00', title: t('ics_title'), desc: t('ics_desc'), url: appUrl() });
    deliver(blob, 'ByeBoer diary reminder.ics');
  }
  function reminderGoogle() {
    var hm = (D.settings.remindTime || '18:00').split(':'), d = new Date();
    d.setHours(+hm[0], +hm[1] || 0, 0, 0);
    var e = new Date(d.getTime() + 10 * 60000);
    var f = function (x) { return x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate()) + 'T' + pad(x.getHours()) + pad(x.getMinutes()) + '00'; };
    var url = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(t('ics_title')) +
      '&details=' + encodeURIComponent(t('ics_desc') + '\n' + appUrl()) + '&dates=' + f(d) + '/' + f(e) +
      '&ctz=Africa/Johannesburg&recur=' + encodeURIComponent('RRULE:FREQ=DAILY');
    window.open(url, '_blank', 'noopener');
  }

  /* ================================================================ */
  /* Settings                                                          */
  /* ================================================================ */
  var SET_KEYS = ['lang', 'biz', 'owner', 'phone', 'email', 'addr', 'regNo', 'regDue', 'vat', 'vatNo', 'yearEnd', 'bankName', 'bankHolder', 'bankAcc', 'bankBranch', 'bankType',
    'qPrefix', 'iPrefix', 'terms', 'fuelOn', 'travelDefault', 'remind', 'remindTime'];
  function settingsScreen() {
    var s = D.settings;
    if (!F.loaded) {
      F.loaded = 1;
      SET_KEYS.forEach(function (k) { F[k] = s[k]; });
      Object.assign(F, { vatRate: numIn(s.vatRate), yearEnd: String(s.yearEnd), nextQ: String(s.nextQ), nextI: String(s.nextI), payDays: String(s.payDays),
        quoteDays: String(s.quoteDays), deposit: numIn(s.deposit || ''), kmRate: numIn(s.kmRate || '') });
    }
    var months = []; for (var m = 1; m <= 12; m++) months.push([String(m), monthName(m)]);
    var h = '';
    if (F.restoreN != null) {
      h += '<div class="card warnc" id="restoreBox"><div class="grow"><strong>' + esc(t('restore_confirm_title')) + '</strong><div class="muted">' +
        esc(t('restore_confirm', { n: F.restoreN, biz: F.restoreBiz || '–' })) + '</div>' +
        '<div class="two" style="margin-top:12px"><button class="primary" data-act="applyRestore">' + esc(t('restore_yes')) + '</button><button class="secondary" data-act="cancelRestore">' + esc(t('cancel')) + '</button></div></div></div>';
    }
    h += '<div class="card"><strong>' + esc(t('business')) + '</strong>' +
      fld(t('language'), seg('lang', [['en', 'English'], ['af', 'Afrikaans']])) +
      fld(t('biz_name'), inp('biz', { max: 60 })) + fld(t('your_name'), inp('owner', { max: 60 })) +
      '<div class="two">' + fld(t('phone'), inp('phone', { max: 20, mode: 'tel' })) + fld(t('email'), inp('email', { max: 80, type: 'email' })) + '</div>' +
      fld(t('address'), area('addr', t('address_ph'), 3), esc(t('biz_addr_hint'))) + '</div>';
    h += '<div class="card" id="sdocs"><strong>' + esc(t('logo')) + '</strong><p class="muted" style="margin:6px 0 0">' + esc(t('logo_sub')) + '</p>' +
      '<div class="logobox">' + (s.logo ? '<img src="' + s.logo + '" alt="' + esc(t('logo')) + '">' : '<div class="empty">' + esc(t('no_logo')) + '</div>') +
      '<div class="grow stack"><label class="btn secondary small wide" for="logoIn">' + ico(IC.image, 18) + esc(t(s.logo ? 'change_logo' : 'upload_logo')) + '</label>' +
      (s.logo ? confirmBtn('logo', 'logoRm', t('remove_logo'), t('delete_again')) : '') + '</div></div>' +
      '<input type="file" accept="image/*" id="logoIn" class="hidden"></div>';
    h += '<div class="card"><strong>' + esc(t('quotes_invoices')) + '</strong>' +
      '<div class="two">' + fld(t('quote_prefix'), inp('qPrefix', { max: 8 })) + fld(t('next_quote_no'), inp('nextQ', { mode: 'numeric', max: 6 })) + '</div>' +
      '<div class="two">' + fld(t('invoice_prefix'), inp('iPrefix', { max: 8 })) + fld(t('next_invoice_no'), inp('nextI', { mode: 'numeric', max: 6 })) + '</div>' +
      '<div class="two">' + fld(t('pay_within'), inp('payDays', { mode: 'numeric', max: 3 })) + fld(t('quote_valid_days'), inp('quoteDays', { mode: 'numeric', max: 3 })) + '</div>' +
      fld(t('deposit_pct'), inp('deposit', { mode: 'decimal', max: 5, ph: '0' }), esc(t('deposit_hint'))) +
      '<div class="step" style="margin-top:18px">' + esc(t('banking_details')) + '</div>' +
      '<div class="two">' + fld(t('bank'), inp('bankName', { max: 40, ph: t('bank_ph') })) + fld(t('acc_holder'), inp('bankHolder', { max: 60 })) + '</div>' +
      '<div class="two">' + fld(t('acc_no'), inp('bankAcc', { max: 24, mode: 'numeric' })) + fld(t('branch_code'), inp('bankBranch', { max: 12, mode: 'numeric' })) + '</div>' +
      fld(t('acc_type'), inp('bankType', { max: 30, ph: t('acc_type_ph') })) +
      fld(t('terms'), area('terms', t('terms_ph'), 4), esc(t('terms_hint'))) + '</div>';
    h += '<div class="card"><strong>' + esc(t('fuel_travel')) + '</strong>' +
      '<div style="margin-top:12px">' + check('fuelOn', t('fuel_track')) + '</div><div class="hint">' + esc(t('fuel_track_hint')) + '</div>' +
      '<div style="margin-top:14px">' + check('travelDefault', t('travel_default')) + '</div><div class="hint">' + esc(t('travel_default_hint')) + '</div>' +
      fld(t('rate_per_km'), inp('kmRate', { mode: 'decimal', max: 8, ph: '0.00' }), esc(t('km_rate_hint'))) + '</div>';
    h += '<div class="card"><strong>' + esc(t('tax_vat')) + '</strong>' +
      '<div style="margin-top:12px">' + check('vat', t('vat_registered')) + '</div>' +
      (F.vat ? '<div class="two">' + fld(t('vat_no'), inp('vatNo', { max: 20, mode: 'numeric' })) + fld(t('vat_rate'), inp('vatRate', { mode: 'decimal', max: 5 })) + '</div>' : '') +
      fld(t('year_end'), sel('yearEnd', months), esc(t('year_end_hint'))) + '</div>';
    h += '<div class="card"><strong>' + esc(t('registration')) + '</strong><p class="muted" style="margin:6px 0 0">' + esc(t('registration_sub')) + '</p>' +
      '<div class="two">' + fld(t('reg_no'), inp('regNo', { max: 30, ph: t('optional') })) + fld(t('reg_due'), inp('regDue', { type: 'date' })) + '</div>' +
      '<div class="hint">' + esc(t('reg_due_hint')) + '</div></div>';
    h += '<div class="card"><strong>' + esc(t('diary_reminder')) + '</strong>' +
      '<div style="margin-top:12px">' + check('remind', t('remind_in_app')) + '</div>' +
      fld(t('remind_time'), inp('remindTime', { type: 'time' })) +
      '<p class="muted" style="margin:12px 0">' + esc(t('remind_calendar_sub')) + '</p>' +
      '<div class="two"><button class="secondary" data-act="icsGoogle">' + esc(t('remind_google')) + '</button><button class="secondary" data-act="icsFile">' + esc(t('remind_ics')) + '</button></div></div>';
    h += msg('err', F.err);
    h += '<div class="stack"><button class="primary" data-act="saveSettings">' + esc(t('save')) + '</button></div>';

    var cats = (s.cats['in'] || []).map(function (n) { return ['in', n]; }).concat((s.cats.out || []).map(function (n) { return ['out', n]; }));
    if (cats.length) {
      h += '<div class="card" style="margin-top:14px"><strong>' + esc(t('my_categories')) + '</strong><div class="list">' + cats.map(function (c) {
        return '<div class="item static"><div class="row"><span>' + esc(c[1]) + ' <span class="muted">· ' + esc(c[0] === 'in' ? t('income') : t('expense')) + '</span></span>' +
          '<button class="text small danger" data-act="delCat" data-dir="' + c[0] + '" data-v="' + esc(c[1]) + '">' + esc(confirmKey === 'cat:' + c[0] + c[1] ? t('delete_again') : t('remove')) + '</button></div></div>';
      }).join('') + '</div><div class="hint">' + esc(t('cat_remove_hint')) + '</div></div>';
    }
    h += '<div style="margin-top:14px">' + backupCard() + '</div>';
    h += '<div class="card"><strong>' + esc(t('danger')) + '</strong><p class="muted" style="margin:6px 0 8px">' + esc(t('wipe_sub')) + '</p>' +
      confirmBtn('wipe', 'wipe', t('wipe'), t('wipe_again')) + '</div>';
    h += '<p class="muted center foot">ByeBoer ' + VERSION + ' · ' + esc(t('stored_here')) + '</p>';
    app.innerHTML = h;
    if (F.to) { var el = document.getElementById('s' + F.to); F.to = ''; if (el) setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 0); }
  }
  function saveSettings() {
    var rate = num(F.vatRate), nq = parseInt(F.nextQ, 10), ni = parseInt(F.nextI, 10), pd = parseInt(F.payDays, 10), qd = parseInt(F.quoteDays, 10);
    var dep = clean(F.deposit) ? num(F.deposit) : 0, km = clean(F.kmRate) ? num(F.kmRate) : 0;
    var e = '';
    if (!clean(F.biz) && !clean(F.owner)) e = t('err_biz');
    else if (F.vat && (isNaN(rate) || rate <= 0 || rate > 50)) e = t('err_vat_rate');
    else if (!(nq > 0) || !(ni > 0)) e = t('err_next_no');
    else if (!(pd >= 0) || !(qd > 0)) e = t('err_days');
    else if (isNaN(dep) || dep < 0 || dep > 100) e = t('err_deposit');
    else if (isNaN(km) || km < 0) e = t('err_km_rate');
    if (e) { F.err = esc(e); return render(); }
    var s = D.settings;
    Object.assign(s, { lang: F.lang, biz: clean(F.biz, 60), owner: clean(F.owner, 60), phone: clean(F.phone, 20), email: clean(F.email, 80), addr: cleanMulti(F.addr, 300),
      regNo: clean(F.regNo, 30), regDue: F.regDue || '', vat: !!F.vat, vatNo: clean(F.vatNo, 20), vatRate: F.vat ? rate : s.vatRate, yearEnd: +F.yearEnd,
      bankName: clean(F.bankName, 40), bankHolder: clean(F.bankHolder, 60), bankAcc: clean(F.bankAcc, 24), bankBranch: clean(F.bankBranch, 12), bankType: clean(F.bankType, 30),
      qPrefix: clean(F.qPrefix, 8), iPrefix: clean(F.iPrefix, 8), nextQ: nq, nextI: ni, payDays: pd, quoteDays: qd, deposit: r2(dep), terms: cleanMulti(F.terms, 1200),
      fuelOn: !!F.fuelOn, travelDefault: !!F.travelDefault, kmRate: r2(km), remind: !!F.remind, remindTime: F.remindTime || '18:00' });
    save(); toast(t('saved')); closeSub();
  }
  function setLogo(file) {
    makeLogo(file).then(function (lg) {
      D.settings.logo = lg.url; D.settings.logoW = lg.w; D.settings.logoH = lg.h;
      save(); toast(t('logo_saved')); render();
    }).catch(function () { toast(t('err_photo')); });
  }

  /* ================================================================ */
  /* Events                                                            */
  /* ================================================================ */
  function liveUpdate(k) {
    if (V === 'form' && F) {
      var amtN = num(F.amt), el;
      if ((k === 'amt') && (el = document.getElementById('live-vat'))) el.innerHTML = vatLine(amtN);
      if ((k === 'amt' || k === 'l') && (el = document.getElementById('live-ppl'))) el.innerHTML = pplLine(num(F.l), amtN);
      if (F.kind === 'doc') {
        var m = /^l(\d+)[qp]$/.exec(k);
        if (m && (el = document.getElementById('live-l' + m[1]))) el.textContent = fmtR(lineVal(+m[1]));
        if ((m || k === 'km' || k === 'kmRate') && (el = document.getElementById('live-tot'))) el.innerHTML = totalsHtml();
      }
    }
    if (V === 'reports' && (k === 'from' || k === 'to')) {
      F.preset = -1;
      document.querySelectorAll('[data-preset]').forEach(function (b) { b.classList.remove('on'); });
      var s = summary(F.from, F.to);
      document.getElementById('rsum').innerHTML = reportSummaryHtml(s, D.settings.vat);
      var none = !hasAny(s);
      document.querySelectorAll('[data-act=xls],[data-act=pdf],[data-act=shareXls],[data-act=sharePdf]').forEach(function (b) { b.disabled = none; });
    }
  }
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'dsearch') {
      LS.diary.q = el.value;
      var pos = el.selectionStart;
      diaryList();
      var n = document.getElementById('dsearch'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {}
      return;
    }
    var k = el.getAttribute && el.getAttribute('data-k');
    if (!k || !F || el.type === 'checkbox' || el.tagName === 'SELECT') return;
    F[k] = el.value;
    liveUpdate(k);
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'restoreFile') { restoreFile(el.files && el.files[0]); return; }
    if (el.id === 'logoIn') { if (el.files && el.files[0]) setLogo(el.files[0]); return; }
    if ((el.id === 'camIn' || el.id === 'galIn') && F) {
      var file = el.files && el.files[0];
      if (!file) return;
      shrinkPhoto(file).then(function (b) {
        F.newPhoto = b; F.photoSrc = URL.createObjectURL(b); F.photoRemoved = false; F.photoLater = false;
        render(); toast(t('photo_added'));
      }).catch(function () { toast(t('err_photo')); });
      return;
    }
    var k = el.getAttribute && el.getAttribute('data-k');
    if (!k || !F) return;
    if (el.type === 'checkbox') F[k] = el.checked;
    else F[k] = el.value;
    if (k === 'cat' && F.kind === 'money' && F.cat !== '__new' && !F.id) F.vatIncl = !NO_VAT_DEFAULT[F.cat];
    if (k === 'ap' && F.kind === 'insp') { var first = activeHives(F.ap).sort(hiveSort)[0]; if (F.ap && (!find('hives', F.hive) || find('hives', F.hive).ap !== F.ap)) F.hive = first ? first.id : ''; }
    if (k === 'ap' && (F.kind === 'harvest' || F.kind === 'care')) { var hv = find('hives', F.hive); if (hv && hv.ap !== F.ap) F.hive = ''; }
    if (k === 'hive' && F.kind === 'insp') { var h2 = find('hives', F.hive); if (h2) F.ap = h2.ap; }
    if (k === 'travelOn' && F.travelOn && !F.kmRate && D.settings.kmRate) F.kmRate = numIn(D.settings.kmRate);
    if (el.getAttribute('data-rr') || (k === 'hive' && F.kind === 'insp')) render();
    else liveUpdate(k);
  });
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (chip && F) {
      var k = chip.getAttribute('data-chip');
      F[k] = chip.getAttribute('data-v');
      if (k === 'dir' && F.kind === 'money') { var cs = catsFor(F.dir); if (cs.indexOf(F.cat) < 0) F.cat = cs[0]; F.vatIncl = !NO_VAT_DEFAULT[F.cat]; }
      if (k === 'lang') { D.settings.lang = F.lang; if (D.settings.setup) save(); }
      return render();
    }
    var mul = e.target.closest('[data-multi]');
    if (mul && F) {
      var mk = mul.getAttribute('data-multi'), v = mul.getAttribute('data-v'), arr = F[mk] || (F[mk] = []), i = arr.indexOf(v);
      if (i > -1) arr.splice(i, 1); else arr.push(v);
      return render();
    }
    var pre = e.target.closest('[data-preset]');
    if (pre && F) {
      var p = presets()[+pre.getAttribute('data-preset')];
      F.preset = +pre.getAttribute('data-preset'); F.from = p[1]; F.to = p[2];
      return render();
    }
    var btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    if (btn.tagName === 'A' && !btn.getAttribute('href')) e.preventDefault();
    if (btn.tagName === 'A' && btn.getAttribute('href') === '#') e.preventDefault();
    var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
    var keepConfirm = act === 'deleteForm' || act === 'wipe' || act === 'delCat' || act === 'logoRm';
    if (!keepConfirm) confirmKey = '';
    switch (act) {
      case 'tab': if (!isTab(V) && history.state && history.state.sub) { TAB = btn.getAttribute('data-tab'); history.back(); } else showTab(btn.getAttribute('data-tab')); break;
      case 'close': closeSub(); break;
      case 'new': openNew(btn.getAttribute('data-kind'), { dir: btn.getAttribute('data-dir'), ap: btn.getAttribute('data-ap') }); break;
      case 'hiveNew': openNew(btn.getAttribute('data-kind'), { hive: id }); break;
      case 'apNew': openNew(btn.getAttribute('data-kind'), { ap: id }); break;
      case 'clientDoc': openNew('doc', { dir: btn.getAttribute('data-dir'), client: id }); break;
      case 'inspAgain': openNew('insp', { hive: id }); break;
      case 'careDone':
        var cx = find('care', id);
        if (!cx) break;
        openNew('care', { ap: cx.ap, hive: cx.hive });
        Object.assign(F, { ctype: cx.type, product: cx.product, qty: cx.qty });
        render(); break;
      case 'hive': if (V === 'hive' && F.id === id) break; openSub('hive', { id: id }); break;
      case 'apiary': openSub('apiary', { id: id }); break;
      case 'client': if (V === 'client' && F.id === id) break; openSub('client', { id: id }); break;
      case 'doc': if (V === 'doc' && F.id === id) break; openSub('doc', { id: id }); break;
      case 'fuelv': openSub('fuelv', {}); break;
      case 'pending': if (V !== 'pending') openSub('pending', {}); break;
      case 'dfilter': LS.docs.f = btn.getAttribute('data-v'); render(); break;
      case 'docStatus': setDocStatus(btn.getAttribute('data-v')); break;
      case 'toInvoice': toInvoice(); break;
      case 'copyDoc': var cd = find('docs', F.id); if (cd) openNew('doc', { dir: cd.type, copy: cd }); break;
      case 'docPdf': exportDoc(false); break;
      case 'docShare': exportDoc(true); break;
      case 'payNew': payForm(F.id); break;
      case 'payEdit': payForm(F.id, id); break;
      case 'addSvc':
        var sv = D.settings.svcs.filter(function (x) { return x.id === id; })[0];
        if (sv) { addLine(sv.name, sv.price); render(); }
        break;
      case 'addLine': addLine('', 0); render(); break;
      case 'rmLine': rmLine(+btn.getAttribute('data-i')); render(); break;
      case 'nextIn': F.next = addDays(F.date || today(), +btn.getAttribute('data-v')); render(); break;
      case 'gps':
        if (!navigator.geolocation) { toast(t('gps_failed')); break; }
        toast(t('gps_wait'));
        navigator.geolocation.getCurrentPosition(function (pos) {
          if (V !== 'form' || !F || F.kind !== 'apiary') return;
          F.gps = pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5); render(); toast(t('gps_ok'));
        }, function () { toast(t('gps_failed')); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
        break;
      case 'logoRm':
        if (confirmKey !== 'logo') { confirmKey = 'logo'; return render(); }
        confirmKey = ''; D.settings.logo = ''; D.settings.logoW = 0; D.settings.logoH = 0; save(); render(); break;
      case 'rmPhoto': F.photoRemoved = true; F.newPhoto = null; F.photoSrc = null; render(); break;
      case 'viewPhoto': showPhoto(btn.getAttribute('src')); break;
      case 'edit': openEdit(btn.getAttribute('data-kind'), id); break;
      case 'saveForm': saveForm(); break;
      case 'deleteForm': deleteForm(); break;
      case 'finishSetup': finishSetup(); break;
      case 'mprev': case 'mnext':
        var view = btn.getAttribute('data-view');
        LS[view].ym = addMonths(LS[view].ym, act === 'mprev' ? -1 : 1); render(); break;
      case 'mfilter': LS.money.dir = btn.getAttribute('data-v'); render(); break;
      case 'more': LS[btn.getAttribute('data-view')].n += 30; render(); break;
      case 'reports': if (V !== 'reports') openReports(); break;
      case 'settings': if (V === 'settings') break; openSub('settings', { to: btn.getAttribute('data-to') || '' }); break;
      case 'saveSettings': saveSettings(); break;
      case 'xls': exportFile('xlsx'); break;
      case 'pdf': exportFile('pdf'); break;
      case 'shareXls': exportFile('xlsx', true); break;
      case 'sharePdf': exportFile('pdf', true); break;
      case 'backup': backup(); break;
      case 'restorePick': restorePick(); break;
      case 'applyRestore': applyRestore(); break;
      case 'cancelRestore': pendingRestore = null; F.restoreN = null; render(); break;
      case 'icsFile': reminderIcs(); break;
      case 'icsGoogle': reminderGoogle(); break;
      case 'delCat':
        var key = 'cat:' + btn.getAttribute('data-dir') + btn.getAttribute('data-v');
        if (confirmKey !== key) { confirmKey = key; return render(); }
        var dir = btn.getAttribute('data-dir'), name = btn.getAttribute('data-v');
        D.settings.cats[dir] = D.settings.cats[dir].filter(function (n) { return n !== name; });
        confirmKey = ''; save(); render(); break;
      case 'wipe':
        if (confirmKey !== 'wipe') { confirmKey = 'wipe'; return render(); }
        D = blank(); save(); photoClear(); photoUrls = {}; confirmKey = '';
        if (history.state && history.state.sub) history.back();
        F = null; V = 'home'; TAB = 'home'; render(); break;
      case 'install': doInstall(); break;
    }
  });

  function showPhoto(src) {
    var v = document.createElement('div');
    v.className = 'viewer';
    v.innerHTML = '<img src="' + src + '" alt=""><button class="icon close" aria-label="' + esc(t('close')) + '">✕</button>';
    v.addEventListener('click', function () { v.remove(); });
    document.body.appendChild(v);
  }

  /* Install button (Android Chrome / desktop Chrome & Edge) */
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); installEvt = e;
    var b = document.getElementById('installBtn'); if (b) b.classList.remove('hidden');
  });
  function doInstall() {
    if (!installEvt) return;
    installEvt.prompt();
    installEvt.userChoice.finally(function () {
      installEvt = null;
      var b = document.getElementById('installBtn'); if (b) b.classList.add('hidden');
    });
  }
  window.addEventListener('appinstalled', function () { toast(t('installed')); });

  /* Offline support */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  /* Re-check reminders when the app comes back to the front */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !D || !D.settings.setup) return;
    var n = runRecurring();
    if (V === 'home' || (n && isTab(V))) render();
  });

  /* ================================================================ */
  /* Start                                                             */
  /* ================================================================ */
  loadData().then(function (d) {
    D = normalise(d);
    history.replaceState({ root: 1 }, '');
    if (D.settings.setup) runRecurring();
    render();
  });

  // for automated tests only
  window.__BB = { get: function () { return D; }, pdf: function (id) { return buildDocPdf(find('docs', id)); }, xlsx: function () { F = F || {}; return buildExcel(); }, report: function () { return buildPdf(); } };
})();
