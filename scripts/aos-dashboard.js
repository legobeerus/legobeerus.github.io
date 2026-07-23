(function(){
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const statusMsg = document.getElementById('statusMsg')
  const dashboardList = document.getElementById('aosDashboardList')

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

  function renderGroups(groups){
    dashboardList.innerHTML = ''
    if(!groups.length){
      renderEmpty('No active warrants were found.')
      return
    }

    const escapeHtml = utils().escapeHtml || (value => String(value == null ? '' : value))

    const grid = document.createElement('div')
    grid.className = 'dashboard-grid'

    groups.forEach(group => {
      const warrants = group.warrants.slice().sort((a, b) => {
        const aTime = new Date(a.activatedAt || a.createdAt || 0).getTime()
        const bTime = new Date(b.activatedAt || b.createdAt || 0).getTime()
        return bTime - aTime
      })
      const latest = warrants[0] || {}
      const card = document.createElement('a')
      card.className = 'dashboard-card aos-person-card'
      card.href = `aos-profile.html?username=${encodeURIComponent(group.username)}`
      card.innerHTML = `
        <div class="dashboard-card__top">
          <span class="dashboard-card__badge">${warrants.length} warrant${warrants.length === 1 ? '' : 's'}</span>
          <span class="dashboard-card__link">Open profile</span>
        </div>
        <h3>${escapeHtml(formatDisplay(group.username))}</h3>
        <p>${escapeHtml(latest.summary || latest.charges || 'Warrant record available.')}</p>
        <div class="aos-person-card__meta">
          <div class="aos-person-card__meta-row"><strong>Latest thread</strong><span>${escapeHtml(latest.threadName || latest.threadId || 'Unknown')}</span></div>
          <div class="aos-person-card__meta-row"><strong>Latest charge</strong><span>${escapeHtml(latest.charges || 'Unknown')}</span></div>
        </div>
      `
      card.setAttribute('aria-label', `${group.username} warrant profile`)
      grid.appendChild(card)
    })

    dashboardList.appendChild(grid)
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

      statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}. ${groups.length} person${groups.length === 1 ? '' : 's'} with active warrants.`
      renderGroups(groups)
    }catch(err){
      console.error(err)
      statusMsg.textContent = 'Failed to load AOS data'
      renderEmpty('Failed to load warrants.')
    }
  }

  document.addEventListener('DOMContentLoaded', load)
})()