// 창원북면고 업무도우미 휴대폰 화면. 빌드 없이 그대로 올리는 한 장짜리 앱이다.
// 자료는 학교 허브(Apps Script)에서 받아 화면에만 보여 주고, 이 기기에는 로그인 정보(이름·토큰)만 저장한다.
(function () {
  'use strict'

  const HUB_URL = window.CBG_HUB_URL
  const SESSION_KEY = 'cbg.mobile.session.v1'
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const RANGE_DAYS = 14

  const $ = id => document.getElementById(id)
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  let session = readSession()
  let bundle = null
  let range = null
  let tab = 'schedule'
  let selected = todayIso()

  function todayIso() {
    // 한국 날짜 기준
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  }
  function addDays(iso, days) {
    const date = new Date(iso + 'T00:00:00Z')
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  }
  function dayLabel(iso) {
    const date = new Date(iso + 'T00:00:00Z')
    return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 (${DAYS[date.getUTCDay()]})`
  }

  function readSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
      return saved && saved.token && Date.parse(saved.expiresAt) > Date.now() ? saved : null
    } catch { return null }
  }
  function saveSession(value) {
    session = value
    try { value ? localStorage.setItem(SESSION_KEY, JSON.stringify(value)) : localStorage.removeItem(SESSION_KEY) } catch { /* 저장 못 해도 이번 화면에서는 쓴다 */ }
  }

  async function hub(action, body) {
    if (!HUB_URL) throw new Error('학교 허브 주소가 설정되지 않았습니다.')
    const response = await fetch(HUB_URL, {
      method: 'POST',
      // text/plain이어야 브라우저가 사전 확인(CORS preflight) 없이 Apps Script에 보낸다.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, body)),
    })
    const result = await response.json()
    if (!result.ok) {
      const error = new Error(result.error || '요청에 실패했습니다.')
      error.code = result.code
      throw error
    }
    return result.data
  }

  function show() {
    const loggedIn = Boolean(session)
    $('login').hidden = loggedIn
    $('app').hidden = !loggedIn
    $('tabs').hidden = !loggedIn
    $('logout').hidden = !loggedIn
    $('who').textContent = loggedIn ? `${session.name} 선생님` : ''
    if (loggedIn) load(false)
  }

  async function load(force) {
    $('date').value = selected
    const inRange = range && selected >= range.from && selected <= range.to
    if (bundle && inRange && !force) return render()
    const from = selected
    const to = addDays(selected, RANGE_DAYS - 1)
    $('status').textContent = '불러오는 중...'
    try {
      bundle = await hub('getMobileScheduleBundle', { viewerName: session.name, accessToken: session.token, fromDate: from, toDate: to })
      range = { from, to }
      const failed = Object.entries(bundle.sourceStatus || {}).filter(([, value]) => value.state === 'unavailable').map(([key]) => key)
      $('status').textContent = failed.length ? `일부 자료를 불러오지 못했습니다 (${failed.join(', ')}).` : `${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`
      render()
    } catch (error) {
      if (error.code === 'MOBILE_SESSION_EXPIRED') {
        saveSession(null)
        show()
        $('login-error').textContent = '로그인이 만료되었습니다. 다시 로그인해 주세요.'
        return
      }
      $('status').textContent = `불러오지 못했습니다: ${error.message}`
    }
  }

  function render() {
    if (!bundle) return
    const html = { schedule: renderSchedule, timetable: renderTimetable, meals: renderMeals, tasks: renderTasks }[tab]()
    $('panel').innerHTML = html
  }

  function renderSchedule() {
    const items = (bundle.events || []).map(event => ({ date: event.date, label: event.label || '일정', title: event.title, meta: event.time || '' }))
      .concat((bundle.committeeEvents || []).map(event => ({
        date: event.date, label: '위원회', title: `${event.committeeName} ${event.title}`.trim(),
        meta: [event.startTime && `${event.startTime}${event.endTime ? `~${event.endTime}` : ''}`, event.location].filter(Boolean).join(' · '),
      })))
      .filter(item => item.date >= selected)
      .sort((a, b) => a.date.localeCompare(b.date) || a.meta.localeCompare(b.meta))
    if (!items.length) return card(`<p class="empty">${dayLabel(selected)}부터 2주 동안 일정이 없습니다.</p>`)
    let html = ''
    let current = ''
    for (const item of items) {
      if (item.date !== current) { html += (current ? '</div>' : '') + `<p class="day-head">${dayLabel(item.date)}</p><div class="card">`; current = item.date }
      html += `<div class="item"><span class="tag">${esc(item.label)}</span>${esc(item.title)}${item.meta ? `<div class="meta">${esc(item.meta)}</div>` : ''}</div>`
    }
    return html + '</div>'
  }

  function renderTimetable() {
    const weekday = new Date(selected + 'T00:00:00Z').getUTCDay()
    const head = `<h2>${dayLabel(selected)} 내 시간표</h2>`
    if (weekday === 0 || weekday === 6) return card(head + '<p class="empty">주말입니다.</p>')
    const teacher = bundle.teacherTimetable
    if (!teacher) return card(head + '<p class="empty">공유 시간표에서 선생님 이름을 찾지 못했습니다.</p>')
    const dayIndex = weekday - 1
    let rows = ''
    for (let period = 1; period <= 7; period++) {
      const value = (teacher.slots[dayIndex * 7 + period - 1] || {}).value || ''
      rows += `<div class="period"><b>${period}교시</b><span>${value ? esc(value) : '<span class="muted">공강</span>'}</span></div>`
    }
    const changes = (bundle.timetableChanges || []).filter(item => item.originalDate === selected || item.replacementDate === selected)
      .map(item => `<div class="item"><span class="tag warn">${item.status === 'approved' ? '변경' : '요청 중'}</span>`
        + `${esc(item.originalDate.slice(5))} ${item.originalSlotIndex % 7 + 1}교시 ${esc(item.originalClass)} ${esc(item.originalSubject)}(${esc(item.originalTeacher)})`
        + ` → ${esc(item.replacementDate.slice(5))} ${item.replacementSlotIndex % 7 + 1}교시 ${esc(item.replacementClass)} ${esc(item.replacementSubject)}(${esc(item.replacementTeacher)})`
        + `${item.note ? `<div class="meta">${esc(item.note)}</div>` : ''}</div>`)
    const overrides = (bundle.timetableOverrides || []).filter(item => item.date === selected)
      .map(item => `<div class="item"><span class="tag warn">학교 예외</span>${esc([item.targetGrade && `${item.targetGrade}학년`, item.targetPeriod && `${item.targetPeriod}교시`].filter(Boolean).join(' '))} ${esc(item.reason || item.note || item.mode || '')}</div>`)
    const extra = changes.concat(overrides)
    return card(head + rows) + (extra.length ? card('<h2>이날 바뀐 수업</h2>' + extra.join('')) : '')
      + '<p class="muted small">시간표는 학교에 올라온 기본 시간표입니다. 바뀐 수업은 위 목록을 함께 확인하세요.</p>'
  }

  function renderMeals() {
    const meals = (bundle.meals || []).filter(meal => meal.date === selected)
    const head = `<h2>${dayLabel(selected)} 급식</h2>`
    if (!meals.length) return card(head + '<p class="empty">급식 정보가 없습니다.</p>')
    return meals.map(meal => card(`<h2>${esc(meal.mealType || '급식')} · ${dayLabel(selected)}</h2>`
      + meal.dishNames.map(dish => `<p class="dish">${esc(dish)}</p>`).join(''))).join('')
  }

  function renderTasks() {
    const tasks = bundle.staffTasks || []
    const notices = bundle.notices || []
    const taskHtml = tasks.length
      ? tasks.map(task => `<div class="item${task.done ? ' done' : ''}">${task.done ? '<span class="tag">확인함</span>' : (task.deadline && task.deadline < todayIso() ? '<span class="tag warn">기한 지남</span>' : '')}`
        + `<b>${esc(task.title)}</b><div class="meta">${task.deadline ? `마감 ${esc(task.deadline)}` : '마감 없음'}${task.creatorName ? ` · ${esc(task.creatorName)}` : ''}</div>`
        + `${task.description ? `<div class="body-text">${esc(task.description)}</div>` : ''}</div>`).join('')
      : '<p class="empty">나에게 배부된 진행 중 업무가 없습니다.</p>'
    const noticeHtml = notices.length
      ? notices.map(notice => `<div class="item">${notice.level !== 'info' ? `<span class="tag warn">${notice.level === 'urgent' ? '긴급' : '중요'}</span>` : ''}<b>${esc(notice.title)}</b>`
        + `<div class="meta">${esc(notice.date)}</div>${notice.body ? `<div class="body-text">${esc(notice.body)}</div>` : ''}</div>`).join('')
      : '<p class="empty">게시 중인 공지가 없습니다.</p>'
    return card('<h2>나에게 배부된 업무</h2>' + taskHtml) + card('<h2>학교 공지</h2>' + noticeHtml)
      + '<p class="muted small">업무 확인·완료 표시는 PC 업무도우미에서 합니다.</p>'
  }

  function card(inner) { return `<div class="card">${inner}</div>` }

  $('login').addEventListener('submit', async event => {
    event.preventDefault()
    const button = event.submitter || $('login').querySelector('button')
    const name = $('name').value.trim()
    button.disabled = true
    $('login-error').textContent = ''
    try {
      const data = await hub('verifyMobileViewer', { viewerName: name, password: $('password').value })
      saveSession({ name, token: data.accessToken, expiresAt: data.expiresAt })
      $('password').value = ''
      bundle = null
      show()
    } catch (error) {
      $('login-error').textContent = error.message
    } finally {
      button.disabled = false
    }
  })
  $('logout').addEventListener('click', () => { saveSession(null); bundle = null; show() })
  $('date').addEventListener('change', event => { if (event.target.value) { selected = event.target.value; load(false) } })
  $('today').addEventListener('click', () => { selected = todayIso(); load(false) })
  $('refresh').addEventListener('click', () => load(true))
  document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => {
    selected = addDays(selected, Number(button.dataset.move))
    load(false)
  }))
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    tab = button.dataset.tab
    document.querySelectorAll('[data-tab]').forEach(other => other.classList.toggle('on', other === button))
    render()
  }))

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
  show()
})()
