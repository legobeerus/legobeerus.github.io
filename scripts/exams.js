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

  async function load(){
    statusMsg.textContent = 'Checking login...'
    const user = await ensureAuth()
    if(!user) return
    statusMsg.textContent = `Signed in as ${user.username}#${user.discriminator}`

    try{
      const fetchList = async (phase, status) => {
        const resp = await fetch(`${AUTH_SERVER}/api/exams?phase=${encodeURIComponent(phase)}&status=${encodeURIComponent(status)}`, { credentials: 'include' })
        if(!resp.ok) return []
        const data = await resp.json()
        return Array.isArray(data) ? data : []
      }

      const [phase1Pending, phase1Awaiting, phase4Pending, phase4Awaiting] = await Promise.all([
        fetchList(1, 'pending'),
        fetchList(1, 'awaiting_review'),
        fetchList(4, 'pending'),
        fetchList(4, 'awaiting_review')
      ])

      renderList(phase1List, mergeUniqueLists([phase1Pending, phase1Awaiting]))
      renderList(phase4List, mergeUniqueLists([phase4Pending, phase4Awaiting]))
    }catch(e){ console.error(e); statusMsg.textContent='Failed to load exams' }
  }

  document.addEventListener('DOMContentLoaded', load)
})();
