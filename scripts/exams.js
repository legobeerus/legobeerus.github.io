(function(){
  const statusMsg = document.getElementById('statusMsg')
  const phase1List = document.getElementById('phase1List')
  const phase4List = document.getElementById('phase4List')

  function el(tag, txt){ const e = document.createElement(tag); if(txt!=null) e.textContent = txt; return e }

  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin

  async function ensureAuth(){
    try{
      const r = await fetch(`${AUTH_SERVER}/api/me`, { credentials: 'include' })
      if(r.status===204) { window.location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname+location.search)}`; return null }
      return await r.json()
    }catch(e){ console.error(e); statusMsg.textContent='Auth check failed'; return null }
  }

  function renderList(container, items){
    container.innerHTML = '';
    if(!items || items.length===0){ container.textContent = 'No pending exams.'; return }
    const ul = document.createElement('ul')
    items.forEach(it=>{
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = `grade.html?session=${encodeURIComponent(it.id)}`
      a.textContent = `${it.id} — ${it.candidate_mention || it.candidate || it.candidate_name || it.userId || 'unknown'} (${it.created_at || ''})`
      li.appendChild(a)
      ul.appendChild(li)
    })
    container.appendChild(ul)
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
    const haystack = `${item && item.examId ? item.examId : ''} ${item && item.id ? item.id : ''}`.toLowerCase()
    return haystack.includes(`phase${phaseNumber}`)
  }

  function isPendingLike(item){
    const status = normalizeStatus(item && item.status)
    return status.includes('pending') || status.includes('awaiting') || status.includes('review') || status.includes('queued')
  }

  async function load(){
    statusMsg.textContent = 'Checking login...'
    const user = await ensureAuth()
    if(!user) return
    statusMsg.textContent = `Signed in as ${user.username}#${user.discriminator}`

    try{
      const resp = await fetch(`${AUTH_SERVER}/api/exams`, { credentials: 'include' })
      if(!resp.ok){
        statusMsg.textContent = `Failed to load exams (${resp.status})`
        renderList(phase1List, [])
        renderList(phase4List, [])
        return
      }

      const data = await resp.json()
      const items = Array.isArray(data) ? data : []
      const phase1Items = items.filter(item => isPhaseExam(item, 1) && isPendingLike(item))
      const phase4Items = items.filter(item => isPhaseExam(item, 4) && isPendingLike(item))

      renderList(phase1List, mergeUniqueLists([phase1Items]))
      renderList(phase4List, mergeUniqueLists([phase4Items]))
      statusMsg.textContent = `Loaded ${items.length} exams. Phase 1: ${phase1Items.length}, Phase 4: ${phase4Items.length}`
    }catch(e){ console.error(e); statusMsg.textContent='Failed to load exams' }
  }

  document.addEventListener('DOMContentLoaded', load)
})();
