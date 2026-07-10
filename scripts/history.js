(function(){
  const statusMsg = document.getElementById('statusMsg')
  const historyList = document.getElementById('historyList')
  const historySearch = document.getElementById('historySearch')
  const historySummary = document.getElementById('historySummary')

  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin

  let allItems = []

  function formatDate(value){
    if(!value) return ''
    const text = String(value)
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
      if(r.status===204 || r.status===401) {
        window.location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname+location.search)}`
        return null
      }
      if(r.status===403) {
        statusMsg.textContent = 'Access denied: your Discord account is missing the required server role.'
        return null
      }
      return await r.json()
    }catch(e){
      console.error(e)
      statusMsg.textContent='Auth check failed'
      return null
    }
  }

  function el(tag, txt){
    const node = document.createElement(tag)
    if(txt != null) node.textContent = txt
    return node
  }

  function normalizeText(value){
    return String(value || '').toLowerCase().trim()
  }

  function searchableText(item){
    const examId = item.exam_id || item.examId || ''
    const candidate = item.candidate_mention || item.candidate || item.candidate_name || item.userId || ''
    const createdAt = formatDate(item.created_at)
    const rawDate = item.created_at || ''
    const sessionId = item.id || ''
    return `${examId} ${candidate} ${createdAt} ${rawDate} ${sessionId}`.toLowerCase()
  }

  function cardData(item){
    const examId = item.exam_id || item.examId || item.id
    const candidate = item.candidate_mention || item.candidate || item.candidate_name || item.userId || 'Unknown candidate'
    const createdAt = formatDate(item.created_at)
    const phaseLabel = /phase\s*4/i.test(String(examId)) ? 'Phase 4 review' : 'Phase 1 review'
    return { examId, candidate, createdAt, phaseLabel }
  }

  function renderList(items){
    historyList.innerHTML = ''

    if(!items || items.length === 0){
      const empty = document.createElement('div')
      empty.className = 'dashboard-empty'
      empty.textContent = 'No graded exams match your search.'
      historyList.appendChild(empty)
      return
    }

    const grid = document.createElement('div')
    grid.className = 'dashboard-grid'

    items.forEach(item=>{
      const a = document.createElement('a')
      a.className = 'dashboard-card'
      a.href = `grade.html?session=${encodeURIComponent(item.id)}&view=archive`

      const info = cardData(item)
      a.innerHTML = `
        <div class="dashboard-card__top">
          <span class="dashboard-card__badge">Graded</span>
          <span class="dashboard-card__link">Open review</span>
        </div>
        <h3>${info.phaseLabel}</h3>
        <p>${info.candidate}</p>
        <div class="dashboard-card__meta">Submitted${info.createdAt ? ` ${info.createdAt}` : ''}</div>
      `
      a.setAttribute('aria-label', `${info.phaseLabel} for ${info.candidate}`)
      grid.appendChild(a)
    })

    historyList.appendChild(grid)
  }

  function renderSummary(visible, total){
    const search = normalizeText(historySearch && historySearch.value)
    if(!search){
      historySummary.textContent = `${visible} graded exam${visible === 1 ? '' : 's'}.`
      return
    }
    historySummary.textContent = `Showing ${visible} of ${total} graded exam${total === 1 ? '' : 's'} for "${search}".`
  }

  function applySearch(){
    const query = normalizeText(historySearch && historySearch.value)
    const filtered = !query
      ? allItems.slice()
      : allItems.filter(item => searchableText(item).includes(query))

    renderSummary(filtered.length, allItems.length)
    renderList(filtered)
  }

  async function load(){
    statusMsg.textContent = 'Checking login...'
    const user = await ensureAuth()
    if(!user) return

    statusMsg.textContent = `Signed in as ${user.username}#${user.discriminator}. Loading graded history...`

    try{
      const resp = await fetch(`${AUTH_SERVER}/api/exams?status=graded`, { credentials: 'include' })
      if(resp.status === 403){
        statusMsg.textContent = 'Access denied: your Discord account is missing the required server role.'
        allItems = []
        applySearch()
        return
      }
      if(!resp.ok){
        statusMsg.textContent = `Failed to load exam history (${resp.status})`
        allItems = []
        applySearch()
        return
      }

      const data = await resp.json()
      allItems = (Array.isArray(data) ? data : []).filter(item => item && item.id)

      statusMsg.textContent = `Signed in as ${user.username}#${user.discriminator}.`
      applySearch()
    }catch(e){
      console.error(e)
      statusMsg.textContent = 'Failed to load exam history'
      allItems = []
      applySearch()
    }
  }

  if(historySearch){
    historySearch.addEventListener('input', applySearch)
  }

  document.addEventListener('DOMContentLoaded', load)
})();
