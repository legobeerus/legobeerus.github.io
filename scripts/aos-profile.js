(function(){
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const statusMsg = document.getElementById('statusMsg')
  const profileAvatar = document.getElementById('aosProfileAvatar')
  const profileName = document.getElementById('aosProfileName')
  const profileHandle = document.getElementById('aosProfileHandle')
  const profileBio = document.getElementById('aosProfileBio')
  const profileRoles = document.getElementById('aosProfileFacts')
  const profileStats = document.getElementById('aosProfileStats')
  const chargeSummary = document.getElementById('aosChargeSummary')
  const warrantList = document.getElementById('aosWarrantsList')
  const STORAGE_KEY = 'agentos.dashboard.seen.aos'
  let canEditCharges = false
  let editModal = null
  let editModalUsernameInput = null
  let editModalChargesInput = null
  let editModalJailInput = null
  let editModalSaveButton = null
  let editModalTitle = null
  let editingWarrant = null
  let editingMe = null

  function U(){
    return window.AOS_UTILS || {}
  }

  function usernameFromQuery(){
    return new URLSearchParams(window.location.search).get('username') || ''
  }

  function onReady(fn){
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', fn, { once: true })
    }else{
      fn()
    }
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

  function chargeChip(detail){
    const utils = U()
    const escapeHtml = utils.escapeHtml || (input => String(input == null ? '' : input))
    const quantity = Number.isFinite(detail && detail.count) ? Math.max(1, Math.floor(detail.count)) : 1
    const qtyLabel = quantity > 1 ? `${escapeHtml(quantity)}x ` : ''
    return `<span class="aos-charge-chip"><strong>${qtyLabel}[${escapeHtml(detail.code)}]</strong> ${escapeHtml(detail.name)}</span>`
  }

  function chargeSummaryInline(chargesText){
    const utils = U()
    const details = utils.summarizeCharges ? utils.summarizeCharges(chargesText) : []
    if(details.length){
      return `<div class="aos-charge-inline">${details.map(chargeChip).join('')}</div>`
    }
    const fallback = String(chargesText || '').trim()
    if(!fallback) return '<span>Unknown</span>'
    return `<span>${(utils.escapeHtml ? utils.escapeHtml(fallback) : fallback)}</span>`
  }

  function renderCombinedCharges(warrants){
    if(!chargeSummary) return
    const utils = U()
    const counts = utils.combinedChargeCounts ? utils.combinedChargeCounts(warrants) : []
    if(!counts.length){
      chargeSummary.innerHTML = `
        <h3>Combined charges</h3>
        <p class="profile-empty">No parseable charge codes were found on active warrants.</p>
      `
      return
    }

    const escapeHtml = utils.escapeHtml || (input => String(input == null ? '' : input))
    chargeSummary.innerHTML = `
      <h3>Combined charges</h3>
      <div class="aos-charge-totals">
        ${counts.map(item => `
          <div class="aos-charge-total-row">
            <span>${escapeHtml(item.count)}x [${escapeHtml(item.code)}]</span>
            <strong>${escapeHtml(item.name)}</strong>
          </div>
        `).join('')}
      </div>
    `
  }

  function closeEditModal(){
    if(!editModal) return
    editModal.hidden = true
    document.body.classList.remove('aos-modal-open')
    editingWarrant = null
  }

  function ensureEditModal(){
    if(editModal) return

    editModal = document.createElement('div')
    editModal.className = 'aos-edit-modal'
    editModal.hidden = true
    editModal.innerHTML = `
      <div class="aos-edit-modal__backdrop" data-edit-modal-close></div>
      <div class="aos-edit-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="aosEditModalTitle">
        <h3 id="aosEditModalTitle">Edit Warrant</h3>
        <label>
          Username
          <input type="text" data-modal-edit-username autocomplete="off" />
        </label>
        <label>
          Charges
          <input type="text" data-modal-edit-charges autocomplete="off" />
        </label>
        <label>
          Jail time (minutes)
          <input type="text" data-modal-edit-jail autocomplete="off" />
        </label>
        <div class="aos-edit-modal__actions">
          <button type="button" class="btn btn-primary" data-modal-save-edit>Save</button>
          <button type="button" class="btn btn-ghost" data-edit-modal-close>Cancel</button>
        </div>
      </div>
    `

    document.body.appendChild(editModal)

  editModalUsernameInput = editModal.querySelector('[data-modal-edit-username]')
    editModalChargesInput = editModal.querySelector('[data-modal-edit-charges]')
    editModalJailInput = editModal.querySelector('[data-modal-edit-jail]')
    editModalSaveButton = editModal.querySelector('[data-modal-save-edit]')
    editModalTitle = editModal.querySelector('#aosEditModalTitle')

    editModal.addEventListener('click', event => {
      const closeTarget = event.target && event.target.closest ? event.target.closest('[data-edit-modal-close]') : null
      if(closeTarget){
        closeEditModal()
      }
    })

    editModalSaveButton.addEventListener('click', async () => {
      if(!editingWarrant) return
      const result = await saveEditedWarrant(
        editingWarrant.threadId,
        editModalUsernameInput ? editModalUsernameInput.value : '',
        editModalChargesInput ? editModalChargesInput.value : '',
        editModalJailInput ? editModalJailInput.value : ''
      )
      if(result && result.ok){
        closeEditModal()
        if(editingMe){
          statusMsg.textContent = `Signed in as ${editingMe.username}#${editingMe.discriminator}. Changes saved.`
        }
        if(result.usernameChanged && result.newUsername){
          window.location.href = `aos-profile.html?username=${encodeURIComponent(result.newUsername)}`
          return
        }
        await loadProfile()
      }
    })

    document.addEventListener('keydown', event => {
      if(event.key === 'Escape' && editModal && !editModal.hidden){
        closeEditModal()
      }
    })
  }

  function openEditModal(warrant, me){
    ensureEditModal()
    editingWarrant = warrant
    editingMe = me

    if(editModalTitle){
      editModalTitle.textContent = `Edit Warrant - ${String(warrant.username || 'Unknown').trim() || 'Unknown'}`
    }
    if(editModalUsernameInput){
      editModalUsernameInput.value = String(warrant.username || '')
    }
    if(editModalChargesInput){
      editModalChargesInput.value = String(warrant.charges || '')
    }
    if(editModalJailInput){
      editModalJailInput.value = String(Number(warrant.jailMinutes || warrant.calculatedTimeMinutes || 0) || 0)
    }

    editModal.hidden = false
    document.body.classList.add('aos-modal-open')
    if(editModalUsernameInput) editModalUsernameInput.focus()
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
    const tagClass = utils.tagClass || (() => 'aos-tag--neutral')
    return `
      <div class="aos-tag-list">
        ${tags.map(tag => `<span class="aos-tag ${tagClass(tag)}">${utils.tagLabel ? utils.tagLabel(tag) : tag}</span>`).join('')}
      </div>
    `
  }

  async function loadEditAccess(){
    try{
      const resp = await fetch(`${AUTH_SERVER}/api/aos/edit-access`, { credentials: 'include' })
      if(!resp.ok) return false
      const data = await resp.json()
      return Boolean(data && data.allowed)
    }catch(_){
      return false
    }
  }

  async function loadWarrantsForUsername(username){
    const personResp = await fetch(`${AUTH_SERVER}/api/aos/person/${encodeURIComponent(username)}`, { credentials: 'include' })
    if(personResp.ok){
      const data = await personResp.json()
      return Array.isArray(data) ? data : []
    }

    const fallbackResp = await fetch(`${AUTH_SERVER}/api/aos/active`, { credentials: 'include' })
    if(!fallbackResp.ok) throw new Error(`aos fetch failed (${fallbackResp.status})`)
    const fallbackData = await fallbackResp.json()
    const normalized = (Array.isArray(fallbackData) ? fallbackData : []).map(item => (U().normalizeWarrant ? U().normalizeWarrant(item) : item))
    return normalized.filter(item => String(item.username || '').toLowerCase() === username.toLowerCase())
  }

  async function loadAllWarrants(){
    const resp = await fetch(`${AUTH_SERVER}/api/aos/active`, { credentials: 'include' })
    if(!resp.ok) throw new Error(`aos fetch failed (${resp.status})`)
    const data = await resp.json()
    return (Array.isArray(data) ? data : []).map(item => (U().normalizeWarrant ? U().normalizeWarrant(item) : item))
  }

  function cardHtml(warrant){
    const utils = U()
    const dateLabel = utils.formatDate ? utils.formatDate(warrant.activatedAt || warrant.createdAt) : (warrant.activatedAt || warrant.createdAt || '')
    const lastSeen = utils.formatDate ? utils.formatDate(warrant.lastSeenAt) : warrant.lastSeenAt
    const deleteButton = warrant.postedByBot === false
      ? `<button type="button" class="is-danger" data-delete-thread="${utils.escapeHtml ? utils.escapeHtml(warrant.threadId) : warrant.threadId}">Delete warrant</button>`
      : ''
    const escapedThread = utils.escapeHtml ? utils.escapeHtml(warrant.threadId || '') : (warrant.threadId || '')
    const editableControls = canEditCharges
      ? `
          <button type="button" data-open-edit="${escapedThread}">Edit Warrant</button>
        `
      : ''
    return `
      <article class="dashboard-card aos-warrant-card">
        <div class="dashboard-card__top">
          <span class="dashboard-card__badge">Warrant</span>
          <span class="dashboard-card__link">${utils.escapeHtml ? utils.escapeHtml(warrant.threadId || 'Warrant') : (warrant.threadId || 'Warrant')}</span>
        </div>
        <h3 class="aos-warrant-card__title">${utils.escapeHtml ? utils.escapeHtml(warrant.threadName || warrant.username || 'AOS warrant') : (warrant.threadName || warrant.username || 'AOS warrant')}</h3>
        <p class="aos-warrant-card__subtitle">${utils.escapeHtml ? utils.escapeHtml(warrant.summary || warrant.charges || 'No summary available.') : (warrant.summary || warrant.charges || 'No summary available.')}</p>
        <div class="aos-warrant-card__meta">
          <div class="aos-warrant-card__row aos-warrant-card__row--charges"><strong>Charges</strong>${chargeSummaryInline(warrant.charges)}</div>
          <div class="aos-warrant-card__row"><strong>Victims</strong><span>${utils.escapeHtml ? utils.escapeHtml(warrant.victims || 'Unknown') : (warrant.victims || 'Unknown')}</span></div>
          <div class="aos-warrant-card__row"><strong>Jail time</strong><span>${Number(warrant.jailMinutes || warrant.calculatedTimeMinutes || 0) || 0} minutes</span></div>
          <div class="aos-warrant-card__row"><strong>Created</strong><span>${dateLabel || 'Unknown'}</span></div>
        </div>
        ${renderTags(warrant.tags)}
        <div class="aos-warrant-card__links">
          ${warrant.url ? `<a href="${utils.escapeHtml ? utils.escapeHtml(warrant.url) : warrant.url}" target="_blank" rel="noreferrer">Open thread</a>` : ''}
          ${warrant.profile ? `<a href="${utils.escapeHtml ? utils.escapeHtml(warrant.profile) : warrant.profile}" target="_blank" rel="noreferrer">Open profile</a>` : ''}
          ${warrant.proof ? `<a href="${utils.escapeHtml ? utils.escapeHtml(warrant.proof) : warrant.proof}" target="_blank" rel="noreferrer">View proof</a>` : ''}
          ${editableControls}
          ${deleteButton}
        </div>
      </article>
    `
  }

  async function saveEditedWarrant(threadId, usernameValue, chargesValue, jailValue){
    const username = String(usernameValue || '').trim()
    if(!username){
      statusMsg.textContent = 'Edit failed: username cannot be empty.'
      return { ok: false }
    }

    const jailMinutes = Number(String(jailValue || '').trim())
    if(!Number.isFinite(jailMinutes) || jailMinutes < 0){
      statusMsg.textContent = 'Edit failed: jail time must be a non-negative number of minutes.'
      return { ok: false }
    }
    const charges = String(chargesValue || '').trim()
    if(!charges){
      statusMsg.textContent = 'Edit failed: charges cannot be empty.'
      return { ok: false }
    }

    try{
      const resp = await fetch(`${AUTH_SERVER}/api/aos/${encodeURIComponent(threadId)}/charges`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, charges, jailMinutes })
      })
      if(resp.status === 401 || resp.status === 403){
        statusMsg.textContent = 'Edit failed: you are not authorized to edit warrants.'
        return { ok: false }
      }
      if(!resp.ok){
        statusMsg.textContent = `Edit failed (${resp.status}).`
        return { ok: false }
      }
      const data = await resp.json().catch(() => ({}))
      const updatedUsername = String(data && data.warrant && data.warrant.username || '').trim()
      const previousUsername = String(editingWarrant && editingWarrant.username || '').trim()
      return {
        ok: true,
        newUsername: updatedUsername || username,
        usernameChanged: Boolean((updatedUsername || username) && previousUsername && (updatedUsername || username).toLowerCase() !== previousUsername.toLowerCase())
      }
    }catch(err){
      console.error(err)
      statusMsg.textContent = 'Edit failed due to a network or server error.'
      return { ok: false }
    }
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
      if(chargeSummary) chargeSummary.innerHTML = ''
      closeEditModal()
      renderEmpty('No warrant profile selected.')
      return
    }

    statusMsg.textContent = 'Checking login...'
    const me = await ensureAuth()
    if(!me) return
    if(U().ensureChargeCatalogLoaded){
      await U().ensureChargeCatalogLoaded()
    }
    canEditCharges = await loadEditAccess()

    statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}. Loading warrant profile...`

    try{
      const [allWarrants, personWarrants] = await Promise.all([
        loadAllWarrants(),
        loadWarrantsForUsername(targetUsername)
      ])

      const warrants = (personWarrants.length ? personWarrants : allWarrants.filter(item => String(item.username || '').toLowerCase() === targetUsername.toLowerCase()))
        .sort((a, b) => {
          const aTime = new Date(a.activatedAt || a.createdAt || 0).getTime()
          const bTime = new Date(b.activatedAt || b.createdAt || 0).getTime()
          return bTime - aTime
        })

      if(!warrants.length){
        profileName.textContent = targetUsername
        profileHandle.textContent = ''
        profileBio.textContent = ''
        renderFacts([`Username: ${targetUsername}`, 'Warrants: 0'])
        profileStats.innerHTML = ''
        if(chargeSummary) chargeSummary.innerHTML = ''
        closeEditModal()
        renderEmpty('No active warrants found for this person.')
        statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}.`
        return
      }

      const latest = warrants[0]
      const totalJail = warrants.reduce((sum, item) => sum + (Number(item.jailMinutes || item.calculatedTimeMinutes || 0) || 0), 0)
      const knownProfile = warrants.find(item => item.profile) || null

      profileAvatar.src = 'media/logo.png'
      profileAvatar.alt = `${targetUsername} profile icon`
      profileName.textContent = targetUsername
      profileHandle.textContent = ''
      profileBio.textContent = ''

      renderFacts([
        `Username: ${targetUsername}`,
        `Warrants: ${warrants.length}`
      ])

      profileStats.innerHTML = ''
      profileStats.appendChild(statCard('Warrants', warrants.length))
      profileStats.appendChild(statCard('Total jail time', `${totalJail} minutes`))
      profileStats.appendChild(statCard('Latest thread', latest.threadName || latest.threadId || 'Unknown'))
      renderCombinedCharges(warrants)

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
        const editButton = card && card.querySelector('[data-open-edit]')
        if(editButton){
          editButton.addEventListener('click', () => openEditModal(warrant, me))
        }
        grid.appendChild(card)
      })

      warrantList.appendChild(grid)
      statusMsg.textContent = `Signed in as ${me.username}#${me.discriminator}.`
      writeSeenAt(new Date(latest.activatedAt || latest.createdAt || Date.now()).getTime())
    }catch(err){
      console.error(err)
      statusMsg.textContent = 'Failed to load AOS profile'
      profileName.textContent = targetUsername
      profileHandle.textContent = ''
      profileBio.textContent = ''
      renderFacts([`Username: ${targetUsername}`])
      profileStats.innerHTML = ''
      if(chargeSummary) chargeSummary.innerHTML = ''
      closeEditModal()
      renderEmpty('Failed to load warrant profile.')
    }
  }

  onReady(loadProfile)
})()