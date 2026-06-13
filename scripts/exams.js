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
      a.textContent = `${it.id} — ${it.candidate_mention || it.candidate || 'unknown'} (${it.created_at || ''})`
      li.appendChild(a)
      ul.appendChild(li)
    })
    container.appendChild(ul)
  }

  async function load(){
    statusMsg.textContent = 'Checking login...'
    const user = await ensureAuth()
    if(!user) return
    statusMsg.textContent = `Signed in as ${user.username}#${user.discriminator}`

    try{
      const p1 = fetch(`${AUTH_SERVER}/api/exams?phase=1&status=pending`,{credentials:'include'}).then(r=>r.json())
      const p4 = fetch(`${AUTH_SERVER}/api/exams?phase=4&status=pending`,{credentials:'include'}).then(r=>r.json())
      const [list1, list4] = await Promise.all([p1,p4])
      renderList(phase1List, list1 || [])
      renderList(phase4List, list4 || [])
    }catch(e){ console.error(e); statusMsg.textContent='Failed to load exams' }
  }

  document.addEventListener('DOMContentLoaded', load)
})();
