(function(){
  const statusMsg = document.getElementById('statusMsg')
  const phase1List = document.getElementById('phase1List')
  const phase4List = document.getElementById('phase4List')

  function el(tag, txt){ const e = document.createElement(tag); if(txt!=null) e.textContent = txt; return e }

  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin

  function formatDate(value){
    if(!value) return ''
    const text = String(value)
    const discordSnowflakeLike = /^\d{16,22}$/.test(text)
    if(discordSnowflakeLike){
      const epoch = Number((BigInt(text) >> 22n) + 1420070400000n)
      const date = new Date(epoch)
      if(!Number.isNaN(date.getTime())) return date.toLocaleString()
    }
    const isoLike = text.length === 14 && /^\d+$/.test(text)
    if(isoLike){
      const year = Number(text.slice(0,4))
      const month = Number(text.slice(4,6)) - 1
      const day = Number(text.slice(6,8))
      const hour = Number(text.slice(8,10))
      const minute = Number(text.slice(10,12))
      const second = Number(text.slice(12,14))
      const date = new Date(year, month, day, hour, minute, second)
      if(!Number.isNaN(date.getTime())) return date.toLocaleString()
    }
    const maybeDate = new Date(text)
    return Number.isNaN(maybeDate.getTime()) ? text : maybeDate.toLocaleString()
  }

  async function ensureAuth(){
    try{
      const r = await fetch(`${AUTH_SERVER}/api/me`, { credentials: 'include' })
      if(r.status===204 || r.status===401) { window.location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname+location.search)}`; return null }
      if(r.status===403) { statusMsg.textContent = 'Access denied: your Discord account is missing the required server role.'; return null }
      return await r.json()
    }catch(e){ console.error(e); statusMsg.textContent='Auth check failed'; return null }
  }

  function renderList(container, items){
    container.innerHTML = '';
    if(!items || items.length===0){
      const empty = document.createElement('div')
      empty.className = 'dashboard-empty'
      empty.textContent = 'No active exams are waiting in this section.'
      container.appendChild(empty)
      return
    }
    const grid = document.createElement('div')
    grid.className = 'dashboard-grid'
    items.forEach(it=>{
      const a = document.createElement('a')
      a.className = 'dashboard-card'
      a.href = `grade.html?session=${encodeURIComponent(it.id)}`
      const examId = it.exam_id || it.examId || it.id
      const candidate = it.candidate_mention || it.candidate_username || it.candidateName || it.candidate_name || it.candidate || it.username || it.userId || 'Unknown candidate'
      const createdAt = formatDate(it.created_at)
      const phaseLabel = /phase\s*4/i.test(String(examId)) ? 'Phase 4 review' : 'Phase 1 review'
      const lockName = String(it.under_review_by || '').trim()
      const lockText = lockName ? `Under review by ${lockName}` : 'Active'
      const badgeClass = lockName ? 'dashboard-card__badge dashboard-card__badge--locked' : 'dashboard-card__badge'
      a.innerHTML = `
        <div class="dashboard-card__top">
          <span class="${badgeClass}">${lockText}</span>
          <span class="dashboard-card__link">Open review</span>
        </div>
        <h3>${phaseLabel}</h3>
        <p>${candidate}</p>
        <div class="dashboard-card__meta">Submitted${createdAt ? ` ${createdAt}` : ''}</div>
      `
      a.setAttribute('aria-label', `${phaseLabel} for ${candidate}`)
      grid.appendChild(a)
    })
    container.appendChild(grid)
  }

  function mergeUniqueLists(lists){
    const seen = new Set()
    const merged = []
    lists.flat().forEach(item=>{
      if(!item || !item.id || seen.has(item.id)) return
      seen.add(item.id)
      merged.push(item)
    })
    return merged
  }

  function normalizeStatus(value){
    return String(value || '').toLowerCase().trim()
  }

  function isPhaseExam(item, phaseNumber){
    const values = [item && item.exam_id, item && item.examId, item && item.id]
      .filter(Boolean)
      .map(v => String(v).toLowerCase())
    const normalized = values.map(v => v.replace(/[^a-z0-9]+/g, ''))
    const target = `phase${phaseNumber}`
    return normalized.some(v => v === target || v.includes(target)) || values.some(v => v.includes(`phase ${phaseNumber}`) || v.includes(`phase-${phaseNumber}`) || v.includes(`phase_${phaseNumber}`))
  }

  function isActiveExam(item){
    const status = normalizeStatus(item && item.status)
    return status === 'active'
  }

  async function load(){
    statusMsg.textContent = 'Checking login...'
    const user = await ensureAuth()
    if(!user) return
    statusMsg.textContent = `Signed in as ${user.username}#${user.discriminator}. Active reviews ready.`

    try{
      const resp = await fetch(`${AUTH_SERVER}/api/exams`, { credentials: 'include' })
      if(resp.status === 403){
        statusMsg.textContent = 'Access denied: your Discord account is missing the required server role.'
        renderList(phase1List, [])
        renderList(phase4List, [])
        return
      }
      if(!resp.ok){
        statusMsg.textContent = `Failed to load exams (${resp.status})`
        renderList(phase1List, [])
        renderList(phase4List, [])
        return
      }

      const data = await resp.json()
      const items = Array.isArray(data) ? data : []
      const phase1Items = items.filter(item => isPhaseExam(item, 1) && isActiveExam(item))
      const phase4Items = items.filter(item => isPhaseExam(item, 4) && isActiveExam(item))

      renderList(phase1List, mergeUniqueLists([phase1Items]))
      renderList(phase4List, mergeUniqueLists([phase4Items]))
    }catch(e){ console.error(e); statusMsg.textContent='Failed to load exams' }
  }

  document.addEventListener('DOMContentLoaded', load)
})();
