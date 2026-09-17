/* ============================================================
 * MW Utils — Dashboard Android
 * Replica della dashboard "points" dell'estensione Chrome
 * (mw_injected.js): stesse API, stessa aggregazione, stessi
 * calcoli di goal, milestones e gift card.
 *
 * Il codice gira DENTRO la pagina makerworld.com (iniettato via
 * evaluateJavascript): le fetch sono same-origin, quindi passano
 * Cloudflare e portano i cookie di sessione.
 * ============================================================ */
'use strict';

/* ---------------- costanti (come mw_injected.js) ---------------- */

var POINT_TO_USD = 0.066;               // 1 punto = 0.066 USD
var GOAL_KEY = 'mw_points_goal_usd';    // goal USD salvato dall'utente
var MARKET_KEY = 'mw_market';           // market delle gift card
var DEFAULT_GOAL_USD = 1000;
var MILESTONES = [100, 500, 1000, 5000];
var AVG_WINDOW_DAYS = 30;               // finestra media giornaliera (come estensione)

var MARKETS = ['IT', 'US', 'EU', 'UK', 'DE', 'FR', 'ES', 'JP', 'CN', 'AU', 'CA', 'BR'];
var CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', CNY: '¥', JPY: '¥', AUD: 'A$',
  CAD: 'C$', INR: '₹', KRW: '₩', RUB: '₽', BRL: 'R$', MXN: 'Mex$'
};

/* ---------------- stato globale ---------------- */

var state = {
  hits: [],
  labels: [],                 // date ISO ordinate (YYYY-MM-DD)
  dailyRegular: [],           // punti regular guadagnati al giorno
  dailyExclusiveEarned: [],   // punti exclusive guadagnati al giorno
  dailyExclusiveOut: [],      // punti exclusive riscattati al giorno
  dailyOut: [],               // punti totali usciti al giorno
  dailyEarnedTotal: [],       // regular + exclusive guadagnati al giorno (non arrotondati)
  monthly: new Map(),         // 'YYYY-MM' -> { earned, redeemed, days }
  modelRanking: [],
  modelDailyMap: new Map(),
  modelsNoPointsLast5: [],
  lastDateStr: null,
  balance: null,
  balanceEstimated: false,
  profile: null,
  giftcard: null,
  giftcardMsg: null,
  market: localStorage.getItem(MARKET_KEY) || null,
  range: 30,                  // 7 | 30 | 365
  chart: null,
  goalUsd: Number(localStorage.getItem(GOAL_KEY)) || DEFAULT_GOAL_USD,
  refreshing: false,
  boundRoot: null,            // root su cui sono agganciati i listener delegati
  buildId: null,
  avgDaily: 0,
  avgMonthlyUsd: 0,
  avgDailyUsd: 0,
  lastExclusiveCumulative: 0,
  exclusiveBalance: 0          // exclusive guadagnati meno riscatti, come l'estensione
};

/* ---------------- helper di formattazione ---------------- */

function byId(id) { return document.getElementById(id); }

function show(el, yes) { if (el) el.hidden = !yes; }

function showState(name) {
  show(byId('state-loading'), name === 'loading');
  show(byId('state-error'), name === 'error');
  show(byId('state-empty'), name === 'empty');
  show(byId('state-dashboard'), name === 'dashboard');
}

