// Usage Pulse - client side.
//
// A compact composer-dock meter: current DeepSeek peak / off-peak regime with
// a live countdown, today's token spend in CNY, and (on expand) the session
// breakdown, 24-hour / 7-day usage bars and the current official unit prices.
//
// Data comes from the host half of this bundle through a same-origin route:
//   GET /usage-pulse/api/snapshot?sessionId=<id>

window.__ModuleLoader__.load({
  id: 'dsh-usage-pulse',
  factory(require) {
    const React = require('react');
    const { useEffect, useRef, useState } = React;

    const NS = 'usage-pulse';
    const API = '/usage-pulse/api/snapshot';
    const POLL_MS = 5000;

    const DICT = {
      en: {
        label: 'Usage pulse',
        peak: 'Peak',
        off: 'Off-peak',
        discount: '50% off',
        left: '{time} left',
        toPeak: 'until peak',
        toOff: 'until off-peak',
        nextOff: 'Next off-peak',
        startsAt: '{when}',
        startsIn: 'in {time}',
        segSince: 'This segment since {when}',
        offFrom: 'off-peak {clock}',
        dayToday: 'today',
        dayTomorrow: 'tomorrow',
        dayAfter: 'in 2 days',
        dayYesterday: 'yesterday',
        dayBefore: '2 days ago',
        tomorrow: 'tomorrow',
        today: 'Today',
        todayTokens: 'Tokens',
        session: 'Session',
        sessionTokens: 'Session tokens',
        requests: 'req',
        tokens: 'tokens',
        hit: 'Cache hit',
        miss: 'Cache miss',
        out: 'Output',
        hitShare: '{share} of input',
        hourly24: 'Last 24 hours',
        daily7: 'Last 7 days',
        priceTitle: 'Current unit price',
        priceUnit: 'CNY / 1M tokens',
        peakSpend: 'Peak',
        offSpend: 'Off-peak',
        windowHint: 'Peak: Mon-Fri 09:00-12:00 and 14:00-18:00 Beijing time',
        footnote: 'Local estimate, counted since install. Official list prices.',
        noSearch: 'Search / Fetch fees not included.',
        since: 'Since {date}',
        loading: 'Reading usage...',
        unavailable: 'Usage service unavailable',
        expand: 'Show usage details',
        collapse: 'Hide usage details',
      },
      zh: {
        label: '峰谷用量',
        peak: '峰时',
        off: '谷时',
        discount: '5 折',
        left: '剩 {time}',
        toPeak: '后转峰时',
        toOff: '后转谷时',
        nextOff: '下一谷段',
        startsAt: '{when} 开始',
        startsIn: '{time} 后',
        segSince: '本段自 {when} 起',
        offFrom: '谷段 {clock} 起',
        dayToday: '今天',
        dayTomorrow: '明天',
        dayAfter: '后天',
        dayYesterday: '昨天',
        dayBefore: '前天',
        tomorrow: '明天',
        today: '今日',
        todayTokens: '今日 tokens',
        session: '本会话',
        sessionTokens: '会话 tokens',
        requests: '次',
        tokens: 'tokens',
        hit: '缓存命中',
        miss: '缓存未命中',
        out: '输出',
        hitShare: '占输入 {share}',
        hourly24: '近 24 小时',
        daily7: '近 7 日',
        priceTitle: '当前单价',
        priceUnit: '元 / 百万 tokens',
        peakSpend: '峰时',
        offSpend: '谷时',
        windowHint: '峰时：工作日 09:00–12:00、14:00–18:00（北京时间）',
        footnote: '本地估算 · 自安装起统计 · 官方牌价',
        noSearch: '未含 Search / Fetch 调用费。',
        since: '自 {date} 起',
        loading: '读取用量…',
        unavailable: '用量服务暂不可用',
        expand: '展开用量详情',
        collapse: '收起用量详情',
      },
    };

    const CSS = `
.up-root{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.up-pill{display:inline-flex;align-items:center;gap:7px;align-self:flex-start;max-width:100%;padding:3px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer;user-select:none;transition:border-color .15s ease,background-color .15s ease}
.up-pill:hover{border-color:var(--dsw-alias-border-l2)}
.up-pill[data-open='true']{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.up-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.up-dot{width:6px;height:6px;flex:0 0 auto;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.up-dot[data-peak='true']{background:var(--dsw-alias-state-warn-primary)}
.up-dot[data-peak='false']{background:var(--dsw-alias-state-success-primary)}
.up-regime{color:var(--dsw-alias-label-primary);font-weight:600;white-space:nowrap}
.up-discount{padding:0 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-success-primary);font-size:11px;font-weight:600;white-space:nowrap}
.up-countdown{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.up-sep{width:1px;height:10px;background:var(--dsw-alias-border-l1);flex:0 0 auto}
.up-money{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}
.up-tokens{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.up-spark{display:inline-flex;align-items:flex-end;gap:2px;height:11px}
.up-spark i{width:2px;border-radius:1px;background:var(--dsw-alias-brand-primary);opacity:.55}
.up-spark i[data-peak='true']{background:var(--dsw-alias-state-warn-primary);opacity:.9}
.up-chevron{color:var(--dsw-alias-label-tertiary);font-size:9px;transform:rotate(0deg);transition:transform .15s ease}
.up-pill[data-open='true'] .up-chevron{transform:rotate(180deg)}
.up-hint{color:var(--dsw-alias-label-tertiary)}
.up-nextoff{display:flex;align-items:baseline;gap:6px;margin:0 0 8px;padding:5px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.up-nextoff-label{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:0 0 auto}
.up-nextoff-value{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.up-nextoff-in{margin-left:auto;padding-left:6px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.up-panel{width:min(360px,100%);padding:10px 12px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.12)}
.up-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px}
.up-head-title{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}
.up-badge{padding:1px 6px;border-radius:6px;font-size:11px;color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-layer-2)}
.up-badge[data-peak='true']{color:var(--dsw-alias-state-warn-primary)}
.up-discount-static{font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:500}
.up-head-sub{font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary);text-align:right;max-width:200px}
.up-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.up-stat{display:flex;flex-direction:column;gap:1px;min-width:0}
.up-stat-label{font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.up-stat-value{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}
.up-stat-sub{font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.up-split{display:flex;gap:6px;margin-top:6px;font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.up-break{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.up-break-item{display:flex;flex-direction:column;gap:1px;min-width:0}
.up-break-label{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.up-break-value{font-size:11px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.up-break-sub{font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.up-chart{margin-top:8px}
.up-chart-head{display:flex;justify-content:space-between;align-items:baseline;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.up-chart-total{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.up-bars{display:flex;align-items:flex-end;gap:2px;height:32px;margin-top:4px}
.up-bars i{flex:1 1 0;min-width:1px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary);opacity:.55}
.up-bars i[data-peak='true']{background:var(--dsw-alias-state-warn-primary);opacity:.85}
.up-bars i[data-empty='true']{background:var(--dsw-alias-border-l1);opacity:1}
.up-prices{margin-top:9px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.up-prices-head{display:flex;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-bottom:3px}
.up-price-table{width:100%;border-collapse:collapse;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.up-price-table th{font-weight:400;color:var(--dsw-alias-label-tertiary);text-align:right;padding:1px 0 1px 8px;white-space:nowrap}
.up-price-table td{text-align:right;padding:1px 0 1px 8px;white-space:nowrap}
.up-price-table th:first-child,.up-price-table td:first-child{text-align:left;padding-left:0}
.up-price-table td:first-child{color:var(--dsw-alias-label-primary)}
.up-foot{margin-top:8px;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
`;

    const h = React.createElement;

    /* ------------------------------------------------------------ format */

    function trimOne(value) {
      const rounded = Math.round(value * 10) / 10;
      return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
    }

    function fmtTokens(value) {
      const n = Number(value) || 0;
      if (n <= 0) return '0';
      if (n >= 1e9) return `${trimOne(n / 1e9)}B`;
      if (n >= 1e6) return `${trimOne(n / 1e6)}M`;
      if (n >= 1e3) return `${trimOne(n / 1e3)}K`;
      return String(Math.round(n));
    }

    function fmtMoney(value) {
      const n = Number(value) || 0;
      if (n <= 0) return '¥0';
      if (n < 0.001) return `¥${n.toFixed(5)}`;
      if (n < 0.01) return `¥${n.toFixed(4)}`;
      if (n < 1) return `¥${n.toFixed(3)}`;
      return `¥${n.toFixed(2)}`;
    }

    function fmtRate(value) {
      const n = Number(value) || 0;
      if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
      return String(Math.round(n * 1000) / 1000);
    }

    function fmtDuration(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      if (minutes > 0) return `${minutes}m ${seconds}s`;
      return `${seconds}s`;
    }

    function shortDate(day) {
      const text = String(day || '');
      return text.length >= 10 ? `${text.slice(5, 7)}-${text.slice(8, 10)}` : text;
    }

    function shortModel(model) {
      const text = String(model || '');
      return text ? text.replace(/^deepseek-/, '') : '';
    }

    /* -------------------------------------------------------- clock/regime */

    const HOUR = 3600000;
    const DAY = 86400000;
    const BJ = 8 * HOUR;

    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    function bjMidnight(ms) {
      const date = new Date(ms + BJ);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - BJ;
    }

    function approxIsPeak(ms) {
      const date = new Date(ms + BJ);
      const weekday = date.getUTCDay();
      const hour = date.getUTCHours();
      return weekday !== 0 && weekday !== 6 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
    }

    function firstAt(now, wantPeak) {
      const base = bjMidnight(now);
      for (let offset = 0; offset <= 10; offset += 1) {
        for (const hour of [0, 9, 12, 14, 18]) {
          const at = base + offset * DAY + hour * HOUR;
          if (at <= now) continue;
          if (approxIsPeak(at) === wantPeak) return at;
        }
      }
      return now + HOUR;
    }

    /** Weekday-only approximation; the host answer (holiday aware) wins when present. */
    function approxNextOff(now) {
      if (approxIsPeak(now)) return firstAt(now, false);
      return firstAt(firstAt(now, true), false);
    }

    function bjClock(ms) {
      const date = new Date(ms + BJ);
      return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
    }

    function bjDayOffset(at, now) {
      return Math.round((bjMidnight(at) - bjMidnight(now)) / DAY);
    }

    function whenText(clock, dayOffset, date, t) {
      const day =
        dayOffset === 0 ? t('dayToday')
          : dayOffset === 1 ? t('dayTomorrow')
            : dayOffset === 2 ? t('dayAfter')
              : dayOffset === -1 ? t('dayYesterday')
                : dayOffset === -2 ? t('dayBefore')
                  : date ? shortDate(date) : '';
      return day ? `${day} ${clock}` : String(clock);
    }

    function normalizeNextOff(regime, now) {
      const given = regime && regime.nextOff;
      if (given && Number.isFinite(Number(given.at))) {
        return {
          at: Number(given.at),
          clock: given.clock || bjClock(Number(given.at)),
          dayOffset: Number.isFinite(Number(given.dayOffset)) ? Number(given.dayOffset) : 0,
          date: given.date || '',
        };
      }
      const at = approxNextOff(now);
      return { at, clock: bjClock(at), dayOffset: bjDayOffset(at, now), date: '' };
    }

    function makeTranslate(getTranslate) {
      const language = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';
      const fallback = /^zh/i.test(language) ? DICT.zh : DICT.en;
      return (key, params) => {
        let value;
        const translate = getTranslate();
        if (translate) {
          try {
            const translated = translate(key);
            if (typeof translated === 'string' && translated !== '' && translated !== key) value = translated;
          } catch (error) {
            /* locale service hiccup: fall through to the built-in dictionary */
          }
        }
        if (value === undefined) value = fallback[key] !== undefined ? fallback[key] : key;
        if (!params) return value;
        return String(value).replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
      };
    }

    /* --------------------------------------------------------------- data */

    function useSnapshot(sessionId) {
      const [snapshot, setSnapshot] = useState(null);
      const [error, setError] = useState(null);
      const offsetRef = useRef(0);

      useEffect(() => {
        let stopped = false;
        let busy = false;

        const load = async () => {
          if (busy) return;
          busy = true;
          try {
            const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
            const response = await fetch(API + query, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (!payload || payload.ok !== true) throw new Error('bad payload');
            if (stopped) return;
            offsetRef.current = (Number(payload.now) || Date.now()) - Date.now();
            setSnapshot(payload);
            setError(null);
          } catch (failure) {
            if (!stopped) setError(failure && failure.message ? failure.message : String(failure));
          } finally {
            busy = false;
          }
        };

        void load();
        const timer = window.setInterval(() => {
          if (document.visibilityState !== 'hidden') void load();
        }, POLL_MS);
        const onVisible = () => {
          if (document.visibilityState !== 'hidden') void load();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
          stopped = true;
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [sessionId]);

      return { snapshot, error, offsetRef };
    }

    /* ---------------------------------------------------------- fragments */

    function Stat(label, value, sub) {
      return h(
        'div',
        { className: 'up-stat', key: label },
        h('span', { className: 'up-stat-label' }, label),
        h('span', { className: 'up-stat-value' }, value),
        sub ? h('span', { className: 'up-stat-sub' }, sub) : null,
      );
    }

    function Bars(series, max, height, labelOf) {
      return h(
        'div',
        { className: 'up-bars', style: { height: `${height}px` } },
        series.map((point, index) => {
          const tokens = Number(point.tokens) || 0;
          const ratio = max > 0 ? tokens / max : 0;
          const barHeight = tokens > 0 ? Math.max(2, Math.round(ratio * height)) : 2;
          return h('i', {
            key: `${point.t}:${index}`,
            'data-peak': point.peak ? 'true' : 'false',
            'data-empty': tokens > 0 ? 'false' : 'true',
            style: { height: `${barHeight}px` },
            title: `${labelOf(point)} · ${fmtTokens(tokens)} tokens · ${fmtMoney(point.cny)}`,
          });
        }),
      );
    }

    function Breakdown(today, t) {
      const input = (Number(today.in) || 0) + (Number(today.hit) || 0);
      const share = input > 0 ? ((Number(today.hit) || 0) / input) * 100 : 0;
      const rows = [
        { label: t('hit'), value: fmtTokens(today.hit), sub: t('hitShare', { share: `${share.toFixed(0)}%` }) },
        { label: t('miss'), value: fmtTokens(today.in), sub: t('hitShare', { share: `${(100 - share).toFixed(0)}%` }) },
        { label: t('out'), value: fmtTokens(today.out), sub: '' },
      ];
      return h(
        'div',
        { className: 'up-break' },
        rows.map((row) =>
          h(
            'div',
            { className: 'up-break-item', key: row.label },
            h('span', { className: 'up-break-label' }, row.label),
            h('span', { className: 'up-break-value' }, row.value),
            row.sub ? h('span', { className: 'up-break-sub' }, row.sub) : null,
          ),
        ),
      );
    }

    function PriceTable(prices, t) {
      if (!prices || !Array.isArray(prices.models)) return null;
      return h(
        'div',
        { className: 'up-prices' },
        h(
          'div',
          { className: 'up-prices-head' },
          h('span', null, t('priceTitle')),
          h('span', null, t('priceUnit')),
        ),
        h(
          'table',
          { className: 'up-price-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, ''),
              h('th', null, t('hit')),
              h('th', null, t('miss')),
              h('th', null, t('out')),
            ),
          ),
          h(
            'tbody',
            null,
            prices.models.map((model) =>
              h(
                'tr',
                { key: model.id },
                h('td', null, model.label),
                h('td', null, fmtRate(model.hit)),
                h('td', null, fmtRate(model.miss)),
                h('td', null, fmtRate(model.out)),
              ),
            ),
          ),
        ),
      );
    }

    function DetailPanel(snapshot, t, now) {
      const regime = snapshot.regime;
      const today = snapshot.today || {};
      const session = snapshot.session || {};
      const hours = Array.isArray(snapshot.hours) ? snapshot.hours : [];
      const days = Array.isArray(snapshot.days) ? snapshot.days : [];
      const maxHour = hours.reduce((max, point) => Math.max(max, Number(point.tokens) || 0), 0);
      const maxDay = days.reduce((max, point) => Math.max(max, Number(point.tokens) || 0), 0);
      const hoursTotal = hours.reduce((sum, point) => sum + (Number(point.cny) || 0), 0);
      const daysTotal = days.reduce((sum, point) => sum + (Number(point.cny) || 0), 0);

      let nextPrefix = '';
      if (regime.nextDayOffset === 1) nextPrefix = `${t('tomorrow')} `;
      else if (regime.nextDayOffset > 1) nextPrefix = `${shortDate(regime.nextDate)} `;
      const nextText = `${nextPrefix}${regime.nextClock} ${regime.nextPeak ? t('toPeak') : t('toOff')}`;
      const regimeText = regime.peak ? t('peak') : t('off');
      const nextOff = normalizeNextOff(regime, now);
      const nextOffText = whenText(nextOff.clock, nextOff.dayOffset, nextOff.date, t);
      const segment = regime.segment || null;
      const segmentText = segment ? whenText(segment.clock, segment.dayOffset, segment.date, t) : '';

      return h(
        'section',
        { className: 'up-panel', role: 'region', 'aria-label': t('label') },
        h(
          'header',
          { className: 'up-head' },
          h(
            'div',
            { className: 'up-head-title' },
            h('span', { className: 'up-badge', 'data-peak': regime.peak ? 'true' : 'false' }, regimeText),
            !regime.peak ? h('span', { className: 'up-discount-static' }, t('discount')) : null,
          ),
          h(
            'div',
            { className: 'up-head-sub' },
            h('div', null, nextText),
            h('div', null, t('left', { time: fmtDuration(regime.until - now) })),
            segmentText ? h('div', null, t('segSince', { when: segmentText })) : null,
          ),
        ),
        h(
          'div',
          { className: 'up-nextoff' },
          h('span', { className: 'up-nextoff-label' }, t('nextOff')),
          h('span', { className: 'up-nextoff-value' }, t('startsAt', { when: nextOffText })),
          h('span', { className: 'up-nextoff-in' }, t('startsIn', { time: fmtDuration(nextOff.at - now) })),
        ),
        h(
          'div',
          { className: 'up-grid' },
          Stat(t('today'), fmtMoney(today.cny), `${today.req || 0} ${t('requests')}`),
          Stat(t('todayTokens'), fmtTokens(today.tokens), t('tokens')),
          Stat(t('session'), fmtMoney(session.cny), `${session.req || 0} ${t('requests')}`),
          Stat(t('sessionTokens'), fmtTokens(session.tokens), session.model ? shortModel(session.model) : t('tokens')),
        ),
        h(
          'div',
          { className: 'up-split' },
          h('span', null, `${t('peakSpend')} ${fmtMoney(today.peakCny)}`),
          h('span', { className: 'up-hint' }, '·'),
          h('span', null, `${t('offSpend')} ${fmtMoney(today.offCny)}`),
        ),
        Breakdown(today, t),
        h(
          'div',
          { className: 'up-chart' },
          h(
            'div',
            { className: 'up-chart-head' },
            h('span', null, t('hourly24')),
            h('span', { className: 'up-chart-total' }, fmtMoney(hoursTotal)),
          ),
          Bars(hours, maxHour, 32, (point) => `${String(point.hour).padStart(2, '0')}:00`),
        ),
        h(
          'div',
          { className: 'up-chart' },
          h(
            'div',
            { className: 'up-chart-head' },
            h('span', null, t('daily7')),
            h('span', { className: 'up-chart-total' }, fmtMoney(daysTotal)),
          ),
          Bars(days, maxDay, 24, (point) => shortDate(point.day)),
        ),
        PriceTable(snapshot.prices, t),
        h(
          'div',
          { className: 'up-foot' },
          h('div', null, `${t('footnote')} · ${t('since', { date: shortDate(snapshot.installedDay) })}`),
          h('div', null, t('noSearch')),
        ),
      );
    }

    /* ------------------------------------------------------------- widget */

    function UsagePulse(props) {
      const t = props.t;
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : '';
      const { snapshot, error, offsetRef } = useSnapshot(sessionId);
      const [open, setOpen] = useState(false);
      const [, setTick] = useState(0);

      useEffect(() => {
        const timer = window.setInterval(() => setTick((value) => (value + 1) % 1000000), 1000);
        return () => window.clearInterval(timer);
      }, []);

      useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [open]);

      const now = Date.now() + offsetRef.current;
      const regime = snapshot ? snapshot.regime : null;
      const today = snapshot && snapshot.today ? snapshot.today : null;
      const remaining = regime ? regime.until - now : 0;
      const nextOff = regime ? normalizeNextOff(regime, now) : null;

      let regimeText = t('label');
      if (regime) regimeText = regime.peak ? t('peak') : t('off');

      const pillChildren = [];
      pillChildren.push(
        h('span', {
          className: 'up-dot',
          key: 'dot',
          'data-peak': regime ? (regime.peak ? 'true' : 'false') : undefined,
        }),
      );
      pillChildren.push(h('span', { className: 'up-regime', key: 'regime' }, regimeText));
      if (regime && !regime.peak) pillChildren.push(h('span', { className: 'up-discount', key: 'discount' }, t('discount')));
      if (regime) {
        pillChildren.push(h('span', { className: 'up-countdown', key: 'countdown' }, t('left', { time: fmtDuration(remaining) })));
        if (regime.peak && nextOff) {
          pillChildren.push(
            h(
              'span',
              {
                className: 'up-hint',
                key: 'nextoff',
                title: `${t('nextOff')} ${whenText(nextOff.clock, nextOff.dayOffset, nextOff.date, t)}`,
              },
              t('offFrom', { clock: nextOff.clock }),
            ),
          );
        }
        pillChildren.push(h('span', { className: 'up-sep', key: 'sep' }));
        pillChildren.push(h('span', { className: 'up-money', key: 'money' }, fmtMoney(today ? today.cny : 0)));
        pillChildren.push(h('span', { className: 'up-tokens', key: 'tokens' }, fmtTokens(today ? today.tokens : 0)));
        const spark = (snapshot.hours || []).slice(-12);
        const max = spark.reduce((value, point) => Math.max(value, Number(point.tokens) || 0), 0);
        pillChildren.push(
          h(
            'span',
            { className: 'up-spark', key: 'spark' },
            spark.map((point, index) => {
              const tokens = Number(point.tokens) || 0;
              const height = tokens > 0 && max > 0 ? Math.max(2, Math.round((tokens / max) * 11)) : 2;
              return h('i', {
                key: `${point.t}:${index}`,
                'data-peak': point.peak ? 'true' : 'false',
                style: { height: `${height}px` },
              });
            }),
          ),
        );
      } else {
        pillChildren.push(
          h('span', { className: 'up-countdown', key: 'status' }, error ? t('unavailable') : t('loading')),
        );
      }
      pillChildren.push(h('span', { className: 'up-chevron', key: 'chevron' }, '▾'));

      return h(
        'div',
        { className: 'up-root' },
        h(
          'button',
          {
            type: 'button',
            className: 'up-pill',
            'data-open': open ? 'true' : 'false',
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': open ? t('collapse') : t('expand'),
            title: t('label'),
            onClick: () => setOpen((value) => !value),
          },
          pillChildren,
        ),
        open && snapshot ? DetailPanel(snapshot, t, now) : null,
        open && !snapshot
          ? h(
              'section',
              { className: 'up-panel' },
              h('div', { className: 'up-hint' }, error ? t('unavailable') : t('loading')),
            )
          : null,
      );
    }

    /* ------------------------------------------------------------- plugin */

    const plugin = {
      inject: ['slots', 'locale'],
      apply(ctx) {
        let translate = null;
        const disposers = [];

        ctx.effect(() => {
          const locale = ctx.locale;
          if (locale && typeof locale.register === 'function') {
            const dictionaries = [
              ['en', DICT.en],
              ['en-US', DICT.en],
              ['zh', DICT.zh],
              ['zh-CN', DICT.zh],
            ];
            for (const [tag, dictionary] of dictionaries) {
              try {
                const dispose = locale.register(NS, tag, dictionary);
                if (typeof dispose === 'function') disposers.push(dispose);
              } catch (error) {
                /* an unknown locale tag must never disable the widget */
              }
            }
            try {
              translate = locale.bind(NS);
            } catch (error) {
              translate = null;
            }
          }
          return () => {
            for (const dispose of disposers.splice(0)) {
              try {
                dispose();
              } catch (error) {
                /* already disposed */
              }
            }
            translate = null;
          };
        });

        ctx.effect(() => {
          const style = document.createElement('style');
          style.setAttribute('data-usage-pulse', '');
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => {
            if (style.parentNode) style.parentNode.removeChild(style);
          };
        });

        const t = makeTranslate(() => translate);
        const Widget = (props) => h(UsagePulse, { ...props, t });

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'usage-pulse',
              order: 2,
              label: () => t('label'),
            },
            Widget,
          ),
        );
      },
    };

    return plugin;
  },
});
