(function(){
  const cards = document.getElementById('dashboardCards')
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const STORAGE_KEYS = {
    exams: 'agentos.dashboard.seen.exams',
    aos: 'agentos.dashboard.seen.aos'
  }

  if(!cards) return

  function readSeenAt(key){
    try{
      const raw = localStorage.getItem(key)
      const value = raw ? Number(raw) : 0
      return Number.isFinite(value) ? value : 0
    }catch(_){
      return 0
    }
  }

  function writeSeenAt(key, value){
    try{
      localStorage.setItem(key, String(value || Date.now()))
    }catch(_){
      /* ignore storage failures */
    }
  }

  function toTime(value){
    if(!value) return 0
    const text = String(value)
    if(/^\d{16,22}$/.test(text)){
      return Number((BigInt(text) >> 22n) + 1420070400000n)
    }
    const parsed = new Date(text)
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
  }

  function latestTime(items, extractor){
    return (Array.isArray(items) ? items : []).reduce((max, item)=>Math.max(max, toTime(extractor(item))), 0)
  }

  function setCards(content){
    cards.innerHTML = content
  }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function renderCards(examCard, aosCard){
    setCards(`
    <a class="dashboard-card dashboard-card--selector" href="exams.html">
      <div class="dashboard-card__top">
        <span class="dashboard-card__badge ${examCard.unread ? 'dashboard-card__badge--new' : 'dashboard-card__badge--current'}">${examCard.unread ? 'NEW' : 'CURRENT'}</span>
        <span class="dashboard-card__link">Open</span>
      </div>
      <h3>Exam Dashboard</h3>
      <p>${escapeHtml(examCard.summary)}</p>
      <div class="dashboard-card__details">
        <div class="dashboard-card__detail"><strong>Active</strong><span>${escapeHtml(examCard.activeCount)} exam${examCard.activeCount === 1 ? '' : 's'}</span></div>
        <div class="dashboard-card__detail"><strong>Latest update</strong><span>${escapeHtml(examCard.latestLabel)}</span></div>
      </div>
    </a>
    <a class="dashboard-card dashboard-card--selector" href="aos-dashboard.html">
      <div class="dashboard-card__top">
        <span class="dashboard-card__badge ${aosCard.unread ? 'dashboard-card__badge--new' : 'dashboard-card__badge--current'}">${aosCard.unread ? 'NEW' : 'CURRENT'}</span>
        <span class="dashboard-card__link">Open</span>
      </div>
      <h3>AOS Dashboard</h3>
      <p>${escapeHtml(aosCard.summary)}</p>
      <div class="dashboard-card__details">
        <div class="dashboard-card__detail"><strong>Active</strong><span>${escapeHtml(aosCard.activeCount)} person${aosCard.activeCount === 1 ? '' : 's'}</span></div>
        <div class="dashboard-card__detail"><strong>Latest update</strong><span>${escapeHtml(aosCard.latestLabel)}</span></div>
      </div>
    </a>
  `)
  }

  async function loadCardData(){
    const examSeenAt = readSeenAt(STORAGE_KEYS.exams)
    const aosSeenAt = readSeenAt(STORAGE_KEYS.aos)

    const [examResp, aosResp] = await Promise.allSettled([
      fetch(`${AUTH_SERVER}/api/exams?status=active`, { credentials: 'include' }),
      fetch(`${AUTH_SERVER}/api/aos/active`, { credentials: 'include' })
    ])

    let exams = []
    if(examResp.status === 'fulfilled' && examResp.value.ok){
      try{
        const examData = await examResp.value.json()
        exams = Array.isArray(examData) ? examData : []
      }catch(_){ exams = [] }
    }

    let aos = []
    if(aosResp.status === 'fulfilled' && aosResp.value.ok){
      try{
        const aosData = await aosResp.value.json()
        aos = Array.isArray(aosData) ? aosData : []
      }catch(_){ aos = [] }
    }

    const activeExams = exams.filter(item => String(item && item.status || '').toLowerCase() === 'active')
    const activeAos = aos.filter(item => item && item.username)

    const examLatest = latestTime(activeExams, item => item.created_at || item.createdAt || item.updated_at || item.updatedAt)
    const aosLatest = latestTime(activeAos, item => item.activatedAt || item.createdAt || item.lastSeenAt)

    const examCard = {
      unread: examLatest > examSeenAt,
      activeCount: activeExams.length,
      latestLabel: examLatest ? new Date(examLatest).toLocaleString() : 'No active exams',
      summary: activeExams.length ? 'Review active exams and continue the existing workflow.' : 'No active exams are waiting right now.'
    }

    const aosCard = {
      unread: aosLatest > aosSeenAt,
      activeCount: activeAos.length,
      latestLabel: aosLatest ? new Date(aosLatest).toLocaleString() : 'No active warrants',
      summary: activeAos.length ? 'Browse active arrest-on-sight warrants by person.' : 'No active warrants are waiting right now.'
    }

    renderCards(examCard, aosCard)
  }

  setCards(`
    <a class="dashboard-card dashboard-card--selector" href="exams.html">
      <div class="dashboard-card__top"><span class="dashboard-card__badge">CURRENT</span><span class="dashboard-card__link">Open</span></div>
      <h3>Exam Dashboard</h3>
      <p>Review active exams and continue the existing workflow.</p>
      <div class="dashboard-card__details"><div class="dashboard-card__detail"><strong>Active</strong><span>Loading...</span></div><div class="dashboard-card__detail"><strong>Latest update</strong><span>Loading...</span></div></div>
    </a>
    <a class="dashboard-card dashboard-card--selector" href="aos-dashboard.html">
      <div class="dashboard-card__top"><span class="dashboard-card__badge">CURRENT</span><span class="dashboard-card__link">Open</span></div>
      <h3>AOS Dashboard</h3>
      <p>Browse active arrest-on-sight warrants by person.</p>
      <div class="dashboard-card__details"><div class="dashboard-card__detail"><strong>Active</strong><span>Loading...</span></div><div class="dashboard-card__detail"><strong>Latest update</strong><span>Loading...</span></div></div>
    </a>
  `)

  loadCardData().catch(()=>{
    renderCards(
      { unread: false, activeCount: 0, latestLabel: 'Unavailable', summary: 'Review active exams and continue the existing workflow.' },
      { unread: false, activeCount: 0, latestLabel: 'Unavailable', summary: 'Browse active arrest-on-sight warrants by person.' }
    )
  })
})()