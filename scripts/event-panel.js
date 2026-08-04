(function(){
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const statusMsg = document.getElementById('statusMsg')
  const eventsSummary = document.getElementById('eventsSummary')
  const eventsList = document.getElementById('eventsList')
  const searchInput = document.getElementById('eventsSearch')
  const searchSummary = document.getElementById('eventsSearchSummary')

  let allEvents = []

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

  function formatTime(value){
    if(!value) return 'N/A'
    const date = new Date(value)
    if(!Number.isNaN(date.getTime())) return date.toLocaleString()
    return String(value)
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

  function renderEvents(events, queryText){
    eventsList.innerHTML = ''
    if(!events.length){
      renderEmpty(queryText ? `No events matched "${queryText}".` : 'No events were found.')
      if(searchSummary) searchSummary.textContent = queryText ? '0 events matched your search.' : ''
      return
    }

    const grid = document.createElement('div')
    grid.className = 'aos-warrant-grid event-grid'

    events.forEach(event => {
      const card = document.createElement('article')
      card.className = 'dashboard-card aos-warrant-card event-card'
      card.innerHTML = `
        <div class="dashboard-card__top">
          <span class="dashboard-card__badge event-card__status">${escapeHtml(event.status || 'unknown')}</span>
          <span class="dashboard-card__link">ID ${escapeHtml(event.id || 'N/A')}</span>
        </div>
        <h3 class="aos-warrant-card__title">${escapeHtml(event.title || 'Untitled Event')}</h3>
        <p class="aos-warrant-card__subtitle">${escapeHtml(event.description || 'No description provided.')}</p>

        <div class="aos-warrant-card__meta">
          <div class="aos-warrant-card__row"><strong>Guild</strong><span>${escapeHtml(event.guildId || 'N/A')}</span></div>
          <div class="aos-warrant-card__row"><strong>Hosts</strong><span>${escapeHtml(event.hostsText || 'N/A')}</span></div>
          <div class="aos-warrant-card__row"><strong>Start</strong><span>${escapeHtml(formatTime(event.startAt))}</span></div>
          <div class="aos-warrant-card__row"><strong>Recurring</strong><span>${event.isRecurring ? 'Yes' : 'No'}</span></div>
          <div class="aos-warrant-card__row"><strong>Weekday</strong><span>${escapeHtml(weekdayLabel(event.recurringWeekday))}</span></div>
          <div class="aos-warrant-card__row"><strong>Recurring UTC</strong><span>${escapeHtml(event.recurringTimeUtc || 'N/A')}</span></div>
          <div class="aos-warrant-card__row"><strong>Next run</strong><span>${escapeHtml(formatTime(event.nextRunAt))}</span></div>
          <div class="aos-warrant-card__row"><strong>Last run</strong><span>${escapeHtml(formatTime(event.lastRunAt))}</span></div>
          <div class="aos-warrant-card__row"><strong>Ping role</strong><span>${escapeHtml(event.pingRoleId || 'N/A')}</span></div>
          <div class="aos-warrant-card__row"><strong>Created by</strong><span>${escapeHtml(event.createdBy || 'N/A')}</span></div>
          <div class="aos-warrant-card__row"><strong>Created</strong><span>${escapeHtml(formatTime(event.createdAt))}</span></div>
          <div class="aos-warrant-card__row"><strong>Updated</strong><span>${escapeHtml(formatTime(event.updatedAt))}</span></div>
        </div>
      `
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

  document.addEventListener('DOMContentLoaded', load)
})()
