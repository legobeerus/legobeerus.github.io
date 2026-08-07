(function(){
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const statusMsg = document.getElementById('statusMsg')
  const eventsSummary = document.getElementById('eventsSummary')
  const eventsList = document.getElementById('eventsList')
  const searchInput = document.getElementById('eventsSearch')
  const searchSummary = document.getElementById('eventsSearchSummary')

  let allEvents = []
  let openAttendeesMenu = null
  let openAttendModal = null

  function ensureAuth(){
    return fetch(`${AUTH_SERVER}/api/me`, { credentials: 'include' })
      .then(resp => {
        if(resp.status === 204 || resp.status === 401){
          window.location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname + location.search)}`
          return null
        }
        if(resp.status === 403){
          statusMsg.textContent = 'Access denied: your Discord account is missing the required role.'
          return null
        }
        return resp.json()
      })
      .catch(err => {
        console.error(err)
        statusMsg.textContent = 'Auth check failed'
        return null
      })
  }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function normalizeText(value){
    return String(value || '').toLowerCase().trim()
  }

  function weekdayLabel(index){
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const i = Number(index)
    if(!Number.isInteger(i) || i < 0 || i > 6) return 'N/A'
    return days[i]
  }

  function shortTime(value){
    if(!value) return 'N/A'
    const date = new Date(value)
    if(Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  function truncate(value, maxLength){
    const text = String(value || '').trim()
    if(text.length <= maxLength) return text
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
  }

  function attendeeSummary(event){
    const attendance = event && event.attendance && typeof event.attendance === 'object' ? event.attendance : {}
    const count = Number(attendance.count || 0)
    const preview = Array.isArray(attendance.preview) ? attendance.preview : []
    const meAttending = Boolean(attendance.meAttending)
    const weeklySubscription = Boolean(attendance.weeklySubscription)
    return { count, preview, meAttending, weeklySubscription }
  }

  function attendeeStackHtml(event){
    const summary = attendeeSummary(event)
    const preview = summary.preview.slice(0, 3)
    const remaining = Math.max(summary.count - preview.length, 0)
    const avatars = preview.map((person, idx) => {
      const left = idx * 18
      const name = escapeHtml(person.tag || person.username || person.userId || 'Attendee')
      const src = escapeHtml(person.avatarUrl || '')
      if(src){
        return `<img class="event-attendee-avatar" style="left:${left}px" src="${src}" alt="${name}" title="${name}" />`
      }
      return `<span class="event-attendee-avatar event-attendee-avatar--fallback" style="left:${left}px" title="${name}">${escapeHtml((person.username || '?').slice(0, 1).toUpperCase())}</span>`
    }).join('')

    const plus = remaining > 0
      ? `<span class="event-attendee-plus" style="left:${preview.length * 18}px">+${remaining}</span>`
      : ''

    const visible = preview.length + (remaining > 0 ? 1 : 0)
    const width = Math.max(30, visible ? (visible - 1) * 18 + 30 : 30)

    return `
      <span class="event-attendee-stack" style="width:${width}px">
        ${avatars}
        ${plus}
      </span>
      <span class="event-attendee-count">${summary.count} attending</span>
    `
  }

  function updateCardAttendance(eventId, attendance){
    const target = allEvents.find(event => String(event.id) === String(eventId))
    if(!target) return
    target.attendance = {
      count: Number(attendance && attendance.count || 0),
      meAttending: Boolean(attendance && attendance.meAttending),
      preview: Array.isArray(attendance && attendance.preview) ? attendance.preview : [],
      weeklySubscription: Boolean(attendance && attendance.weeklySubscription)
    }
  }

  function closeAttendeesMenu(){
    if(!openAttendeesMenu) return
    openAttendeesMenu.remove()
    openAttendeesMenu = null
  }

  function renderAttendeesMenu(hostCard, payload){
    closeAttendeesMenu()

    const attendees = Array.isArray(payload && payload.attendees) ? payload.attendees : []
    const count = Number(payload && payload.count || attendees.length || 0)

    const menu = document.createElement('div')
    menu.className = 'event-attendee-menu'
    menu.innerHTML = `
      <div class="event-attendee-menu__title">Attendees (${count})</div>
      <div class="event-attendee-menu__list"></div>
    `

    const list = menu.querySelector('.event-attendee-menu__list')
    if(!attendees.length){
      const empty = document.createElement('p')
      empty.className = 'event-attendee-menu__empty'
      empty.textContent = 'No attendees yet.'
      list.appendChild(empty)
    }else{
      attendees.forEach(person => {
        const row = document.createElement('div')
        row.className = 'event-attendee-menu__item'
        const label = String(person.tag || person.username || person.userId || 'Attendee')
        const avatarUrl = String(person.avatarUrl || '')
        row.innerHTML = `
          ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(label)}" />` : `<span class="event-attendee-menu__fallback">${escapeHtml(label.slice(0, 1).toUpperCase())}</span>`}
          <span>${escapeHtml(label)}</span>
        `
        list.appendChild(row)
      })
    }

    hostCard.appendChild(menu)
    openAttendeesMenu = menu
  }

  async function loadAttendees(eventId){
    const resp = await fetch(`${AUTH_SERVER}/api/events/${encodeURIComponent(eventId)}/attendees`, {
      credentials: 'include'
    })
    if(!resp.ok) throw new Error(`attendees_${resp.status}`)
    return resp.json()
  }

  async function setAttending(eventId, attending, subscribeWeekly){
    const resp = await fetch(`${AUTH_SERVER}/api/events/${encodeURIComponent(eventId)}/attendees`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attending, subscribeWeekly })
    })
    if(!resp.ok) throw new Error(`attending_${resp.status}`)
    return resp.json()
  }

  function eventSearchText(event){
    return [
      event.id,
      event.guildId,
      event.title,
      event.description,
      event.hostsText,
      event.status,
      event.pingRoleId,
      event.createdByUsername,
      event.createdBy,
      event.startAt,
      event.nextRunAt,
      event.lastRunAt,
      event.recurringTimeUtc,
      event.recurringWeekday
    ].join(' ').toLowerCase()
  }

  function renderEmpty(message){
    eventsList.innerHTML = ''
    const empty = document.createElement('div')
    empty.className = 'aos-empty'
    empty.textContent = message
    eventsList.appendChild(empty)
  }

  function closeAttendModal(){
    if(!openAttendModal) return
    openAttendModal.remove()
    openAttendModal = null
  }

  function openAttendPrompt(event, currentSummary, onConfirm){
    closeAttendModal()

    const modal = document.createElement('div')
    modal.className = 'event-attendance-modal'
    modal.innerHTML = `
      <div class="event-attendance-modal__backdrop" data-close="true"></div>
      <div class="event-attendance-modal__dialog" role="dialog" aria-modal="true" aria-label="Attendance options">
        <h3 class="event-attendance-modal__title">${currentSummary.meAttending ? 'Update attendance' : 'Join this event'}</h3>
        <p class="event-attendance-modal__text">${event.isRecurring ? 'Choose whether to be counted for this week and whether to stay signed up for future weekly events.' : 'Confirm your attendance for this event.'}</p>
        ${event.isRecurring ? `
          <label class="event-attendance-modal__option">
            <span>Sign me up for future weekly events</span>
            <input class="event-attendance-modal__checkbox" type="checkbox" ${currentSummary.weeklySubscription ? 'checked' : ''} />
          </label>
        ` : ''}
        <div class="event-attendance-modal__actions">
          <button type="button" class="btn btn-ghost event-attendance-modal__button event-attendance-modal__cancel">Cancel</button>
          <button type="button" class="btn event-attendance-modal__button event-attendance-modal__confirm">Save</button>
        </div>
      </div>
    `

    const confirmButton = modal.querySelector('.event-attendance-modal__confirm')
    const cancelButton = modal.querySelector('.event-attendance-modal__cancel')
    const checkbox = modal.querySelector('.event-attendance-modal__checkbox')
    const backdrop = modal.querySelector('.event-attendance-modal__backdrop')

    const closeModal = () => {
      closeAttendModal()
    }

    confirmButton.addEventListener('click', async () => {
      closeModal()
      await onConfirm(Boolean(checkbox && checkbox.checked))
    })
    cancelButton.addEventListener('click', closeModal)
    backdrop.addEventListener('click', closeModal)

    document.body.appendChild(modal)
    openAttendModal = modal
  }

  function renderEvents(events, queryText){
    eventsList.innerHTML = ''
    closeAttendeesMenu()
    closeAttendModal()
    if(!events.length){
      renderEmpty(queryText ? `No events matched "${queryText}".` : 'No events were found.')
      if(searchSummary) searchSummary.textContent = queryText ? '0 events matched your search.' : ''
      return
    }

    const grid = document.createElement('div')
    grid.className = 'aos-warrant-grid event-grid'

    events.forEach(event => {
      const whenText = shortTime(event.nextRunAt || event.startAt)
      const recurrenceText = event.isRecurring
        ? `Repeats ${weekdayLabel(event.recurringWeekday)} ${event.recurringTimeUtc || ''}`.trim()
        : 'One-time event'
      const statusText = String(event.status || 'scheduled')
      const desc = truncate(event.description || 'No description provided.', 140)
      const summary = attendeeSummary(event)
      const hostsLabel = event.createdByUsername || event.hostsText || 'N/A'

      const card = document.createElement('article')
      card.className = `dashboard-card aos-warrant-card event-card ${summary.meAttending ? 'event-card--attending' : ''}`
      card.dataset.eventId = String(event.id || '')
      card.innerHTML = `
        <div class="event-card__header">
          <span class="dashboard-card__badge event-card__status">${escapeHtml(statusText)}</span>
          <span class="event-card__time">${escapeHtml(whenText)}</span>
        </div>
        <h3 class="event-card__title">${escapeHtml(event.title || 'Untitled Event')}</h3>
        ${summary.meAttending ? '<p class="event-card__attending-indicator">You are attending</p>' : ''}
        <p class="event-card__meta">Host(s): ${escapeHtml(hostsLabel)}</p>
        <p class="event-card__meta">${escapeHtml(recurrenceText)}</p>
        <p class="event-card__desc">${escapeHtml(desc)}</p>

        <div class="event-card__footer">
          <button type="button" class="btn btn-ghost event-attend-btn ${summary.meAttending ? 'is-on' : ''}">
            ${summary.meAttending ? 'Interested' : 'I am interested'}
          </button>
          <button type="button" class="event-attendees-trigger" title="View attendees">
            ${attendeeStackHtml(event)}
          </button>
        </div>
        <div class="event-card__id">Event ID: ${escapeHtml(event.id || 'N/A')}</div>
      `

      const attendBtn = card.querySelector('.event-attend-btn')
      const attendeesBtn = card.querySelector('.event-attendees-trigger')

      attendBtn.addEventListener('click', () => {
        const current = attendeeSummary(event)
        const nextState = !current.meAttending
        openAttendPrompt(event, current, async (subscribeWeekly) => {
          attendBtn.disabled = true
          attendBtn.textContent = 'Saving...'
          try{
            const payload = await setAttending(event.id, nextState, subscribeWeekly)
            updateCardAttendance(event.id, payload && payload.attendance)
            applySearch()
          }catch(err){
            console.error(err)
            attendBtn.textContent = current.meAttending ? 'Interested' : 'I am interested'
          }finally{
            attendBtn.disabled = false
          }
        })
      })

      attendeesBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        try{
          const payload = await loadAttendees(event.id)
          updateCardAttendance(event.id, payload)
          renderAttendeesMenu(card, payload)
        }catch(err){
          console.error(err)
        }
      })

      grid.appendChild(card)
    })

    eventsList.appendChild(grid)
    if(searchSummary){
      searchSummary.textContent = queryText ? `${events.length} event${events.length === 1 ? '' : 's'} matched your search.` : ''
    }
  }

  function applySearch(){
    const queryText = normalizeText(searchInput && searchInput.value)
    const filtered = !queryText
      ? allEvents.slice()
      : allEvents.filter(event => eventSearchText(event).includes(queryText))

    renderEvents(filtered, queryText)
  }

  async function load(){
    statusMsg.textContent = 'Checking login...'
    const me = await ensureAuth()
    if(!me) return
    statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}. Loading events...`

    try{
      const resp = await fetch(`${AUTH_SERVER}/api/events`, { credentials: 'include' })
      if(resp.status === 403){
        statusMsg.textContent = 'Access denied: your Discord account is missing the required role.'
        renderEmpty('Access denied.')
        return
      }
      if(!resp.ok){
        statusMsg.textContent = `Failed to load events (${resp.status})`
        renderEmpty('Unable to load events.')
        return
      }

      const data = await resp.json()
      allEvents = Array.isArray(data) ? data : []
      statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}. Approved to view: Office of Special Investigations.`
      if(eventsSummary){
        eventsSummary.textContent = `${allEvents.length} event${allEvents.length === 1 ? '' : 's'} in bot_events.`
      }
      applySearch()
    }catch(err){
      console.error(err)
      statusMsg.textContent = 'Failed to load events'
      if(eventsSummary) eventsSummary.textContent = ''
      renderEmpty('Failed to load events.')
    }
  }

  if(searchInput){
    searchInput.addEventListener('input', applySearch)
  }

  document.addEventListener('click', (ev) => {
    if(!openAttendeesMenu) return
    if(openAttendeesMenu.contains(ev.target)) return
    if(ev.target && ev.target.closest && ev.target.closest('.event-attendees-trigger')) return
    closeAttendeesMenu()
  })

  document.addEventListener('keydown', (ev) => {
    if(ev.key === 'Escape' && openAttendModal){
      ev.stopPropagation()
      closeAttendModal()
    }
  })

  document.addEventListener('DOMContentLoaded', load)
})()
