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
    sessionLabel.textContent = `Session: ${data.id || sessionId} — Candidate: ${data.candidateMention || 'unknown'}`

    if(!data.questions || data.questions.length===0){
      questionsEl.innerHTML = '<p>No questions found for this session.</p>'
      return
    }

    questionsEl.innerHTML = ''
    data.questions.forEach((q, idx)=>{
      const div = document.createElement('div')
      div.className = 'question'
      div.innerHTML = `<div class="qmeta">Q${idx+1}</div>
        <div class="prompt"><strong>Question:</strong> ${escapeHtml(q.prompt || q.question || '')}</div>
        <div class="answer"><strong>Answer:</strong> ${escapeHtml(q.answer || q.response || '')}</div>
        <label>Score: <input type="number" min="0" step="1" name="score" data-index="${idx}" value="0"></label>`
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
    const total = scores.reduce((a,b)=>a+b,0)
    const percent = exam && exam.maxScore ? Math.round(total / exam.maxScore * 100) : '—'
    previewText.textContent = `Scores: ${scores.join(', ')}\nTotal: ${total}\nPercent: ${percent}\n\nFeedback:\n${feedback}`
    previewArea.style.display='block'
  })

  function collectScores(){
    const inputs = Array.from(questionsEl.querySelectorAll('input[name=score]'))
    if(!exam) return null
    const scores = inputs.map(i=>{
      const v = Number(i.value)
      if(Number.isNaN(v) || v<0){ i.focus(); resultEl.textContent='Invalid score value'; throw new Error('invalid') }
      return v
    })
    if(scores.length !== exam.questions.length){ resultEl.textContent='Score count mismatch'; return null }
    return scores
  }

  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault(); resultEl.textContent=''
    let scores
    try{ scores = collectScores() }catch(e){ return }
    const feedback = byId('feedback').value || ''
    try{
      const resp = await fetch(`${AUTH_SERVER}/api/exams/${encodeURIComponent(sessionId)}/grade`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scores,feedback}), credentials: 'include'
      })
      const data = await resp.json()
      if(!resp.ok){ resultEl.textContent = `Error: ${data.message || resp.status}`; return }
      resultEl.textContent = `Submitted. Result: ${JSON.stringify(data)}`
    }catch(e){ console.error(e); resultEl.textContent='Submission failed' }
  })

  if(sessionId) fetchExam()
})();