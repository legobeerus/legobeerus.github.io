(function(){
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const statusMsg = document.getElementById('statusMsg')
  const profileAvatar = document.getElementById('aosProfileAvatar')
  const profileName = document.getElementById('aosProfileName')
  const profileHandle = document.getElementById('aosProfileHandle')
  const profileBio = document.getElementById('aosProfileBio')
  const profileRoles = document.getElementById('aosProfileFacts')
  const profileStats = document.getElementById('aosProfileStats')
  const warrantList = document.getElementById('aosWarrantsList')
  const STORAGE_KEY = 'agentos.dashboard.seen.aos'

  function U(){
    return window.AOS_UTILS || {}
  }

  function usernameFromQuery(){
    return new URLSearchParams(window.location.search).get('username') || ''
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

  function renderFacts(items){
    profileRoles.innerHTML = ''
    items.forEach(item => {
      const chip = document.createElement('span')
      chip.className = 'profile-chip'
      chip.textContent = item
      profileRoles.appendChild(chip)
    })
  }

  function statCard(label, value){
    const utils = U()
    const escapeHtml = utils.escapeHtml || (input => String(input == null ? '' : input))
    const wrap = document.createElement('div')
    wrap.className = 'profile-stat'
    wrap.innerHTML = `<div class="profile-stat__label">${escapeHtml(label)}</div><div class="profile-stat__value">${escapeHtml(value)}</div>`
    return wrap
  }

  function renderEmpty(message){
    warrantList.innerHTML = ''
    const empty = document.createElement('div')
    empty.className = 'aos-empty'
    empty.textContent = message
    warrantList.appendChild(empty)
  }

  function renderTags(tags){
    if(!tags || !tags.length) return ''
    const utils = U()
    return `
      <div class="aos-tag-list">
        ${tags.map(tag => `<span class="aos-tag">${utils.tagLabel ? utils.tagLabel(tag) : tag}</span>`).join('')}
      </div>
    `
  }

  async function loadWarrantsForUsername(username){
    const personResp = await fetch(`${AUTH_SERVER}/api/aos/person/${encodeURIComponent(username)}`, { credentials: 'include' })
    if(personResp.ok) return await personResp.json()

    const fallbackResp = await fetch(`${AUTH_SERVER}/api/aos/active`, { credentials: 'include' })
    if(!fallbackResp.ok) throw new Error(`aos fetch failed (${fallbackResp.status})`)
    const fallbackData = await fallbackResp.json()
    const normalized = (Array.isArray(fallbackData) ? fallbackData : []).map(item => (U().normalizeWarrant ? U().normalizeWarrant(item) : item))
    return normalized.filter(item => String(item.username || '').toLowerCase() === username.toLowerCase())
  }

  function cardHtml(warrant){
    const utils = U()
    const dateLabel = utils.formatDate ? utils.formatDate(warrant.activatedAt || warrant.createdAt) : (warrant.activatedAt || warrant.createdAt || '')
    const lastSeen = utils.formatDate ? utils.formatDate(warrant.lastSeenAt) : warrant.lastSeenAt
    const postedByBot = warrant.postedByBot !== false
    const deleteButton = !postedByBot
      ? `<button type="button" class="is-danger" data-delete-thread="${utils.escapeHtml ? utils.escapeHtml(warrant.threadId) : warrant.threadId}">Delete warrant</button>`
      : ''
    return `
      <article class="dashboard-card aos-warrant-card">
        <div class="dashboard-card__top">
          <span class="dashboard-card__badge">${postedByBot ? 'Bot posted' : 'Manual entry'}</span>
          <span class="dashboard-card__link ${postedByBot ? '' : 'is-muted'}">${utils.escapeHtml ? utils.escapeHtml(warrant.threadId || 'Warrant') : (warrant.threadId || 'Warrant')}</span>
        </div>
        <h3 class="aos-warrant-card__title">${utils.escapeHtml ? utils.escapeHtml(warrant.threadName || warrant.username || 'AOS warrant') : (warrant.threadName || warrant.username || 'AOS warrant')}</h3>
        <p class="aos-warrant-card__subtitle">${utils.escapeHtml ? utils.escapeHtml(warrant.summary || warrant.charges || 'No summary available.') : (warrant.summary || warrant.charges || 'No summary available.')}</p>
        <div class="aos-warrant-card__meta">
          <div class="aos-warrant-card__row"><strong>Submitter</strong><span>${utils.escapeHtml ? utils.escapeHtml(warrant.submitter || 'Unknown') : (warrant.submitter || 'Unknown')}</span></div>
          <div class="aos-warrant-card__row"><strong>Victims</strong><span>${utils.escapeHtml ? utils.escapeHtml(warrant.victims || 'Unknown') : (warrant.victims || 'Unknown')}</span></div>
          <div class="aos-warrant-card__row"><strong>Jail time</strong><span>${Number(warrant.jailMinutes || warrant.calculatedTimeMinutes || 0) || 0} minutes</span></div>
          <div class="aos-warrant-card__row"><strong>Last seen</strong><span>${lastSeen || 'Unknown'}</span></div>
          <div class="aos-warrant-card__row"><strong>Created</strong><span>${dateLabel || 'Unknown'}</span></div>
        </div>
        ${renderTags(warrant.tags)}
        <div class="aos-warrant-card__links">
          ${warrant.url ? `<a href="${utils.escapeHtml ? utils.escapeHtml(warrant.url) : warrant.url}" target="_blank" rel="noreferrer">Open thread</a>` : ''}
          ${warrant.profile ? `<a href="${utils.escapeHtml ? utils.escapeHtml(warrant.profile) : warrant.profile}" target="_blank" rel="noreferrer">Open profile</a>` : ''}
          ${warrant.proof ? `<a href="${utils.escapeHtml ? utils.escapeHtml(warrant.proof) : warrant.proof}" target="_blank" rel="noreferrer">View proof</a>` : ''}
          ${deleteButton}
        </div>
      </article>
    `
  }

  async function deleteWarrant(threadId){
    const confirmed = window.confirm('Delete this non-bot warrant from the database?')
    if(!confirmed) return
    try{
      const resp = await fetch(`${AUTH_SERVER}/api/aos/${encodeURIComponent(threadId)}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      if(resp.status === 401 || resp.status === 403){
        statusMsg.textContent = 'Delete failed: authentication is required.'
        return
      }
      if(!resp.ok){
        statusMsg.textContent = `Delete failed (${resp.status})`
        return
      }
      await loadProfile()
    }catch(err){
      console.error(err)
      statusMsg.textContent = 'Delete failed'
    }
  }

  async function loadProfile(){
    const targetUsername = usernameFromQuery().trim()
    if(!targetUsername){
      statusMsg.textContent = 'Missing username query parameter.'
      profileName.textContent = 'No AOS profile selected'
      profileHandle.textContent = 'Add ?username=personname to the URL.'
      profileBio.textContent = 'Pick a username from the AOS dashboard.'
      renderFacts([])
      profileStats.innerHTML = ''
      renderEmpty('No warrant profile selected.')
      return
    }

    statusMsg.textContent = 'Checking login...'
    const me = await ensureAuth()
    if(!me) return

    statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}. Loading warrant profile...`

    try{
      const response = await fetch(`${AUTH_SERVER}/api/aos/person/${encodeURIComponent(targetUsername)}`, { credentials: 'include' })
      if(response.status === 403){
        statusMsg.textContent = 'Access denied: your Discord account is missing the required AOS role.'
        profileName.textContent = 'Access denied'
        profileHandle.textContent = 'Your Discord account is missing the required AOS role.'
        profileBio.textContent = 'This profile is locked.'
        renderFacts([])
        profileStats.innerHTML = ''
        renderEmpty('Access denied.')
        return
      }
      const data = response.ok ? await response.json() : await loadWarrantsForUsername(targetUsername)
      const warrants = (Array.isArray(data) ? data : []).map(item => (U().normalizeWarrant ? U().normalizeWarrant(item) : item))
        .sort((a, b) => {
          const aTime = new Date(a.activatedAt || a.createdAt || 0).getTime()
          const bTime = new Date(b.activatedAt || b.createdAt || 0).getTime()
          return bTime - aTime
        })

      if(response.ok && !warrants.length){
        // If the dedicated endpoint is empty, one fallback pass keeps the page from appearing stuck.
        const fallbackWarrants = await loadWarrantsForUsername(targetUsername)
        warrants.push(...fallbackWarrants.sort((a, b) => {
          const aTime = new Date(a.activatedAt || a.createdAt || 0).getTime()
          const bTime = new Date(b.activatedAt || b.createdAt || 0).getTime()
          return bTime - aTime
        }))
      }

      if(!warrants.length){
        profileName.textContent = targetUsername
        profileHandle.textContent = 'No warrants found for this username.'
        profileBio.textContent = 'The selected profile does not currently have any active warrants.'
        renderFacts([`Username: ${targetUsername}`, 'Warrants: 0'])
        profileStats.innerHTML = ''
        renderEmpty('No active warrants found for this person.')
        statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}.`
        return
      }

      const latest = warrants[0]
      const postedByBotCount = warrants.filter(item => item.postedByBot !== false).length
      const manualCount = warrants.length - postedByBotCount
      const totalJail = warrants.reduce((sum, item) => sum + (Number(item.jailMinutes || item.calculatedTimeMinutes || 0) || 0), 0)
      const knownProfile = warrants.find(item => item.profile) || null

      profileAvatar.src = 'media/logo.png'
      profileAvatar.alt = `${targetUsername} profile icon`
      profileName.textContent = targetUsername
      profileHandle.textContent = latest.threadName || `Active warrants for ${targetUsername}`
      profileBio.textContent = latest.summary || latest.charges || 'Warrant profile loaded from the AOS database.'

      renderFacts([
        `Username: ${targetUsername}`,
        `Warrants: ${warrants.length}`,
        `Bot posted: ${postedByBotCount}`,
        `Manual entries: ${manualCount}`,
        knownProfile && knownProfile.profile ? `Profile: ${knownProfile.profile}` : 'Profile: unavailable'
      ])

      profileStats.innerHTML = ''
      profileStats.appendChild(statCard('Warrants', warrants.length))
      profileStats.appendChild(statCard('Bot posted', postedByBotCount))
      profileStats.appendChild(statCard('Manual entries', manualCount))
      profileStats.appendChild(statCard('Total jail time', `${totalJail} minutes`))
      profileStats.appendChild(statCard('Latest thread', latest.threadName || latest.threadId || 'Unknown'))
      profileStats.appendChild(statCard('Last seen', U().formatDate ? U().formatDate(latest.lastSeenAt) : (latest.lastSeenAt || 'Unknown')))

      warrantList.innerHTML = ''
      const grid = document.createElement('div')
      grid.className = 'aos-warrant-grid'

      warrants.forEach(warrant => {
        const wrap = document.createElement('div')
        wrap.innerHTML = cardHtml(warrant)
        const card = wrap.firstElementChild
        const deleteButton = card && card.querySelector('[data-delete-thread]')
        if(deleteButton){
          deleteButton.addEventListener('click', () => deleteWarrant(warrant.threadId))
        }
        grid.appendChild(card)
      })

      warrantList.appendChild(grid)
      statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}.`
      writeSeenAt(new Date(latest.activatedAt || latest.createdAt || Date.now()).getTime())
    }catch(err){
      console.error(err)
      statusMsg.textContent = 'Failed to load AOS profile'
      renderEmpty('Failed to load warrant profile.')
    }
  }

  document.addEventListener('DOMContentLoaded', loadProfile)
})()