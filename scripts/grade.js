(function(){
  function byId(id){return document.getElementById(id)}
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const params = new URLSearchParams(location.search)
  const sessionId = params.get('session') || ''
  const archiveModeRequested = String(params.get('view') || '').toLowerCase() === 'archive'
  const reviewerEl = byId('reviewer')
  const sessionLabel = byId('sessionLabel')
  const questionsEl = byId('questions')
  const form = byId('gradeForm')
  const gradingPageEl = document.querySelector('.grading-page')
  const previewBtn = byId('previewBtn')
  const previewArea = byId('previewArea')
  const previewText = byId('previewText')
  const resultEl = byId('result')
  const submitBtn = form.querySelector('[type=submit]')
  let currentUser = null
  const PASS_PERCENT = 75
  const LOCK_HEARTBEAT_MS = 30000
  const DRAFT_SAVE_DEBOUNCE_MS = 180
  let lockHeartbeatTimer = null
  let lockOwnedByMe = false
  let sectionCounter = 0
  let isArchiveMode = archiveModeRequested
  const draftKey = sessionId ? `grade:draft:${sessionId}` : ''
  let draftSaveTimer = null
  let tocScrollCleanup = null

  function loadDraft(){
    if(!draftKey || isArchiveMode) return null
    try{
      const raw = localStorage.getItem(draftKey)
      if(!raw) return null
      const parsed = JSON.parse(raw)
      if(!parsed || typeof parsed !== 'object') return null
      return parsed
    }catch(_){ return null }
  }

  function saveDraftNow(){
    if(!draftKey || isArchiveMode || !exam) return
    try{
      const manualScores = {}
      questionsEl.querySelectorAll('input[name=score]').forEach(input=>{
        manualScores[input.dataset.index] = input.value
      })
      const payload = {
        feedback: byId('feedback') ? byId('feedback').value : '',
        manualScores,
        scrollY: Math.max(0, Math.round(window.scrollY || 0)),
        updatedAt: Date.now()
      }
      localStorage.setItem(draftKey, JSON.stringify(payload))
    }catch(_){ /* ignore localStorage failures */ }
  }

  function scheduleDraftSave(){
    if(!draftKey || isArchiveMode) return
    if(draftSaveTimer) clearTimeout(draftSaveTimer)
    draftSaveTimer = setTimeout(()=>{
      draftSaveTimer = null
      saveDraftNow()
    }, DRAFT_SAVE_DEBOUNCE_MS)
  }

  function clearDraft(){
    if(!draftKey) return
    try{ localStorage.removeItem(draftKey) }catch(_){ /* ignore */ }
  }

  function restoreScrollFast(scrollY){
    const y = Number(scrollY)
    if(!Number.isFinite(y) || y <= 0) return
    const jump = ()=> window.scrollTo(0, y)
    jump()
    requestAnimationFrame(jump)
    setTimeout(jump, 80)
    setTimeout(jump, 260)
  }

  function restoreDraftState(){
    const draft = loadDraft()
    if(!draft) return false
    const feedback = byId('feedback')
    if(feedback && typeof draft.feedback === 'string') feedback.value = draft.feedback
    if(draft.manualScores && typeof draft.manualScores === 'object'){
      Object.keys(draft.manualScores).forEach(index=>{
        const input = questionsEl.querySelector(`input[name=score][data-index="${index}"]`)
        if(!input) return
        input.value = draft.manualScores[index]
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    restoreScrollFast(draft.scrollY)
    return true
  }

  function getNavOffset(){
    const nav = document.querySelector('.nav')
    return (nav && nav.offsetHeight ? nav.offsetHeight : 72) + 20
  }

  function fastScrollToY(targetY){
    const startY = window.scrollY || 0
    const endY = Math.max(0, Number(targetY) || 0)
    const distance = endY - startY
    if(Math.abs(distance) < 4){
      window.scrollTo(0, endY)
      return
    }
    const duration = 180
    const startTime = performance.now()
    const easeOut = value => 1 - Math.pow(1 - value, 3)

    function tick(now){
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / duration)
      window.scrollTo(0, Math.round(startY + (distance * easeOut(progress))))
      if(progress < 1) requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  }

  function removeSectionsToc(){
    if(tocScrollCleanup){
      tocScrollCleanup()
      tocScrollCleanup = null
    }
    const toc = byId('sectionsToc')
    if(toc) toc.remove()
    if(gradingPageEl) gradingPageEl.classList.remove('grading-page--with-toc')
  }

  function renderSectionsToc(sections){
    removeSectionsToc()
    if(!gradingPageEl || !sections || sections.length < 2) return

    const toc = document.createElement('aside')
    toc.id = 'sectionsToc'
    toc.className = 'grade-sections-toc'

    const title = document.createElement('div')
    title.className = 'grade-sections-toc__title'
    title.textContent = 'Sections'
    toc.appendChild(title)

    const list = document.createElement('div')
    list.className = 'grade-sections-toc__list'

    function setActiveSection(activeId){
      list.querySelectorAll('.grade-sections-toc__item').forEach(item=>{
        item.classList.toggle('is-active', item.dataset.sectionId === activeId)
      })
    }

    function syncActiveSection(){
      const markerY = window.scrollY + getNavOffset() + 40
      let active = sections[0]
      sections.forEach(section=>{
        const target = document.getElementById(section.id)
        if(!target) return
        const top = window.scrollY + target.getBoundingClientRect().top
        if(top <= markerY) active = section
      })
      if(active) setActiveSection(active.id)
    }

    sections.forEach((section, index)=>{
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'grade-sections-toc__item'
      btn.dataset.sectionId = section.id
      if(index === 0) btn.classList.add('is-active')
      btn.textContent = section.title
      btn.addEventListener('click', ()=>{
        setActiveSection(section.id)
        const target = document.getElementById(section.id)
        if(!target) return
        const targetY = window.scrollY + target.getBoundingClientRect().top - getNavOffset()
        fastScrollToY(targetY)
        btn.blur()
      })
      list.appendChild(btn)
    })

    toc.appendChild(list)
    gradingPageEl.appendChild(toc)
    gradingPageEl.classList.add('grading-page--with-toc')

    let ticking = false
    const onScroll = ()=>{
      if(ticking) return
      ticking = true
      requestAnimationFrame(()=>{
        ticking = false
        syncActiveSection()
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    tocScrollCleanup = ()=>{
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
    syncActiveSection()
  }

  sessionLabel.textContent = sessionId ? `Session: ${sessionId}` : 'No session specified.'

  if(!sessionId){ document.getElementById('sessionNotFound').style.display='block' }

  let exam = null

  function isMultipleChoiceKind(kind){
    const text = String(kind || '').toLowerCase().trim()
    return text === 'multiplechoice' || text === 'multiple-choice' || text === 'mc'
  }

  function isSelectionKind(kind){
    const text = String(kind || '').toLowerCase().trim()
    return text === 'selection' || text === 'multiselect' || text === 'multi-select' || text === 'select'
  }

  function isSectionKind(kind){
    const text = String(kind || '').toLowerCase().trim()
    return text === 'section'
  }

  function parseChoiceToken(value){
    const text = String(value || '').trim()
    if(!text) return ''
    return String(text.split(/\)|\.|\s/)[0] || '').trim().toLowerCase()
  }

  function normalizeSelectionSet(raw){
    if(raw == null) return new Set()
    if(Array.isArray(raw)){
      return new Set(raw.map(item=>parseChoiceToken(item)).filter(Boolean))
    }

    const text = String(raw).trim()
    if(!text) return new Set()

    // Accept formats like "A,C", "A C", "A|C", "A/C", "[A, C]", and "AC".
    const splitParts = text
      .replace(/[\[\](){}]/g, ' ')
      .split(/[\s,;|/]+/)
      .map(part=>part.trim())
      .filter(Boolean)

    if(splitParts.length > 1){
      return new Set(splitParts.map(part=>parseChoiceToken(part)).filter(Boolean))
    }

    if(/^[A-Za-z]{2,}$/.test(text)){
      return new Set(text.toLowerCase().split('').map(part=>part.trim()).filter(Boolean))
    }

    const token = parseChoiceToken(text)
    return token ? new Set([token]) : new Set()
  }

  function setsEqual(a, b){
    if(a.size !== b.size) return false
    for(const value of a){
      if(!b.has(value)) return false
    }
    return true
  }

  function renderExam(data){
    exam = data
    isArchiveMode = archiveModeRequested
    const savedReview = data && data.review && typeof data.review === 'object' ? data.review : null
    const savedGrades = savedReview && Array.isArray(savedReview.grades) ? savedReview.grades : null
    const savedFeedback = savedReview && savedReview.feedback != null ? String(savedReview.feedback) : ''
    let archivedGradeCursor = 0

    if(isArchiveMode){
      reviewerEl.textContent = 'Archive view (read-only)'
    }

    if(currentUser){
      const tag = currentUser.discriminator ? `#${currentUser.discriminator}` : ''
      if(!isArchiveMode) reviewerEl.textContent = `${currentUser.username || 'Reviewer'}${tag}`
    } else if(data.reviewer){
      if(!isArchiveMode) reviewerEl.textContent = `${data.reviewer.username}#${data.reviewer.discriminator}`
    } else {
      if(!isArchiveMode) reviewerEl.textContent = ''
    }
    const candidate = data.candidateMention || data.candidate_name || data.userId || (data.user && data.user.username) || 'unknown'
    sessionLabel.textContent = `Session: ${data.examId || data.id || sessionId} — Candidate: ${candidate}`

    const answersByIndex = new Map((data.answers || []).map(a => [a.index, a.answer]))
    exam.answersByIndex = answersByIndex
    const totalPossible = (data.questions || []).reduce((sum, q)=>{
      if(isSectionKind(q && q.type)) return sum
      return sum + (Number(q && q.maxScore != null ? q.maxScore : 1) || 1)
    }, 0)
    exam.maxScore = totalPossible
    byId('totalPossible').textContent = `Total possible: ${totalPossible}`

    if(!data.questions || data.questions.length===0){
      questionsEl.innerHTML = '<p>No questions found for this session.</p>'
      return
    }

    questionsEl.innerHTML = ''
    sectionCounter = 0
    const sections = []
    data.questions.forEach((q, idx)=>{
      const kind = String(q && q.type || '').toLowerCase().trim()
      const isSection = isSectionKind(kind)

      if(isSection){
        sectionCounter += 1
        const divider = document.createElement('div')
        divider.className = 'exam-section-divider'
        const sectionTitle = q.title || q.sectionTitle || q.section_title || q.sectionName || q.section_name || `Section ${sectionCounter}`
        const sectionId = `exam-section-${sectionCounter}`
        divider.id = sectionId
        divider.innerHTML = `<span>${escapeHtml(sectionTitle)}</span>`
        questionsEl.appendChild(divider)
        sections.push({ id: sectionId, title: sectionTitle })
        q._isSection = true
        q._autoScore = 0
        return
      }

      const maxScore = Number(q.maxScore ?? 1) || 1
      const isMC = isMultipleChoiceKind(kind)
      const isSelection = isSelectionKind(kind)
      const isAuto = isMC || isSelection
      const isText = kind === '' || kind === 'text'
      const hasArchivedScore = savedGrades && archivedGradeCursor < savedGrades.length
      const archivedScore = hasArchivedScore ? Number(savedGrades[archivedGradeCursor]) : null
      const archivedScoreSafe = Number.isFinite(archivedScore) ? archivedScore : 0
      archivedGradeCursor += 1
      const answerValue = answersByIndex.get(idx) ?? ''
      const answerNormalized = String(answerValue || '').trim()
      const correctAnswerRaw = q.correctAnswer || q.correct_answer || ''
      const correctNormalized = String(correctAnswerRaw || '').trim()
      const selectionAnswerSet = isSelection ? normalizeSelectionSet(answerValue) : new Set()
      const selectionCorrectSet = isSelection ? normalizeSelectionSet(correctAnswerRaw) : new Set()
      const div = document.createElement('div')
      div.className = 'question'

      let scoreInput = ''
      if(isText){
        const value = isArchiveMode ? archivedScoreSafe : 0
        const disabledAttr = isArchiveMode ? ' disabled' : ''
        scoreInput = `<label>Score: <input type="number" min="0" max="${maxScore}" step="1" name="score" data-index="${idx}" value="${value}"${disabledAttr}></label>`
      }

      let choicesHtml = ''
      if(isAuto && Array.isArray(q.choices)){
        choicesHtml = `<div class="choices"><strong>Choices:</strong><ul>`
        q.choices.forEach(choice=>{
          const rawChoice = typeof choice === 'string' ? choice : choice.value ?? choice.label ?? choice.text ?? ''
          const label = typeof choice === 'string' ? choice : choice.label || choice.text || choice.value || ''
          const choiceNormalized = String(rawChoice || '').trim()
          const choiceKey = parseChoiceToken(choiceNormalized)
          let isSelected = false
          let isCorrect = false
          if(isSelection){
            isSelected = selectionAnswerSet.has(choiceKey)
            isCorrect = selectionCorrectSet.has(choiceKey)
          }else{
            isSelected = answerNormalized !== '' && (answerNormalized === choiceNormalized || answerNormalized.toLowerCase() === choiceKey)
            isCorrect = correctNormalized !== '' && (choiceNormalized === correctNormalized || correctNormalized.toLowerCase() === choiceKey)
          }
          const icon = isSelected ? (isCorrect ? '✅' : '❌') : (isCorrect && isSelection ? '🟩' : '▫️')
          choicesHtml += `<li style="margin:4px 0">${icon} ${escapeHtml(label)}</li>`
        })
        choicesHtml += '</ul></div>'
      }

      const isCorrectAnswer = isSelection
        ? selectionCorrectSet.size > 0 && setsEqual(selectionAnswerSet, selectionCorrectSet)
        : isMC && answerNormalized !== '' && (answerNormalized === correctNormalized || answerNormalized === String(correctAnswerRaw).trim())
      const autoStatus = isAuto
        ? `<div class="mc-result">${isCorrectAnswer ? 'Correct' : 'Incorrect'} - ${isCorrectAnswer ? maxScore : 0} points</div>`
        : ''

      if(isAuto){
        div.classList.add('mc-question', isCorrectAnswer ? 'mc-correct' : 'mc-incorrect')
        q._autoScore = isArchiveMode && Number.isFinite(archivedScore) ? archivedScoreSafe : (isCorrectAnswer ? maxScore : 0)
      }

      const archivedAwarded = isArchiveMode && Number.isFinite(archivedScore)
        ? `<div class="answer"><strong>Awarded:</strong> ${archivedScoreSafe}/${maxScore}</div>`
        : ''

      div.innerHTML = `<div class="qmeta">Q${idx+1} (max ${maxScore})</div>
        <div class="prompt"><strong>Question:</strong> ${escapeHtml(q.text || q.prompt || q.question || '')}</div>
        <div class="answer"><strong>Answer:</strong> ${escapeHtml(answerValue)}</div>
        ${archivedAwarded}
        ${choicesHtml}
        ${autoStatus}
        ${scoreInput}`
      questionsEl.appendChild(div)
    })

    questionsEl.querySelectorAll('input[name=score]').forEach(input=>{
      const updateScoreState = ()=>{
        const q = exam.questions[Number(input.dataset.index)]
        const maxScore = Number((q && q.maxScore) ?? 0) || 0
        const value = Number(input.value)
        const overMax = !Number.isNaN(value) && value > maxScore
        input.classList.toggle('score-over-max', overMax)
        input.setAttribute('aria-invalid', overMax ? 'true' : 'false')
      }
      input.addEventListener('input', updateScoreState)
      input.addEventListener('input', scheduleDraftSave)
      updateScoreState()
    })

    const feedback = byId('feedback')
    if(feedback && !feedback.dataset.draftBound){
      feedback.addEventListener('input', scheduleDraftSave)
      feedback.dataset.draftBound = '1'
    }

    const restored = restoreDraftState()
    if(restored && !isArchiveMode){
      resultEl.textContent = 'Restored unsent draft from your last session.'
    }

    const feedbackEl = byId('feedback')
    if(feedbackEl && savedFeedback){
      feedbackEl.value = savedFeedback
    }

    renderSectionsToc(sections)

    hidePreview()
    if(isArchiveMode){
      setFormControlsEnabled(false)
      setInputsEnabled(false)
      resultEl.textContent = 'Archive mode: read-only view of stored graded answers.'
    }
  }

  function getPreviewState(){
    const scores = collectScores()
    if(!scores) return null
    const feedback = byId('feedback').value || ''
    const total = scores.reduce((a,b)=>a + (b == null ? 0 : b),0)
    const maxScore = Number(exam && exam.maxScore) || 0
    const percent = maxScore ? Math.round((total / maxScore) * 100) : 0
    const passed = percent >= PASS_PERCENT
    const label = exam && (exam.examId || exam.id || sessionId) ? String(exam.examId || exam.id || sessionId) : sessionId
    return { scores, feedback, total, maxScore, percent, passed, label }
  }

  function hidePreview(){
    previewArea.style.display = 'none'
    previewText.classList.remove('dm-preview-card--passed', 'dm-preview-card--failed')
    previewBtn.textContent = 'Preview DM'
    previewBtn.setAttribute('aria-expanded', 'false')
  }

  function showPreview(){
    const state = getPreviewState()
    if(!state) return
    const passedClass = state.passed ? 'dm-preview-card__passed' : 'dm-preview-card__failed'
    previewText.classList.remove('dm-preview-card--passed', 'dm-preview-card--failed')
    previewText.classList.add(state.passed ? 'dm-preview-card--passed' : 'dm-preview-card--failed')
    previewText.innerHTML = `
      <div class="dm-preview-card__title">Exam Results — ${escapeHtml(state.label)}</div>
      <div class="dm-preview-card__grid">
        <div>
          <div class="dm-preview-card__label">Score</div>
          <div class="dm-preview-card__value">${state.total}/${state.maxScore} (${state.percent}%)</div>
        </div>
        <div>
          <div class="dm-preview-card__label">Passed</div>
          <div class="dm-preview-card__value ${passedClass}">${state.passed ? 'Yes' : 'No'}</div>
        </div>
      </div>
      <div class="dm-preview-card__feedback">
        <div class="dm-preview-card__label">Feedback</div>
        <div class="dm-preview-card__value">${state.feedback ? escapeHtml(state.feedback) : 'No feedback provided.'}</div>
      </div>
    `
    previewArea.style.display = 'block'
    previewBtn.textContent = 'Hide DM Preview'
    previewBtn.setAttribute('aria-expanded', 'true')
  }

  function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c]) }
  function setFormControlsEnabled(enabled){
    previewBtn.disabled = !enabled
    if(submitBtn){
      submitBtn.disabled = !enabled
      if(enabled){
        submitBtn.classList.remove('disabled')
        previewBtn.classList.remove('disabled')
      } else {
        submitBtn.classList.add('disabled')
        previewBtn.classList.add('disabled')
      }
    }
  }

  function setInputsEnabled(enabled){
    const feedback = byId('feedback')
    if(feedback) feedback.disabled = !enabled
    questionsEl.querySelectorAll('input[name=score]').forEach(input=>{ input.disabled = !enabled })
  }

  function stopLockHeartbeat(){
    if(lockHeartbeatTimer){
      clearInterval(lockHeartbeatTimer)
      lockHeartbeatTimer = null
    }
  }

  async function sendLockAction(action){
    if(!sessionId) return null
    const resp = await fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action })
    })
    const text = await resp.text().catch(()=> '')
    let data = {}
    try{ data = text ? JSON.parse(text) : {} }catch(_){ data = { error: text } }
    return { ok: resp.ok, status: resp.status, data }
  }

  async function acquireOrRefreshLock(action){
    try{
      const lockResp = await sendLockAction(action)
      if(!lockResp) return
      if(lockResp.ok){
        lockOwnedByMe = true
        if(action === 'claim'){
          setFormControlsEnabled(true)
          setInputsEnabled(true)
        }
        return
      }
      if(lockResp.status === 409 && lockResp.data && lockResp.data.error === 'under_review'){
        lockOwnedByMe = false
        stopLockHeartbeat()
        setFormControlsEnabled(false)
        setInputsEnabled(false)
        const who = lockResp.data.reviewerName || 'another reviewer'
        resultEl.textContent = `This exam is currently under review by ${who}.`
      }
    }catch(e){
      console.error('Lock request failed', e)
    }
  }

  function startLockHeartbeat(){
    stopLockHeartbeat()
    lockHeartbeatTimer = setInterval(()=>{
      if(!lockOwnedByMe) return
      acquireOrRefreshLock('heartbeat')
    }, LOCK_HEARTBEAT_MS)
  }

  function releaseLockBestEffort(){
    if(!lockOwnedByMe || !sessionId) return
    fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'release' }),
      keepalive: true
    }).catch(()=>{})
  }
  async function fetchExam(){
    try{
      const resp = await fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}`, { credentials: 'include' })
      if(resp.status===404){ document.getElementById('sessionNotFound').style.display='block'; return }
      if(resp.status===401||resp.status===403){ location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname+location.search)}`; return }
      const data = await resp.json()
      renderExam(data)
      if(!isArchiveMode){
        await acquireOrRefreshLock('claim')
        if(lockOwnedByMe){
          startLockHeartbeat()
        }
      }
    }catch(e){ console.error(e); resultEl.textContent = 'Failed to load exam.' }
  }

  async function fetchCurrentUser(){
    try{
      const resp = await fetch(`${AUTH_SERVER}/api/me`, { credentials: 'include' })
      if(!resp.ok) return
      const data = await resp.json()
      if(data && data.id){
        currentUser = data
        if(reviewerEl){
          const tag = data.discriminator ? `#${data.discriminator}` : ''
          reviewerEl.textContent = `${data.username || 'Reviewer'}${tag}`
        }
      } else if(reviewerEl){
        reviewerEl.textContent = ''
      }
    }catch(_){
      if(reviewerEl) reviewerEl.textContent = ''
    }
  }

  previewBtn.addEventListener('click', ()=>{
    if(previewArea.style.display === 'block'){
      hidePreview()
      return
    }
    showPreview()
  })

  function collectScores(){
    if(!exam) return null
    return exam.questions
      .map((q, idx) => ({ q, idx }))
      .filter(({ q }) => !isSectionKind(q && q.type))
      .map(({ q, idx }) => {
      const kind = String(q.type || '').toLowerCase().trim()
      const isAuto = isMultipleChoiceKind(kind) || isSelectionKind(kind)
      if(isAuto) return Number(q._autoScore || 0)
      const input = questionsEl.querySelector(`input[name=score][data-index="${idx}"]`)
      if(!input){ resultEl.textContent='Missing score input'; throw new Error('invalid') }
      const v = Number(input.value)
      if(Number.isNaN(v) || v < 0){ input.focus(); resultEl.textContent='Invalid score value'; throw new Error('invalid') }
      const maxScore = Number(q.maxScore ?? 0) || 0
      if(v > maxScore){ input.focus(); resultEl.textContent=`Score cannot exceed max ${maxScore}`; throw new Error('invalid') }
      return v
    })
  }

  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault(); resultEl.textContent=''
    if(isArchiveMode){
      resultEl.textContent = 'Archive mode is read-only.'
      return
    }
    let scores
    try{ scores = collectScores() }catch(e){ return }
    const feedback = byId('feedback').value || ''
    try{
      setFormControlsEnabled(false)
      form.classList.add('is-submitting')
      if(submitBtn) submitBtn.textContent = 'Submitting...'
      const resp = await fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}/grade`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scores, feedback}), credentials: 'include'
      })
      const text = await resp.text()
      let data
      try{ data = JSON.parse(text) }catch(_){ data = { error: text } }
      if(!resp.ok){
        if(resp.status === 409 && data && data.error === 'under_review'){
          const who = data.reviewerName || 'another reviewer'
          resultEl.textContent = `This exam is currently under review by ${who}.`
          setFormControlsEnabled(false)
          setInputsEnabled(false)
          lockOwnedByMe = false
          stopLockHeartbeat()
          form.classList.remove('is-submitting')
          if(submitBtn) submitBtn.textContent = 'Submit Grades'
          return
        }
        resultEl.textContent = `Error: ${data.message || data.error || resp.status}`; setFormControlsEnabled(true); form.classList.remove('is-submitting'); if(submitBtn) submitBtn.textContent = 'Submit Grades'; return
      }
      resultEl.textContent = 'Submitted successfully.'
      clearDraft()
      hidePreview()
      setFormControlsEnabled(false)
      setInputsEnabled(false)
      lockOwnedByMe = false
      stopLockHeartbeat()
    }catch(e){ console.error(e); resultEl.textContent='Submission failed'; setFormControlsEnabled(true) }
    finally{
      form.classList.remove('is-submitting')
      if(submitBtn && submitBtn.textContent === 'Submitting...') submitBtn.textContent = 'Submit Grades'
    }
  })

  fetchCurrentUser()
  if(sessionId) fetchExam()

  if(!isArchiveMode){
    window.addEventListener('scroll', scheduleDraftSave, { passive: true })
    window.addEventListener('pagehide', saveDraftNow)
  }

  window.addEventListener('beforeunload', ()=>{
    if(!isArchiveMode) saveDraftNow()
    if(!isArchiveMode) releaseLockBestEffort()
  })
})();