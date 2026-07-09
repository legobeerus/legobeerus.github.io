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

  sessionLabel.textContent = sessionId ? `Session: ${sessionId}` : 'No session specified.'

  if(!sessionId){ document.getElementById('sessionNotFound').style.display='block' }

  let exam = null

  function renderExam(data){
    exam = data
    reviewerEl.textContent = data.reviewer ? `${data.reviewer.username}#${data.reviewer.discriminator}` : 'Reviewer'
    const candidate = data.candidateMention || data.candidate_name || data.userId || (data.user && data.user.username) || 'unknown'
    sessionLabel.textContent = `Session: ${data.examId || data.id || sessionId} — Candidate: ${candidate}`

    const totalPossible = (data.questions || []).reduce((sum,q)=>sum + (Number(q.maxScore) || 1), 0)
    exam.maxScore = totalPossible
    byId('totalPossible').textContent = `Total possible: ${totalPossible}`

    if(!data.questions || data.questions.length===0){
      questionsEl.innerHTML = '<p>No questions found for this session.</p>'
      return
    }

    questionsEl.innerHTML = ''
    data.questions.forEach((q, idx)=>{
      const maxScore = Number(q.maxScore) || 1
      const isMC = q.type === 'multiplechoice'
      const isText = !q.type || q.type === 'text'
      const div = document.createElement('div')
      div.className = 'question'

      let scoreInput = ''
      if(isText){
        scoreInput = `<label>Score: <input type="number" min="0" max="${maxScore}" step="1" name="score" data-index="${idx}" value="0"></label>`
      } else if(isMC){
        scoreInput = `<div class="mc-score">Auto-graded MC question (max ${maxScore})</div>`
      }

      let choicesHtml = ''
      if(isMC && Array.isArray(q.choices)){
        const selected = q.answer || q.selected
        const correctAnswer = q.correctAnswer || q.correct_answer
        choicesHtml = `<div class="choices"><strong>Choices:</strong><ul>`
        q.choices.forEach(choice=>{
          let label = typeof choice === 'string' ? choice : choice.label || choice.text || choice.value || ''
          let choiceValue = typeof choice === 'string' ? choice : choice.value || choice.label || choice.text || ''
          const isSelected = selected != null && String(choiceValue) === String(selected)
          const isCorrect = choice.correct === true || (correctAnswer != null && String(choiceValue) === String(correctAnswer))
          const icon = isSelected ? (isCorrect ? '✅' : '❌') : '▫️'
          choicesHtml += `<li style="margin:4px 0">${icon} ${escapeHtml(label)}</li>`
        })
        choicesHtml += '</ul></div>'
      }

      const correctness = isMC ? `<div class="mc-result">${q.correct === true || q.isCorrect === true || (q.answer != null && (q.answer === q.correctAnswer || q.answer === q.correct_answer)) ? 'Correct' : 'Incorrect'}</div>` : ''

      div.innerHTML = `<div class="qmeta">Q${idx+1} (max ${maxScore})</div>
        <div class="prompt"><strong>Question:</strong> ${escapeHtml(q.prompt || q.question || '')}</div>
        <div class="answer"><strong>Answer:</strong> ${escapeHtml(q.answer || q.response || '')}</div>
        ${choicesHtml}
        ${correctness}
        ${scoreInput}`
      questionsEl.appendChild(div)
    })
  }

  function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c]) }

  async function fetchExam(){
    try{
      const resp = await fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}`, { credentials: 'include' })
      if(resp.status===404){ document.getElementById('sessionNotFound').style.display='block'; return }
      if(resp.status===401||resp.status===403){ location.href = `${AUTH_SERVER}/auth/discord?next=${encodeURIComponent(location.pathname+location.search)}`; return }
      const data = await resp.json()
      renderExam(data)
    }catch(e){ console.error(e); resultEl.textContent = 'Failed to load exam.' }
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
      if(isMC) return null
      const input = questionsEl.querySelector(`input[name=score][data-index="${idx}"]`)
      if(!input){ resultEl.textContent='Missing score input'; throw new Error('invalid') }
      const v = Number(input.value)
      if(Number.isNaN(v) || v < 0){ input.focus(); resultEl.textContent='Invalid score value'; throw new Error('invalid') }
      const maxScore = Number(q.maxScore) || 1
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
      const resp = await fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}/grade`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scores, feedback}), credentials: 'include'
      })
      const text = await resp.text()
      let data
      try{ data = JSON.parse(text) }catch(_){ data = { error: text } }
      if(!resp.ok){ resultEl.textContent = `Error: ${data.message || data.error || resp.status}`; return }
      resultEl.textContent = `Submitted. Result: ${JSON.stringify(data)}`
    }catch(e){ console.error(e); resultEl.textContent='Submission failed' }
  })

  if(sessionId) fetchExam()
})();