function sum(arr) {
  return arr.reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/** Importo con 2 decimali e simbolo valuta. */
function fmtMoney(amount, symbol) {
  var n = isNaN(Number(amount)) ? 0 : Number(amount);
  return (symbol || '$') + n.toFixed(2);
}

/** Importo in USD: $1.25 */
function fmtUsd(amount) { return fmtMoney(amount, '$'); }

/** Punti con 2 decimali SENZA arrotondamento all'intero (es. 169.63 / 1,740.50). */
function fmtPts(n) {
  var v = round2(n);
  var neg = v < 0;
  var parts = Math.abs(v).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + parts.join('.');
}

/** Interi con separatore migliaia. */
function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function dateKeyOf(d) {
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

/** 'YYYY-MM-DD' -> Date UTC (o null). */
function ymdToUtc(ymd) {
  var p = String(ymd || '').split('-').map(function (s) { return parseInt(s, 10); });
  if (p.length !== 3 || p.some(isNaN)) return null;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}

/** gg/mm da 'YYYY-MM-DD'. */
function shortDate(k) {
  var p = String(k).split('-');
  return p[2] + '/' + p[1];
}

function monthKeyOf(dateKey) { return String(dateKey).slice(0, 7); }

function currentMonthKey() {
  var now = new Date();
  return now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
}

/** Bridge nativo esposto da MainActivity (logout, login, toast, versione). */
function bridge() {
  return (typeof window.MwBridge !== 'undefined' && window.MwBridge) ? window.MwBridge : null;
}

function toast(msg) {
  try {
    var b = bridge();
    if (b && b.toast) { b.toast(String(msg)); return; }
  } catch (e) { /* ignora */ }
  if (window.console && console.warn) console.warn(msg);
}

function callBridge(fnName, fallbackMsg) {
  var b = bridge();
  try {
    if (b && typeof b[fnName] === 'function') { b[fnName](); return; }
  } catch (e) { /* ignora */ }
  toast(fallbackMsg || 'Funzione non disponibile');
}

/* ---------------- fetch same-origin ---------------- */

function fetchJson(url) {
  return fetch(url, { credentials: 'same-origin' }).then(function (r) {
    return r.text().then(function (t) {
      var json = null;
      try { json = JSON.parse(t); } catch (e) { /* corpo non JSON */ }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (json === null) throw new Error('Risposta non valida dal server');
      return json;
    });
  });
}

function fetchText(url) {
  return fetch(url, { credentials: 'same-origin' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}

/** Storico movimenti punti: /api/v1/point-service/point-bill/my */
function fetchPointBill() {
  return fetchJson('https://makerworld.com/api/v1/point-service/point-bill/my?filter=all&limit=10000')
    .then(function (json) {
      var hits = (json && Array.isArray(json.hits)) ? json.hits.slice() : [];
      if (!hits.length) throw new Error('EMPTY');
      hits.sort(function (a, b) { return new Date(a.createTime) - new Date(b.createTime); });
      return hits;
    });
}

/** Estrae il buildId Next.js dall'HTML (ignora i path non-build come 'chunks'). */
function extractBuildId(html) {
  var s = String(html || '');
  var m = s.match(/_next\/static\/([^\/"'\\]+)\/_buildManifest\.js/);
  if (m && m[1]) return m[1];
  var re = /_next\/static\/([^\/"'\\]+)\//g;
  var mm;
  while ((mm = re.exec(s))) {
    var id = mm[1];
    if (id === 'chunks' || id === 'css' || id === 'media' || id === 'image') continue;
    return id;
  }
  return null;
}

/** buildId dai tag <script src> della pagina (come fa l'estensione). */
function buildIdFromPage() {
  try {
    var scripts = Array.prototype.slice.call(document.querySelectorAll('script[src]'));
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('buildManifest') > -1) {
        var part = src.split('/')[5];
        if (part) { localStorage.setItem('mw_build_manifest_id', part); return part; }
      }
    }
    for (var j = 0; j < scripts.length; j++) {
      var m = String(scripts[j].src || '').match(/_next\/static\/([^\/"'\\]+)\//);
      if (m && m[1] && m[1] !== 'chunks' && m[1] !== 'css' && m[1] !== 'media') {
        localStorage.setItem('mw_build_manifest_id', m[1]);
        return m[1];
      }
    }
  } catch (e) { /* ignora */ }
  return localStorage.getItem('mw_build_manifest_id') || null;
}

/** buildId affidabile: prima dai tag script, poi dall'HTML di /en/points. */
function resolveBuildId() {
  var id = buildIdFromPage();
  if (id) return Promise.resolve(id);
  return fetchText('https://makerworld.com/en/points')
    .then(function (html) { return extractBuildId(html) || buildIdFromPage(); })
    .catch(function () { return null; });
}

/** Saldo punti corrente: point / availablePoint (NON il totale storico). */
function fetchBalance(hits, buildId) {
  state.balanceEstimated = false;
  return fetchText('https://makerworld.com/en/points').then(function (html) {
    var id = buildId || extractBuildId(html) || buildIdFromPage();
    var viaJson = id
      ? fetchJson('https://makerworld.com/_next/data/' + id + '/en/points.json')
          .then(function (j) {
            var p = j && j.pageProps && j.pageProps.pointInfo;
            if (!p) return null;
            var v = Number(p.point) || Number(p.availablePoint) || Number(p.totalPoint);
            return isNaN(v) ? null : v;
          }).catch(function () { return null; })
      : Promise.resolve(null);

    return viaJson.then(function (v) {
      if (v != null) return v;
      var m = String(html).match(/"point"\s*:\s*([0-9.]+)/) ||
              String(html).match(/"availablePoint"\s*:\s*([0-9.]+)/);
      return m ? Number(m[1]) : null;
    });
  }).catch(function () { return null; }).then(function (v) {
    if (v != null) return v;
    // fallback: somma algebrica dei movimenti (storico completo)
    if (Array.isArray(hits) && hits.length) {
      var tot = 0;
      hits.forEach(function (h) {
        tot += (Number(h.pointChangeRegular) || 0) + (Number(h.pointChangeExclusive) || 0);
      });
      if (tot > 0) { state.balanceEstimated = true; return round2(tot); }
    }
    return null;
  });
}

function fetchProfile(buildId) {
  var id = buildId || buildIdFromPage();
  if (!id) return Promise.resolve(null);
  return fetchJson('https://makerworld.com/_next/data/' + id + '/en.json').then(function (j) {
    var u = j && j.pageProps && j.pageProps.session && j.pageProps.session.user;
    if (!u) return null;
    var mwc = u.MWCount || {};
    return {
      name: u.name || u.handle || u.username || null,
      avatar: u.userAvatar || u.avatarUrl || u.avatar || null,
      downloads: (typeof mwc.myDesignDownloadCount === 'number') ? mwc.myDesignDownloadCount : null,
      prints: (typeof mwc.myDesignPrintCount === 'number') ? mwc.myDesignPrintCount : null
    };
  }).catch(function () { return null; });
}

/* ---------------- gift card (stessa logica dell'estensione) ---------------- */

/** Ricava un codice market (2 lettere) dall'oggetto shop dell'API. */
function marketFromShop(shop) {
  if (!shop) return null;
  var cands = [shop.code, shop.shopCode, shop.shop, shop.country, shop.region, shop.name];
  for (var i = 0; i < cands.length; i++) {
    var v = cands[i];
    if (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim())) return v.trim().toUpperCase();
  }
  return null;
}

/** Sceglie la gift card base (prezzo più basso) dalla risposta API. */
function pickGiftcard(json) {
  var hits = (json && Array.isArray(json.hits)) ? json.hits : null;
  if (!hits) return null;
  var cards = hits.filter(function (el) {
    var t = String((el && el.title) || '').toLowerCase();
    return t.indexOf('gift card') > -1 && Number(el.price) > 0;
  });
  if (!cards.length) return null;
  cards.sort(function (a, b) { return Number(a.price) - Number(b.price); });
  for (var i = 0; i < cards.length; i++) {
    var gc = cards[i];
    var sb = gc.selfBuiltGiftcard || null;
    var g2 = gc.giftcard || null;
    var value = Number((sb && sb.value) || (g2 && g2.value) || 0) || null;
    var shop = (sb && sb.shop) || (g2 && g2.shop) || null;
    var currency = (shop && shop.currency) || null;
    if (value && currency) {
      return {
        price: Number(gc.price),
        value: value,
        currency: currency,
        title: gc.title || null,
        market: marketFromShop(shop)
      };
    }
  }
  return null;
}

var PRODUCTS_URL = 'https://makerworld.com/api/v1/point-service/product/products';

/**
 * Gift card per il market scelto. Se il market non produce risultati
 * riprova senza parametro shop (il server usa il market dell'account).
 * In caso di errore restituisce { error: '...' } da mostrare a video.
 */
function fetchGiftcards(market) {
  var first = market ? (PRODUCTS_URL + '?shop=' + encodeURIComponent(market)) : PRODUCTS_URL;
  return fetchJson(first).then(function (json) {
    var gc = pickGiftcard(json);
    if (gc) return gc;
    if (!market) return { error: 'Nessuna gift card disponibile' };
    return fetchJson(PRODUCTS_URL).then(function (j2) {
      var gc2 = pickGiftcard(j2);
      if (gc2) return gc2;
      return { error: 'Nessuna gift card per il market ' + market };
    }).catch(function () {
      return { error: 'Nessuna gift card per il market ' + market };
    });
  }).catch(function (e) {
    // La gift card NON deve mai propagare 401/403 come "sessione scaduta":
    // l'API product/products risponde 403 anche con sessione valida (CSRF).
    // L'errore resta confinato nella card, il resto della dashboard funziona.
    var msg = (e && e.message) ? e.message : String(e);
    if (/HTTP (401|403)/.test(msg)) return { error: 'API gift card non disponibile' };
    return { error: 'API gift card non raggiungibile (' + msg + ')' };
  });
}

/* ---------------- aggregazione (replica dell'estensione) ---------------- */

function aggregate(hits) {
  var dateMap = new Map();
  var modelMap = new Map();
  var modelDailyMap = new Map();

  hits.forEach(function (entry) {
    var dateKey = dateKeyOf(new Date(entry.createTime));
    var reg = Number(entry.pointChangeRegular) || 0;
    var exc = Number(entry.pointChangeExclusive) || 0;

    if (!dateMap.has(dateKey)) dateMap.set(dateKey, { regular: 0, exclusivePos: 0, exclusiveOut: 0, out: 0 });
    var obj = dateMap.get(dateKey);

    if (reg !== 0) {
      if (reg >= 0) obj.regular += reg;
      else obj.out += Math.abs(reg);
    }
    if (exc !== 0) {
      if (exc >= 0) obj.exclusivePos += exc;
      else { obj.exclusiveOut += Math.abs(exc); obj.out += Math.abs(exc); }
    }

    // titolo modello (stessa logica dell'estensione)
    try {
      var title = null;
      var t = entry.type || '';
      if (t === 'boost_exchange_point' && entry.extInfoBoostExchangePoint && entry.extInfoBoostExchangePoint.designTitle) {
        title = String(entry.extInfoBoostExchangePoint.designTitle).trim();
      } else if (t === 'instance_reward_v2' && entry.instanceRewardV2 && entry.instanceRewardV2.designTitle) {
        title = String(entry.instanceRewardV2.designTitle).trim();
      } else if (t === 'design_reward_v2' && entry.designRewardV2 && entry.designRewardV2.title) {
        title = String(entry.designRewardV2.title).trim();
      }
      if (title) {
        var pts = round2((reg > 0 ? reg : 0) + (exc > 0 ? exc : 0));
        if (pts > 0) {
          if (!modelMap.has(title)) modelMap.set(title, { total: 0, lastDate: null });
          var m = modelMap.get(title);
          m.total = round2(m.total + pts);
          m.lastDate = dateKey;
          if (!modelDailyMap.has(dateKey)) modelDailyMap.set(dateKey, new Map());
          var dayMap = modelDailyMap.get(dateKey);
          dayMap.set(title, round2((dayMap.get(title) || 0) + pts));
        }
      }
    } catch (e) { /* ignora */ }
  });

  var labels = Array.from(dateMap.keys()).sort();

  function series(fn) {
    return labels.map(function (k) {
      var v = dateMap.get(k);
      return v ? round2(fn(v)) : 0;
    });
  }

  state.dailyRegular = series(function (v) { return v.regular; });
  state.dailyExclusiveEarned = series(function (v) { return v.exclusivePos; });
  state.dailyExclusiveOut = series(function (v) { return v.exclusiveOut; });
  state.dailyOut = series(function (v) { return v.out; });
  state.dailyEarnedTotal = state.dailyRegular.map(function (v, i) {
    return round2(v + state.dailyExclusiveEarned[i]);
  });

  // riepilogo mensile (exclusive earned / redeemed)
  var monthly = new Map();
  labels.forEach(function (k, i) {
    var mk = monthKeyOf(k);
    if (!monthly.has(mk)) monthly.set(mk, { earned: 0, redeemed: 0, days: 0 });
    var o = monthly.get(mk);
    o.earned = round2(o.earned + state.dailyExclusiveEarned[i]);
    o.redeemed = round2(o.redeemed + state.dailyExclusiveOut[i]);
    o.days += 1;
  });

  state.modelRanking = Array.from(modelMap.entries())
    .map(function (e) { return { title: e[0], total: e[1].total, lastDate: e[1].lastDate }; })
    .sort(function (a, b) { return b.total - a.total; });

  // modelli senza punti negli ultimi 5 giorni (rispetto all'ultimo giorno con dati)
  var lastKey = labels.length ? labels[labels.length - 1] : null;
  var stale = [];
  if (lastKey) {
    var lastUtc = ymdToUtc(lastKey);
    var cut = lastUtc ? (lastUtc.getTime() - 4 * 86400000) : null;
    if (cut != null) {
      state.modelRanking.forEach(function (m) {
        var d = m.lastDate ? ymdToUtc(m.lastDate) : null;
        if (!d || d.getTime() < cut) stale.push(m);
      });
    }
  }

  state.hits = hits;
  state.labels = labels;
  state.monthly = monthly;
  state.modelDailyMap = modelDailyMap;
  state.modelsNoPointsLast5 = stale;
  state.lastDateStr = lastKey;

  // cumulativo exclusive guadagnati (usato da goal e milestones)
  state.lastExclusiveCumulative = round2(sum(state.dailyExclusiveEarned));

  // exclusive NETTI (guadagnati - riscattati): usati dal goal, come l'estensione
  state.exclusiveBalance = round2(state.lastExclusiveCumulative - sum(state.dailyExclusiveOut));

  // media giornaliera exclusive (ultimi 30 giorni con valore > 0), come l'estensione
  var windowSize = Math.min(AVG_WINDOW_DAYS, state.dailyExclusiveEarned.length);
  var recent = state.dailyExclusiveEarned.slice(-windowSize).filter(function (v) {
    return typeof v === 'number' && !isNaN(v) && v > 0;
  });
  state.avgDaily = recent.length ? (sum(recent) / recent.length) : 0;
}

/* ---------------- rendering: card principali ---------------- */

function renderCards() {
  var lastIdx = state.labels.length - 1;
  var lastEarned = lastIdx >= 0 ? state.dailyEarnedTotal[lastIdx] : 0;
  var lastReg = lastIdx >= 0 ? state.dailyRegular[lastIdx] : 0;
  var lastExc = lastIdx >= 0 ? state.dailyExclusiveEarned[lastIdx] : 0;

  /* 1) Punti dell'ultimo giorno — valore NON arrotondato (es. 169.63) */
  byId('card-lastday').innerHTML = fmtPts(lastEarned) + '<span class="unit">pts</span>';
  byId('card-lastday-foot').innerHTML =
    '<div>' + (state.lastDateStr || '—') + ' · ≈ <strong>' + fmtUsd(lastExc * POINT_TO_USD) +
    '</strong> (exclusive)</div>' +
    '<div class="card-foot-2">Regular ' + fmtPts(lastReg) + ' · Exclusive ' + fmtPts(lastExc) + '</div>';

  /* 3) USD del mese corrente (exclusive earnati) */
  var mk = currentMonthKey();
  var mObj = state.monthly.get(mk) || { earned: 0, redeemed: 0, days: 0 };
  var monthUsd = mObj.earned * POINT_TO_USD;
  byId('card-month').innerHTML = fmtUsd(monthUsd);
  byId('card-month-foot').innerHTML =
    '<div>' + mk + ' · ' + fmtPts(mObj.earned) + ' pts exclusive</div>' +
    '<div class="card-foot-2">' + mObj.days + ' giorni con attività</div>';

  /* 4) Totale da sempre (USD) + medie mensile e giornaliera (USD) */
  var totalPts = state.lastExclusiveCumulative || 0;
  var totalUsd = totalPts * POINT_TO_USD;
  var months = state.monthly.size;
  state.avgMonthlyUsd = months ? (totalUsd / months) : 0;
  state.avgDailyUsd = state.labels.length ? (totalUsd / state.labels.length) : 0;
  byId('card-total').innerHTML = fmtUsd(totalUsd);
  byId('card-total-foot').innerHTML =
    '<div>Media mese <strong>' + fmtUsd(state.avgMonthlyUsd) + '</strong></div>' +
    '<div>Media giorno <strong>' + fmtUsd(state.avgDailyUsd) + '</strong></div>' +
    '<div class="card-foot-2">' + fmtPts(totalPts) + ' pts exclusive</div>';
}

/* ---------------- rendering: widget goal (come l'estensione) ---------------- */

var GOAL_RING_R = 23;                       // r = (56 - 10) / 2
var GOAL_RING_C = 2 * Math.PI * GOAL_RING_R;

function goalValues() {
  var goalUsd = Number(state.goalUsd) || DEFAULT_GOAL_USD;
  if (goalUsd <= 0) goalUsd = DEFAULT_GOAL_USD;
  var currentUsd = round2((state.exclusiveBalance || 0) * POINT_TO_USD);
  var percent = Math.min(1, Math.max(0, (currentUsd / goalUsd) || 0));
  var goalPts = goalUsd / POINT_TO_USD;
  var days = null;
  if (state.avgDaily > 0) {
    var remainingPts = Math.max(0, goalPts - (state.exclusiveBalance || 0));
    days = Math.ceil(remainingPts / state.avgDaily);
  }
  var etaDate = null;
  var base = state.lastDateStr ? ymdToUtc(state.lastDateStr) : null;
  if (days != null && isFinite(days) && base) {
    etaDate = new Date(base.getTime() + days * 86400000);
  }
  return {
    goalUsd: goalUsd,
    currentUsd: currentUsd,
    percent: percent,
    percentLabel: Math.round(percent * 100),
    days: days,
    etaDate: etaDate,
    hue: Math.round(percent * 120)   // 0 = rosso → 120 = verde
  };
}

function etaLabel(v) {
  if (v.days == null || !isFinite(v.days)) return 'N/D';
  var d = (v.days === 1) ? '1 giorno' : (v.days + ' giorni');
  return d + (v.etaDate ? ' · ' + dateKeyOf(v.etaDate) : '');
}

function renderGoal() {
  var el = byId('goal-widget');
  if (!el) return;
  var v = goalValues();
  var color = 'hsl(' + v.hue + ',80%,45%)';
  var offset = GOAL_RING_C * (1 - v.percent);

  // Se l'utente sta digitando non ricreiamo il DOM: aggiorniamo solo i valori.
  var input = byId('goal-input');
  if (input && document.activeElement === input && byId('goal-ring')) {
    byId('goal-ring').setAttribute('stroke-dashoffset', String(offset));
    byId('goal-ring').setAttribute('stroke', color);
    if (byId('goal-amounts')) byId('goal-amounts').textContent = fmtUsd(v.currentUsd) + ' / ' + fmtUsd(v.goalUsd);
    if (byId('goal-progress')) byId('goal-progress').innerHTML = 'Avanzamento: <strong>' + v.percentLabel + '%</strong>';
    if (byId('goal-eta')) byId('goal-eta').textContent = 'ETA: ' + etaLabel(v);
    return;
  }

  el.innerHTML =
    '<div class="goal-wrap">' +
      '<svg class="goal-svg" width="56" height="56" viewBox="0 0 56 56">' +
        '<circle cx="28" cy="28" r="' + GOAL_RING_R + '" stroke="rgba(255,255,255,0.10)" stroke-width="10" fill="none"/>' +
        '<circle id="goal-ring" cx="28" cy="28" r="' + GOAL_RING_R + '" stroke="' + color + '" stroke-width="10" fill="none"' +
        ' stroke-dasharray="' + GOAL_RING_C + '" stroke-dashoffset="' + offset + '" stroke-linecap="round"' +
        ' transform="rotate(-90 28 28)"/>' +
      '</svg>' +
      '<div class="goal-info">' +
        '<div class="goal-amounts" id="goal-amounts">' + fmtUsd(v.currentUsd) + ' / ' + fmtUsd(v.goalUsd) + '</div>' +
        '<div class="goal-sub" id="goal-progress">Avanzamento: <strong>' + v.percentLabel + '%</strong></div>' +
        '<div class="goal-sub" id="goal-eta">ETA: ' + etaLabel(v) + '</div>' +
        '<div class="goal-sub">' + fmtPts(v.currentUsd / POINT_TO_USD) + ' pts exclusive (netti riscatti)</div>' +
      '</div>' +
    '</div>' +
    '<div class="goal-form">' +
      '<input id="goal-input" class="goal-input" type="number" min="1" step="1" value="' + v.goalUsd + '">' +
      '<button id="goal-save" class="goal-btn">Salva</button>' +
      '<button id="goal-reset" class="goal-btn ghost">Reset</button>' +
    '</div>';
}

function saveGoal() {
  var input = byId('goal-input');
  var val = input ? Number(input.value) : 0;
  if (!val || val <= 0) { toast('Inserisci un obiettivo maggiore di 0'); return; }
  state.goalUsd = val;
  localStorage.setItem(GOAL_KEY, String(val));
  renderGoal();
  toast('Obiettivo salvato: ' + fmtUsd(val));
}

function resetGoal() {
  state.goalUsd = DEFAULT_GOAL_USD;
  localStorage.removeItem(GOAL_KEY);
  renderGoal();
  toast('Obiettivo reimpostato a ' + fmtUsd(DEFAULT_GOAL_USD));
}

/* ---------------- rendering: grafico + selettore periodo ---------------- */

function ensureChart() {
  if (window.Chart) return Promise.resolve();
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error('Chart.js non disponibile')); };
    document.head.appendChild(s);
  });
}

function setRange(days) {
  state.range = days;
  var btns = document.querySelectorAll('#mw-root .range-btn');
  Array.prototype.forEach.call(btns, function (b) {
    var isActive = String(parseInt(b.getAttribute('data-range'), 10)) === String(days);
    b.classList[isActive ? 'add' : 'remove']('active');
  });
  renderChart();
}

function destroyChart() {
  try {
    var canvas = byId('chart');
    if (canvas && window.Chart && window.Chart.getChart) {
      var existing = window.Chart.getChart(canvas);
      if (existing) existing.destroy();
    }
  } catch (e) { /* ignora */ }
  if (state.chart) {
    try { state.chart.destroy(); } catch (e) { /* ignora */ }
    state.chart = null;
  }
}

function renderChart() {
  var canvas = byId('chart');
  if (!canvas || !window.Chart) return;

  destroyChart();

  var n = state.range > 0 ? Math.min(state.range, state.labels.length) : state.labels.length;
  var labels = state.labels.slice(-n).map(shortDate);

  state.chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Regular', data: state.dailyRegular.slice(-n),
          borderColor: '#0BC9B3', backgroundColor: 'rgba(11,201,179,0.15)',
          fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2
        },
        {
          label: 'Exclusive', data: state.dailyExclusiveEarned.slice(-n),
          borderColor: '#9C6ADE', backgroundColor: 'rgba(156,106,222,0.12)',
          fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2
        },
        {
          label: 'Spesi', data: state.dailyOut.slice(-n),
          borderColor: '#F45B69', backgroundColor: 'rgba(244,91,105,0.10)',
          fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8B9BAA', boxWidth: 12, boxHeight: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: function (c) {
              var base = c.dataset.label + ': ' + fmtPts(c.parsed.y) + ' pts';
              // Come l'estensione: la conversione USD si applica solo ai punti exclusive.
              if (c.dataset.label === 'Exclusive') {
                return base + ' (' + fmtUsd(c.parsed.y * POINT_TO_USD) + ')';
              }
              return base;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#5B6B7A', autoSkip: true, maxTicksLimit: 7, font: { size: 10 } },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#5B6B7A', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

/* ---------------- rendering: gift card ---------------- */

function fillMarketSelect(selected) {
  var sel = byId('market-select');
  if (!sel) return;
  if (!sel.options.length) {
    MARKETS.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      sel.appendChild(o);
    });
  }
  if (selected) sel.value = selected;
}

function renderGiftcard() {
  var gc = state.giftcard;
  var title = byId('giftcard-title');
  var sub = byId('giftcard-sub');
  var bar = byId('giftcard-bar');
  var saldo = byId('giftcard-saldo');
  if (!title || !sub || !bar) return;

  // Il market rilevato dall'API ha priorità su quello memorizzato.
  if (gc && gc.market) state.market = gc.market;
  fillMarketSelect(state.market || 'IT');

  var balTxt = (state.balance != null)
    ? fmtPts(state.balance) + ' pts' + (state.balanceEstimated ? ' (stimati)' : '')
    : 'saldo non disponibile';
  if (saldo) saldo.textContent = 'Saldo: ' + balTxt;

  if (!gc || gc.error) {
    title.textContent = 'Gift Card';
    sub.textContent = (gc && gc.error) ? gc.error
      : 'Seleziona il market per calcolare le gift card';
    bar.style.width = '0%';
    if (gc && gc.market) fillMarketSelect(gc.market);
    return;
  }

  if (state.balance == null) {
    title.textContent = 'Gift Card · ' + fmtInt(gc.price) + ' pts';
    sub.textContent = 'Valore ' + (CURRENCY_SYMBOLS[gc.currency] || gc.currency) + fmtInt(gc.value) +
      ' — saldo punti non disponibile';
    bar.style.width = '0%';
    return;
  }

  var num = Math.floor(state.balance / gc.price);
  var sym = CURRENCY_SYMBOLS[gc.currency] || gc.currency;
  var remainder = state.balance % gc.price;
  var toNext = round2(gc.price - remainder);
  var totalValue = round2(gc.value * num);

  title.textContent = num + ' Gift Card' + (num === 1 ? '' : 's') + ' (' + sym + fmtInt(gc.value) + ')';
  sub.innerHTML = 'Totale <strong>' + sym + fmtInt(totalValue) + '</strong> · Card = ' + fmtInt(gc.price) +
    ' pts · <strong>' + fmtPts(toNext) + ' pts</strong> alla prossima' +
    (gc.market ? ' · market ' + gc.market : '');
  bar.style.width = Math.min(100, Math.max(2, (remainder / gc.price) * 100)) + '%';
}

function onMarketChange(market) {
  state.market = market;
  localStorage.setItem(MARKET_KEY, market);
  var sub = byId('giftcard-sub');
  if (sub) sub.textContent = 'Caricamento gift card per ' + market + '…';
  fetchGiftcards(market).then(function (gc) {
    state.giftcard = gc;
    renderGiftcard();
  }).catch(function (e) {
    state.giftcard = { error: 'Errore: ' + ((e && e.message) || e) };
    renderGiftcard();
  });
}

/* ---------------- rendering: milestones ("Quando raggiungerò…") ---------------- */

function renderMilestones() {
  var wrap = byId('milestones');
  if (!wrap) return;
  wrap.innerHTML = '';

  var avg = state.avgDaily;
  var base = state.lastExclusiveCumulative || 0;
  var lastDate = state.lastDateStr ? ymdToUtc(state.lastDateStr) : null;

  if (!avg || avg <= 0 || !lastDate) {
    wrap.innerHTML = '<div class="muted">Attività exclusive insufficiente per stimare le tappe.</div>';
    return;
  }

  var head = document.createElement('div');
  head.className = 'model-sub';
  head.style.marginBottom = '8px';
  head.textContent = 'Media exclusive ' + fmtPts(avg) + ' pts/giorno (' + fmtUsd(avg * POINT_TO_USD) +
    ') · totale attuale ' + fmtPts(base) + ' pts (' + fmtUsd(base * POINT_TO_USD) + ')';
  wrap.appendChild(head);

  MILESTONES.forEach(function (ms) {
    var target = round2(base + ms);
    var days = Math.max(0, Math.ceil((target - base) / avg));
    var reach = new Date(lastDate.getTime() + days * 86400000);

    var row = document.createElement('div');
    row.className = 'pred-item';
    row.innerHTML = '<span class="k">+' + fmtInt(ms) + ' pts</span>' +
      '<span class="v">' + fmtPts(target) + ' pts</span>';
    wrap.appendChild(row);

    var sub = document.createElement('div');
    sub.className = 'model-sub';
    sub.style.margin = '-6px 0 4px';
    sub.textContent = 'il ' + dateKeyOf(reach) + ' (~' + days + ' gg) · ' + fmtUsd(target * POINT_TO_USD);
    wrap.appendChild(sub);
  });
}

/* ---------------- rendering: riepilogo mensile ---------------- */

function renderMonthly() {
  var wrap = byId('monthly-wrap');
  if (!wrap) return;
  var keys = Array.from(state.monthly.keys()).sort().reverse().slice(0, 12);
  var html = '<table><tr><th>Mese</th><th class="num">Guadagnati (USD)</th>' +
    '<th class="num">Riscattati (USD)</th><th class="num">Giorni</th></tr>';
  if (!keys.length) {
    html += '<tr><td colspan="4" class="muted">Nessun dato mensile.</td></tr>';
  }
  keys.forEach(function (k) {
    var o = state.monthly.get(k);
    html += '<tr><td>' + k + '</td>' +
      '<td class="num">' + fmtUsd(o.earned * POINT_TO_USD) + '</td>' +
      '<td class="num">' + fmtUsd(o.redeemed * POINT_TO_USD) + '</td>' +
      '<td class="num">' + o.days + '</td></tr>';
  });
  html += '</table>';
  wrap.innerHTML = html;
}

/* ---------------- rendering: modelli ---------------- */

function modelRow(title, pts, maxPts, sub) {
  var pct = maxPts > 0 ? (pts / maxPts) * 100 : 0;
  return '<div class="model-row">' +
    '<div class="model-top"><span class="model-name">' + escapeHtml(title) + '</span>' +
    '<span class="model-pts">' + fmtPts(pts) + ' pts</span></div>' +
    '<div class="model-bar-track"><div class="model-bar" style="width:' + pct + '%"></div></div>' +
    (sub ? '<div class="model-sub">' + escapeHtml(sub) + '</div>' : '') +
    '</div>';
}

function renderModels() {
  var top = byId('top-models');
  var top5 = state.modelRanking.slice(0, 5);
  if (top) {
    if (!top5.length) {
      top.innerHTML = '<div class="muted">Nessun modello con punti registrati.</div>';
    } else {
      var max = top5[0].total;
      top.innerHTML = top5.map(function (m) {
        return modelRow(m.title, m.total, max, 'Ultimi punti: ' + (m.lastDate || 'N/D'));
      }).join('');
    }
  }

  var bd = byId('last-breakdown');
  if (bd) {
    var dayMap = state.lastDateStr ? state.modelDailyMap.get(state.lastDateStr) : null;
    if (dayMap && dayMap.size) {
      var entries = Array.from(dayMap.entries()).sort(function (a, b) { return b[1] - a[1]; });
      var maxPts = entries[0][1];
      bd.innerHTML = '<div class="model-sub" style="margin-bottom:6px">Ultimo giorno: ' +
        state.lastDateStr + '</div>' +
        entries.map(function (e) { return modelRow(e[0], e[1], maxPts, null); }).join('');
    } else {
      bd.innerHTML = '<div class="muted">Nessun modello con punti nell\'ultimo giorno registrato.</div>';
    }
  }

  var stale = byId('stale-models');
  if (stale) {
    if (state.modelsNoPointsLast5.length) {
      stale.innerHTML = state.modelsNoPointsLast5.slice(0, 10).map(function (m) {
        return '<div class="model-top"><span class="model-name">' + escapeHtml(m.title) + '</span>' +
          '<span class="model-sub">ultimo: ' + (m.lastDate || 'N/D') + '</span></div>';
      }).join('');
    } else {
      stale.innerHTML = '<div class="muted">Tutti i modelli hanno generato punti di recente. 👍</div>';
    }
  }
}

/* ---------------- header / footer ---------------- */

function renderHeader() {
  var sub = byId('header-user');
  var p = state.profile;
  if (sub) {
    if (p && p.name) {
      sub.innerHTML = (p.avatar ? '<img src="' + escapeHtml(p.avatar) + '">' : '') +
        '<span>' + escapeHtml(p.name) + '</span>';
    } else {
      sub.textContent = 'Dashboard punti';
    }
  }
  var foot = byId('footer');
  if (foot) {
    var v = 'MW Utils';
    try {
      var b = bridge();
      if (b && b.appVersion) v += ' v' + b.appVersion();
    } catch (e) { /* ignora */ }
    foot.textContent = v + ' · dati da makerworld.com';
  }
}

/* ---------------- eventi (delegati su #mw-root) ---------------- */

function closestId(node, root, id) {
  var el = node;
  while (el && el !== root) {
    if (el.id === id) return el;
    el = el.parentElement;
  }
  return null;
}

function bindEvents() {
  var root = byId('mw-root');
  if (!root || state.boundRoot === root) return;
  state.boundRoot = root;   // listeners delegati sul root corrente (nuovo dopo re-iniezione)

  root.addEventListener('click', function (ev) {
    var t = ev.target;

    if (closestId(t, root, 'btn-refresh') || closestId(t, root, 'btn-retry')) { refresh(); return; }
    if (closestId(t, root, 'btn-logout')) { callBridge('logout', 'Logout non disponibile'); return; }
    if (closestId(t, root, 'btn-relogin')) { callBridge('openLogin', 'Login non disponibile'); return; }
    if (closestId(t, root, 'goal-save')) { saveGoal(); return; }
    if (closestId(t, root, 'goal-reset')) { resetGoal(); return; }

    var rangeBtn = (t && t.closest) ? t.closest('.range-btn') : null;
    if (rangeBtn) {
      var days = parseInt(rangeBtn.getAttribute('data-range'), 10) || 30;
      setRange(days);
    }
  });

  root.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'market-select') onMarketChange(ev.target.value);
  });

  root.addEventListener('keydown', function (ev) {
    if (ev.target && ev.target.id === 'goal-input' && ev.key === 'Enter') {
      ev.preventDefault();
      saveGoal();
    }
  });
}

/* ---------------- orchestrazione ---------------- */

function renderAll() {
  renderHeader();
  renderCards();
  renderGoal();
  renderGiftcard();
  renderMilestones();
  renderMonthly();
  renderModels();
}

function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  if (!state.labels.length) showState('loading');   // niente flash se la dashboard è già visibile

  fetchPointBill()
    .then(function (hits) {
      aggregate(hits);
      return resolveBuildId().then(function (id) {
        state.buildId = id;
        return Promise.all([fetchBalance(hits, id), fetchProfile(id)]);
      });
    })
    .then(function (res) {
      state.balance = res[0];
      state.profile = res[1];
      fillMarketSelect(state.market || 'IT');
      return fetchGiftcards(state.market || 'IT');
    })
    .then(function (gc) {
      state.giftcard = gc || null;
      if (gc && gc.market && gc.market !== state.market) {
        state.market = gc.market;
        localStorage.setItem(MARKET_KEY, gc.market);
      }
      state.refreshing = false;
      showState('dashboard');
      renderAll();
      return ensureChart()
        .then(function () { renderChart(); })
        .catch(function () { /* dashboard utilizzabile anche senza grafico */ });
    })
    .catch(function (e) {
      state.refreshing = false;
      var msg = (e && e.message) ? e.message : String(e);

      if (/HTTP (401|403)/.test(msg)) {
        // Sessione scaduta: la pagina mostra di nuovo il login.
        var em = byId('error-msg');
        if (em) em.textContent = 'Sessione scaduta. Effettua di nuovo il login.';
        showState('error');
        callBridge('openLogin', 'Sessione scaduta');
        return;
      }
      if (msg === 'EMPTY') { showState('empty'); return; }

      var em2 = byId('error-msg');
      if (em2) em2.textContent = 'Errore nel caricamento: ' + msg;
      showState('error');
    });
}

function boot() {
  bindEvents();   // idempotente: si riaggancia se l'overlay è stato ricreato
  if (window.__mwDashBooted) {
    // Overlay ricreato (nuova iniezione): ridisegna senza rifare il fetch.
    if (state.labels.length) renderAll(); else refresh();
    return;
  }
  window.__mwDashBooted = true;
  refresh();
}

window.MWDash = {
  boot: boot,
  refresh: refresh,
  renderAll: renderAll,
  setRange: setRange,
  state: state
};

boot();