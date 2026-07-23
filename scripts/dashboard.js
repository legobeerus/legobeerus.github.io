(function(){
  const cards = document.getElementById('dashboardCards')

  if(!cards) return

  cards.innerHTML = `
    <a class="dashboard-card dashboard-card--selector" href="exams.html">
      <div class="dashboard-card__top">
        <span class="dashboard-card__badge">Current</span>
        <span class="dashboard-card__link">Open</span>
      </div>
      <h3>Exam Dashboard</h3>
      <p>Review active exams, open grading sessions, and continue the existing workflow.</p>
      <div class="dashboard-card__details">
        <div class="dashboard-card__detail"><strong>Use case</strong><span>Phase 1 and Phase 4 review</span></div>
        <div class="dashboard-card__detail"><strong>Access</strong><span>Department of Administration or OSI Command</span></div>
      </div>
    </a>
    <a class="dashboard-card dashboard-card--selector" href="aos-dashboard.html">
      <div class="dashboard-card__top">
        <span class="dashboard-card__badge">New</span>
        <span class="dashboard-card__link">Open</span>
      </div>
      <h3>AOS Dashboard</h3>
      <p>Browse active arrest-on-sight warrants grouped by person, then open a per-person warrant profile.</p>
      <div class="dashboard-card__details">
        <div class="dashboard-card__detail"><strong>Use case</strong><span>Warrant list and warrant profile</span></div>
        <div class="dashboard-card__detail"><strong>Access</strong><span>Office of Special Investigations</span></div>
      </div>
    </a>
  `
})()