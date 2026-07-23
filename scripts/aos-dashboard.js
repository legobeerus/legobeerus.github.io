(function(){
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const statusMsg = document.getElementById('statusMsg')
  const dashboardList = document.getElementById('aosDashboardList')
  const searchInput = document.getElementById('aosSearch')
  const searchSummary = document.getElementById('aosSearchSummary')
  const STORAGE_KEY = 'agentos.dashboard.seen.aos'

  let allGroups = []

  function utils(){
    return window.AOS_UTILS || {}
  }

  function ensureAuth(){
    return fetch(`${AUTH_SERVER}/api/me`, { credentials: 'include' })
      .then(resp => {
        if(resp.status === 204 || resp.status === 401){
          window.location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname + location.search)}`
          return null
        }
        if(resp.status === 403){
          statusMsg.textContent = 'Access denied: your Discord account is missing the required AOS role.'
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

  function readSeenAt(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY)
      const value = raw ? Number(raw) : 0
      return Number.isFinite(value) ? value : 0
    }catch(_){
      return 0
    }
  }

  function writeSeenAt(value){
    try{
      localStorage.setItem(STORAGE_KEY, String(value || Date.now()))
    }catch(_){
      /* ignore storage failures */
    }
  }

  function toTime(value){
    if(!value) return 0
    const text = String(value)
    if(/^\d{16,22}$/.test(text)) return Number((BigInt(text) >> 22n) + 1420070400000n)
    const parsed = new Date(text)
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
  }

  function normalizeText(value){
    return String(value || '').toLowerCase().trim()
  }

  function warrantSearchText(warrant){
    const utilsApi = utils()
    const tagText = (warrant.tags || []).map(tag => utilsApi.tagLabel ? utilsApi.tagLabel(tag) : tag).join(' ')
    return [
      warrant.username,
      warrant.threadName,
      warrant.threadId,
      warrant.summary,
      warrant.charges,
      warrant.victims,
      warrant.submitter,
      warrant.proof,
      warrant.profile,
      tagText
    ].join(' ').toLowerCase()
  }

  function groupSearchText(group){
    return [group.username, ...group.warrants.map(warrantSearchText)].join(' ').toLowerCase()
  }

  function latestGroupTime(group){
    return (group.warrants || []).reduce((max, warrant)=>Math.max(max, toTime(warrant.activatedAt || warrant.createdAt || warrant.lastSeenAt)), 0)
  }

  function formatDisplay(username){
    const text = String(username || 'Unknown')
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  function renderEmpty(message){
    dashboardList.innerHTML = ''
    const empty = document.createElement('div')
    empty.className = 'aos-empty'
    empty.textContent = message
    dashboardList.appendChild(empty)
  }

  function renderGroups(groups, queryText){
    dashboardList.innerHTML = ''
    if(!groups.length){
      renderEmpty(queryText ? `No active warrants matched "${queryText}".` : 'No active warrants were found.')
      if(searchSummary) searchSummary.textContent = queryText ? `0 matching person${0 === 1 ? '' : 's'}.` : ''
      return
    }

    const escapeHtml = utils().escapeHtml || (value => String(value == null ? '' : value))
    const sortTags = utils().sortTags || (tags => tags)
    const tagLabel = utils().tagLabel || (tag => String(tag))

    const grid = document.createElement('div')
    grid.className = 'dashboard-grid'

    groups.forEach(group => {
      const warrants = group.warrants.slice().sort((a, b) => {
        const aTime = new Date(a.activatedAt || a.createdAt || 0).getTime()
        const bTime = new Date(b.activatedAt || b.createdAt || 0).getTime()
        return bTime - aTime
      })
      const latest = warrants[0] || {}
      const tags = sortTags(warrants.flatMap(warrant => warrant.tags || []))
      const card = document.createElement('a')
      card.className = 'dashboard-card aos-person-card'
      card.href = `aos-profile.html?username=${encodeURIComponent(group.username)}`
      card.innerHTML = `
        <div class="dashboard-card__top">
          <span class="dashboard-card__badge">${warrants.length} warrant${warrants.length === 1 ? '' : 's'}</span>
          <span class="dashboard-card__link">Open profile</span>
        </div>
        <h3>${escapeHtml(formatDisplay(group.username))}</h3>
        <div class="aos-person-card__tags">
          ${tags.length ? `<div class="aos-tag-list">${tags.map(tag => `<span class="aos-tag">${escapeHtml(tagLabel(tag))}</span>`).join('')}</div>` : ''}
        </div>
        <div class="aos-person-card__meta">
          <div class="aos-person-card__meta-row"><strong>Latest thread</strong><span>${escapeHtml(latest.threadName || latest.threadId || 'Unknown')}</span></div>
          <div class="aos-person-card__meta-row"><strong>Latest charge</strong><span>${escapeHtml(latest.charges || 'Unknown')}</span></div>
        </div>
      `
      card.setAttribute('aria-label', `${group.username} warrant profile`)
      grid.appendChild(card)
    })

    dashboardList.appendChild(grid)
    if(searchSummary) searchSummary.textContent = queryText ? `${groups.length} person${groups.length === 1 ? '' : 's'} match your search.` : ''
  }

  function applySearch(){
    const queryText = normalizeText(searchInput && searchInput.value)
    const filtered = !queryText
      ? allGroups.slice()
      : allGroups.filter(group => groupSearchText(group).includes(queryText))

    renderGroups(filtered, queryText)
  }

  async function load(){
    statusMsg.textContent = 'Checking login...'
    const me = await ensureAuth()
    if(!me) return

    statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}. Loading active warrants...`

    try{
      const resp = await fetch(`${AUTH_SERVER}/api/aos/active`, { credentials: 'include' })
      if(resp.status === 403){
        statusMsg.textContent = 'Access denied: your Discord account is missing the required AOS role.'
        renderEmpty('Access denied.')
        return
      }
      if(!resp.ok){
        statusMsg.textContent = `Failed to load AOS data (${resp.status})`
        renderEmpty('Unable to load warrants.')
        return
      }

      const data = await resp.json()
      const normalized = (Array.isArray(data) ? data : []).map(item => (utils().normalizeWarrant ? utils().normalizeWarrant(item) : item))
      const groups = (utils().groupByUsername ? utils().groupByUsername(normalized) : [])
        .sort((a, b) => b.warrants.length - a.warrants.length)

      allGroups = groups
      statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}. Approved to view: Office of Special Investigations.`
      applySearch()

      const latestTime = groups.reduce((max, group) => Math.max(max, latestGroupTime(group)), 0)
      if(latestTime) writeSeenAt(latestTime)
    }catch(err){
      console.error(err)
      statusMsg.textContent = 'Failed to load AOS data'
      renderEmpty('Failed to load warrants.')
    }
  }

  if(searchInput){
    searchInput.addEventListener('input', applySearch)
  }

  document.addEventListener('DOMContentLoaded', load)
})()