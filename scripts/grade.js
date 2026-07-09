(function(){
  function byId(id){return document.getElementById(id)}
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin
  const params = new URLSearchParams(location.search)
  const sessionId = params.get('session') || ''
  const reviewerEl = byId('reviewer')
  const sessionLabel = byId('sessionLabel')
  const questionsEl = byId('questions')
  const form = byId('gradeForm')
  const previewBtn = byId('previewBtn')
  const previewArea = byId('previewArea')
  const previewText = byId('previewText')
  const resultEl = byId('result')
  let currentUser = null

  sessionLabel.textContent = sessionId ? `Session: ${sessionId}` : 'No session specified.'

  if(!sessionId){ document.getElementById('sessionNotFound').style.display='block' }

  let exam = null

  function renderExam(data){
    exam = data
    if(currentUser){
      const tag = currentUser.discriminator ? `#${currentUser.discriminator}` : ''
      reviewerEl.textContent = `${currentUser.username || 'Reviewer'}${tag}`
    } else if(data.reviewer){
      reviewerEl.textContent = `${data.reviewer.username}#${data.reviewer.discriminator}`
    } else {
      reviewerEl.textContent = ''
    }
    const candidate = data.candidateMention || data.candidate_name || data.userId || (data.user && data.user.username) || 'unknown'
    sessionLabel.textContent = `Session: ${data.examId || data.id || sessionId} — Candidate: ${candidate}`

    const answersByIndex = new Map((data.answers || []).map(a => [a.index, a.answer]))
    exam.answersByIndex = answersByIndex
    const totalPossible = (data.questions || []).reduce((sum,q)=>sum + (Number(q.maxScore ?? 1) || 1), 0)
    exam.maxScore = totalPossible
    byId('totalPossible').textContent = `Total possible: ${totalPossible}`

    if(!data.questions || data.questions.length===0){
      questionsEl.innerHTML = '<p>No questions found for this session.</p>'
      return
    }

    questionsEl.innerHTML = ''
    data.questions.forEach((q, idx)=>{
      const maxScore = Number(q.maxScore ?? 1) || 1
      const kind = String(q.type || '').toLowerCase().trim()
      const isMC = kind === 'multiplechoice' || kind === 'multiple-choice' || kind === 'mc'
      const isText = kind === '' || kind === 'text'
      const answerValue = answersByIndex.get(idx) ?? ''
      const answerNormalized = String(answerValue || '').trim()
      const correctAnswerRaw = q.correctAnswer || q.correct_answer || ''
      const correctNormalized = String(correctAnswerRaw || '').trim()
      const div = document.createElement('div')
      div.className = 'question'

      let scoreInput = ''
      if(isText){
        scoreInput = `<label>Score: <input type="number" min="0" max="${maxScore}" step="1" name="score" data-index="${idx}" value="0"></label>`
      }

      let choicesHtml = ''
      if(isMC && Array.isArray(q.choices)){
        choicesHtml = `<div class="choices"><strong>Choices:</strong><ul>`
        q.choices.forEach(choice=>{
          const rawChoice = typeof choice === 'string' ? choice : choice.value ?? choice.label ?? choice.text ?? ''
          const label = typeof choice === 'string' ? choice : choice.label || choice.text || choice.value || ''
          const choiceNormalized = String(rawChoice || '').trim()
          const choiceKey = String(choiceNormalized.split(/\)|\.|\s/)[0]) || ''
          const isSelected = answerNormalized !== '' && (answerNormalized === choiceNormalized || answerNormalized === choiceKey)
          const isCorrect = correctNormalized !== '' && (choiceNormalized === correctNormalized || choiceKey === correctNormalized)
          const icon = isSelected ? (isCorrect ? '✅' : '❌') : '▫️'
          choicesHtml += `<li style="margin:4px 0">${icon} ${escapeHtml(label)}</li>`
        })
        choicesHtml += '</ul></div>'
      }

      const isCorrectAnswer = isMC && answerNormalized !== '' && (answerNormalized === correctNormalized || answerNormalized === String(correctAnswerRaw).trim())
      const mcStatus = isMC
        ? `<div class="mc-result">${isCorrectAnswer ? 'Correct' : 'Incorrect'} - ${isCorrectAnswer ? maxScore : 0} points</div>`
        : ''

      if(isMC){
        div.classList.add('mc-question', isCorrectAnswer ? 'mc-correct' : 'mc-incorrect')
        q._autoScore = isCorrectAnswer ? maxScore : 0
      }

      div.innerHTML = `<div class="qmeta">Q${idx+1} (max ${maxScore})</div>
        <div class="prompt"><strong>Question:</strong> ${escapeHtml(q.text || q.prompt || q.question || '')}</div>
        <div class="answer"><strong>Answer:</strong> ${escapeHtml(answerValue)}</div>
        ${choicesHtml}
        ${mcStatus}
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
      updateScoreState()
    })
  }

  function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c]) }
  function setFormControlsEnabled(enabled){
    previewBtn.disabled = !enabled
    const submitBtn = form.querySelector('[type=submit]')
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
  async function fetchExam(){
    try{
      const resp = await fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}`, { credentials: 'include' })
      if(resp.status===404){ document.getElementById('sessionNotFound').style.display='block'; return }
      if(resp.status===401||resp.status===403){ location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname+location.search)}`; return }
      const data = await resp.json()
      renderExam(data)
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
    const scores = collectScores()
    if(!scores) return
    const feedback = byId('feedback').value || ''
    const total = scores.reduce((a,b)=>a + (b == null ? 0 : b),0)
    const percent = exam && exam.maxScore ? Math.round(total / exam.maxScore * 100) : '—'
    previewText.textContent = `Scores: ${scores.map(s=>s==null?'null':s).join(', ')}\nTotal: ${total}\nPercent: ${percent}\n\nFeedback:\n${feedback}`
    previewArea.style.display='block'
  })

  function collectScores(){
    if(!exam) return null
    return exam.questions.map((q, idx) => {
      const isMC = q.type === 'multiplechoice'
      if(isMC) return Number(q._autoScore || 0)
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
    let scores
    try{ scores = collectScores() }catch(e){ return }
    const feedback = byId('feedback').value || ''
    try{
      setFormControlsEnabled(false)
      const resp = await fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}/grade`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scores, feedback}), credentials: 'include'
      })
      const text = await resp.text()
      let data
      try{ data = JSON.parse(text) }catch(_){ data = { error: text } }
      if(!resp.ok){ resultEl.textContent = `Error: ${data.message || data.error || resp.status}`; setFormControlsEnabled(true); return }
      resultEl.textContent = 'Submitted successfully.'
      setFormControlsEnabled(false)
    }catch(e){ console.error(e); resultEl.textContent='Submission failed'; setFormControlsEnabled(true) }
  })

  fetchCurrentUser()
  if(sessionId) fetchExam()
})();