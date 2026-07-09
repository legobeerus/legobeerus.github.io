(function(){
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const profileAvatar = document.getElementById('profileAvatar')
  const profileName = document.getElementById('profileName')
  const profileHandle = document.getElementById('profileHandle')
  const profileBio = document.getElementById('profileBio')
  const profileRoles = document.getElementById('profileRoles')
  const profileStats = document.getElementById('profileStats')
  const recentSubmissions = document.getElementById('recentSubmissions')

  function avatarUrl(user){
    if(!user) return ''
    if(user.avatar){
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
    }
    const disc = Number(user.discriminator) || 0
    return `https://cdn.discordapp.com/embed/avatars/${disc % 5}.png`
  }

  function formatDate(value){
    if(!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
  }

  function renderChips(container, items){
    container.innerHTML = ''
    if(!items || !items.length){
      const empty = document.createElement('span')
      empty.className = 'profile-chip profile-chip--muted'
      empty.textContent = 'No roles found'
      container.appendChild(empty)
      return
    }
    items.forEach(item=>{
      const chip = document.createElement('span')
      chip.className = 'profile-chip'
      chip.textContent = item
      container.appendChild(chip)
    })
  }

  function statCard(label, value){
    const wrap = document.createElement('div')
    wrap.className = 'profile-stat'
    wrap.innerHTML = `<div class="profile-stat__label">${label}</div><div class="profile-stat__value">${value}</div>`
    return wrap
  }

  function renderRecent(list){
    recentSubmissions.innerHTML = ''
    if(!list || !list.length){
      const empty = document.createElement('div')
      empty.className = 'profile-empty'
      empty.textContent = 'No submissions recorded yet.'
      recentSubmissions.appendChild(empty)
      return
    }
    list.forEach(item=>{
      const row = document.createElement('div')
      row.className = 'profile-activity__item'
      const passed = item.passed ? 'Passed' : 'Needs review'
      row.innerHTML = `
        <div>
          <div class="profile-activity__title">${item.exam_type || 'exam'} · ${item.exam_id || item.session_id}</div>
          <div class="profile-activity__meta">${item.score || 0}/${item.max_score || 0} points · ${item.percent || 0}%</div>
        </div>
        <div class="profile-activity__status ${item.passed ? 'is-passed' : 'is-failed'}">${passed}</div>
      `
      recentSubmissions.appendChild(row)
    })
  }

  async function loadProfile(){
    try{
      const meResp = await fetch(`${AUTH_SERVER}/api/me`, { credentials: 'include' })
      if(meResp.status === 204){
        window.location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname+location.search)}`
        return
      }
      if(meResp.status === 403){
        profileName.textContent = 'Access denied'
        profileHandle.textContent = 'Your Discord account does not have the required server role.'
        profileBio.textContent = 'This profile page is locked to members with the approved role in the target server.'
        renderChips(profileRoles, [])
        profileStats.innerHTML = ''
        recentSubmissions.innerHTML = '<div class="profile-empty">Access denied.</div>'
        return
      }
      const me = await meResp.json()
      const profileResp = await fetch(`${AUTH_SERVER}/api/profile`, { credentials: 'include' })
      if(profileResp.status === 403){
        profileName.textContent = 'Access denied'
        profileHandle.textContent = 'Your Discord account does not have the required server role.'
        profileBio.textContent = 'This profile page is locked to members with the approved role in the target server.'
        renderChips(profileRoles, [])
        profileStats.innerHTML = ''
        recentSubmissions.innerHTML = '<div class="profile-empty">Access denied.</div>'
        return
      }
      if(!profileResp.ok) throw new Error('profile fetch failed')
      const profile = await profileResp.json()

      profileAvatar.src = avatarUrl(me)
      profileAvatar.alt = `${me.username || 'User'} avatar`
      profileName.textContent = me.username ? `${me.username}${me.discriminator ? `#${me.discriminator}` : ''}` : 'Unknown user'
      profileHandle.textContent = me.username ? `@${me.username}` : (me.id ? `Discord ID: ${me.id}` : 'Discord account not linked')

      const total = Number(profile.stats && profile.stats.totalSubmissions || 0)
      const avg = Number(profile.stats && profile.stats.averagePercent || 0)
      const roles = Array.isArray(profile.roles) && profile.roles.length ? profile.roles : ['Reviewer']
      profileBio.textContent = total ? `You have reviewed ${total} exam(s) with an average score of ${avg}%.` : 'No review submissions have been recorded yet.'

      renderChips(profileRoles, roles)

      profileStats.innerHTML = ''
      profileStats.appendChild(statCard('Total submissions', total))
      profileStats.appendChild(statCard('Passed submissions', Number(profile.stats && profile.stats.passedSubmissions || 0)))
      profileStats.appendChild(statCard('Average score', `${avg}%`))
      profileStats.appendChild(statCard('Phase 1 reviews', Number(profile.stats && profile.stats.phase1Submissions || 0)))
      profileStats.appendChild(statCard('Phase 4 reviews', Number(profile.stats && profile.stats.phase4Submissions || 0)))
      profileStats.appendChild(statCard('Last submission', formatDate(profile.stats && profile.stats.lastSubmittedAt)))

      renderRecent(profile.recentSubmissions || [])
    }catch(e){
      console.error(e)
      profileName.textContent = 'Profile unavailable'
      profileHandle.textContent = 'Could not load profile data.'
      profileBio.textContent = 'Try refreshing the page.'
      renderChips(profileRoles, [])
      profileStats.innerHTML = ''
      recentSubmissions.innerHTML = '<div class="profile-empty">Unable to load recent submissions.</div>'
    }
  }

  document.addEventListener('DOMContentLoaded', loadProfile)
})();