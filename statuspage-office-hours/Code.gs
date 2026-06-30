const CONFIG = {
  ddSite: 'datadoghq.com',
  pageId: PropertiesService.getScriptProperties().getProperty('DD_PAGE_ID'),
  componentId: PropertiesService.getScriptProperties().getProperty('DD_COMPONENT_ID'),
  tz: 'Asia/Tokyo',
  tzOffset: '+09:00',
  bizStartHour: 9,
  bizEndHour: 18,
  holidayCalendarId: 'ja.japanese#holiday@group.v.calendar.google.com',
  workCalendarId: 'primary',
  service: 'statuspage-office-hours',
  ddTags: 'env:kyo',
};

const STATE_DEFS = {
  WEEKEND:     { component: 'major_outage', title: 'Weekend',
                 description: "It's the weekend. Kyouhei is recharging, back on the next business day." },
  HOLIDAY:     { component: 'major_outage', title: 'Public holiday (Japan)',
                 description: 'Today is a public holiday in Japan. Back on the next business day.' },
  AFTER_HOURS: { component: 'partial_outage', title: 'Outside office hours',
                 description: 'Kyouhei is offline for now. Messages will be picked up the next business morning.' },
  OOO_FULL:    { component: 'major_outage', title: 'Out of office',
                 description: 'Kyouhei is out of office today. Responses will be delayed until the next business day.' },
  OOO_PTO:     { component: 'major_outage', title: 'On PTO',
                 description: 'Kyouhei is on PTO today. Responses will be delayed until the next business day.' },
  OOO_PARTIAL: { component: 'partial_outage', title: 'Stepped out',
                 description: 'Kyouhei has stepped out for a bit. Back shortly.' },
};

function updateStatusPage() {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  console.log('[updateStatusPage] now=' + Utilities.formatDate(now, CONFIG.tz, 'yyyy-MM-dd HH:mm:ss') + ' JST');

  try {
    const desired = computeDesiredState(now);

    let activeId = props.getProperty('ACTIVE_DEG_ID');
    let activeState = props.getProperty('ACTIVE_STATE');
    console.log('  current: activeId=' + (activeId || 'none') + ' activeState=' + (activeState || 'none'));

    if (activeId) {
      const deg = getDegradation(activeId);
      if (!deg || deg.attributes.status === 'resolved') {
        console.log('  active degradation is gone/resolved -> clearing state');
        activeId = null; activeState = null;
        props.deleteProperty('ACTIVE_DEG_ID');
        props.deleteProperty('ACTIVE_STATE');
      } else {
        console.log('  active degradation alive (status=' + deg.attributes.status + ')');
      }
    }

    const previousState = activeState || 'OPERATIONAL';
    let action;
    let degId = activeId;

    if (desired === 'OPERATIONAL') {
      if (activeId) {
        resolveDegradation(activeId);
        props.deleteProperty('ACTIVE_DEG_ID');
        props.deleteProperty('ACTIVE_STATE');
        degId = null;
        action = 'resolved';
        console.log('  ACTION: resolved (' + activeState + ') -> operational (banner cleared)');
      } else {
        action = 'noop_operational';
        console.log('  ACTION: none (already operational, no banner)');
      }
    } else if (!activeId) {
      degId = createDegradation(desired);
      props.setProperty('ACTIVE_DEG_ID', degId);
      props.setProperty('ACTIVE_STATE', desired);
      action = 'created';
      console.log('  ACTION: created degradation id=' + degId + ' for ' + desired + ' (' + STATE_DEFS[desired].component + ')');
    } else if (activeState === desired) {
      action = 'unchanged';
      console.log('  ACTION: none (unchanged: ' + desired + ', banner continues)');
    } else {
      resolveDegradation(activeId);
      degId = createDegradation(desired);
      props.setProperty('ACTIVE_DEG_ID', degId);
      props.setProperty('ACTIVE_STATE', desired);
      action = 'switched';
      console.log('  ACTION: switched ' + activeState + ' -> ' + desired + ' (new id=' + degId + ')');
    }

    ddLog('statuspage ' + action + ': ' + previousState + ' -> ' + desired, 'info', {
      evt: 'status_evaluated',
      desired_state: desired,
      previous_state: previousState,
      action: action,
      component_status: desired === 'OPERATIONAL' ? 'operational' : STATE_DEFS[desired].component,
      degradation_id: degId || null,
      changed: (action === 'created' || action === 'switched' || action === 'resolved'),
    });
  } catch (e) {
    ddLog('statuspage error: ' + e, 'error', { evt: 'status_error', error: String(e) });
    throw e;
  }
}

function ddLog(message, level, attrs) {
  console.log('[' + (level || 'info') + '] ' + message);
  const apiKey = PropertiesService.getScriptProperties().getProperty('DD_API_KEY');
  if (!apiKey) return;
  const now = new Date();
  const entry = Object.assign({
    timestamp: now.toISOString(),
    message: message,
    service: CONFIG.service,
    ddsource: 'appscript',
    ddtags: CONFIG.ddTags,
    status: level || 'info',
    log_hour: parseInt(Utilities.formatDate(now, CONFIG.tz, 'H'), 10),
    log_weekday: Utilities.formatDate(now, CONFIG.tz, 'EEE').toLowerCase(),
  }, attrs || {});
  const options = {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'DD-API-KEY': apiKey },
    payload: JSON.stringify([entry]),
  };
  try {
    UrlFetchApp.fetch('https://http-intake.logs.' + CONFIG.ddSite + '/api/v2/logs', options);
  } catch (e) {
    console.log('ddLog failed: ' + e);
  }
}

function computeDesiredState(now) {
  const dow = parseInt(Utilities.formatDate(now, CONFIG.tz, 'u'), 10);
  const dowName = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow];

  if (dow === 6 || dow === 7) {
    console.log('  eval: dow=' + dow + '(' + dowName + ') -> WEEKEND');
    return 'WEEKEND';
  }

  const holiday = isHoliday(now);
  if (holiday) {
    console.log('  eval: dow=' + dow + '(' + dowName + ') holiday=true -> HOLIDAY');
    return 'HOLIDAY';
  }

  const bizStart = atHour(now, CONFIG.bizStartHour);
  const bizEnd = atHour(now, CONFIG.bizEndHour);
  const inHours = now >= bizStart && now < bizEnd;
  console.log('  eval: dow=' + dow + '(' + dowName + ') holiday=false bizHours='
    + CONFIG.bizStartHour + ':00-' + CONFIG.bizEndHour + ':00 inHours=' + inHours);

  if (!inHours) {
    console.log('  eval: outside business hours -> AFTER_HOURS');
    return 'AFTER_HOURS';
  }

  const ooo = getOooEvents(bizStart, bizEnd);
  const summaries = ooo.map(function (e) {
    return e.summary + '[' + Utilities.formatDate(e.start, CONFIG.tz, 'HH:mm')
      + '-' + Utilities.formatDate(e.end, CONFIG.tz, 'HH:mm') + ']';
  });
  const full = coversFully(ooo, bizStart, bizEnd);
  const partial = isWithinAny(ooo, now);
  const pto = hasPto(ooo);
  console.log('  eval: oooEvents=' + ooo.length + (ooo.length ? ' ' + summaries.join(', ') : '')
    + ' coversFully=' + full + ' withinNow=' + partial + ' hasPto=' + pto);

  if (full) {
    const s = pto ? 'OOO_PTO' : 'OOO_FULL';
    console.log('  eval: full-day OOO -> ' + s);
    return s;
  }
  if (partial) {
    console.log('  eval: currently inside an OOO block -> OOO_PARTIAL');
    return 'OOO_PARTIAL';
  }
  console.log('  eval: working hours, no active OOO -> OPERATIONAL');
  return 'OPERATIONAL';
}

function atHour(now, hour) {
  const ymd = Utilities.formatDate(now, CONFIG.tz, 'yyyy-MM-dd');
  const hh = ('0' + hour).slice(-2);
  return new Date(ymd + 'T' + hh + ':00:00' + CONFIG.tzOffset);
}

function isHoliday(now) {
  const start = atHour(now, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const res = Calendar.Events.list(CONFIG.holidayCalendarId, {
    timeMin: start.toISOString(), timeMax: end.toISOString(),
    singleEvents: true, maxResults: 5,
  });
  return !!(res.items && res.items.length > 0);
}

function getOooEvents(bizStart, bizEnd) {
  const res = Calendar.Events.list(CONFIG.workCalendarId, {
    timeMin: bizStart.toISOString(), timeMax: bizEnd.toISOString(),
    singleEvents: true, orderBy: 'startTime', eventTypes: ['outOfOffice'],
  });
  const items = res.items || [];
  return items.map(function (ev) {
    const s = ev.start.dateTime ? new Date(ev.start.dateTime)
      : new Date(ev.start.date + 'T00:00:00' + CONFIG.tzOffset);
    const e = ev.end.dateTime ? new Date(ev.end.dateTime)
      : new Date(ev.end.date + 'T00:00:00' + CONFIG.tzOffset);
    return { start: s, end: e, summary: ev.summary || '' };
  });
}

function hasPto(events) {
  return events.some(function (e) { return /pto/i.test(e.summary); });
}

function coversFully(intervals, bizStart, bizEnd) {
  const clamped = intervals
    .map(function (i) {
      return { start: Math.max(i.start.getTime(), bizStart.getTime()),
               end: Math.min(i.end.getTime(), bizEnd.getTime()) };
    })
    .filter(function (i) { return i.end > i.start; })
    .sort(function (a, b) { return a.start - b.start; });
  if (!clamped.length) return false;
  let cursor = bizStart.getTime();
  for (let i = 0; i < clamped.length; i++) {
    if (clamped[i].start > cursor) return false;
    cursor = Math.max(cursor, clamped[i].end);
  }
  return cursor >= bizEnd.getTime();
}

function isWithinAny(intervals, now) {
  const t = now.getTime();
  return intervals.some(function (i) {
    return t >= i.start.getTime() && t < i.end.getTime();
  });
}

function ddFetch(method, path, payload) {
  const props = PropertiesService.getScriptProperties();
  const options = {
    method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'DD-API-KEY': props.getProperty('DD_API_KEY'),
               'DD-APPLICATION-KEY': props.getProperty('DD_APP_KEY') },
  };
  if (payload) options.payload = JSON.stringify(payload);
  return UrlFetchApp.fetch('https://api.' + CONFIG.ddSite + path, options);
}

function getDegradation(id) {
  const res = ddFetch('get', '/api/v2/statuspages/' + CONFIG.pageId + '/degradations/' + id);
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() >= 300) throw new Error('GET failed ' + res.getResponseCode() + ': ' + res.getContentText());
  return JSON.parse(res.getContentText()).data;
}

function createDegradation(stateKey) {
  const def = STATE_DEFS[stateKey];
  const payload = { data: { type: 'degradations', attributes: {
    title: def.title, status: 'monitoring', description: def.description,
    components_affected: [{ id: CONFIG.componentId, status: def.component }] } } };
  const res = ddFetch('post', '/api/v2/statuspages/' + CONFIG.pageId + '/degradations', payload);
  if (res.getResponseCode() >= 300) throw new Error('Create failed ' + res.getResponseCode() + ': ' + res.getContentText());
  return JSON.parse(res.getContentText()).data.id;
}

function resolveDegradation(id) {
  const payload = { data: { type: 'degradations', id: id, attributes: {
    status: 'resolved',
    components_affected: [{ id: CONFIG.componentId, status: 'operational' }] } } };
  const res = ddFetch('patch', '/api/v2/statuspages/' + CONFIG.pageId + '/degradations/' + id, payload);
  if (res.getResponseCode() >= 300) throw new Error('Resolve failed ' + res.getResponseCode() + ': ' + res.getContentText());
}

// Run once to install the 30-minute trigger.
function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'updateStatusPage') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('updateStatusPage').timeBased().everyMinutes(30).create();
}
