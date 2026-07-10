(function(){
  // server origin can be set via window.__AUTH_SERVER__ (eg: https://your-app.up.railway.app)
  const AUTH_SERVER = (window && window.__AUTH_SERVER__) || window.location.origin

  async function getUser(){
    try{
      const r = await fetch(`${AUTH_SERVER}/api/me`,{credentials:'include'})
      if(r.status === 204) return null
      if(!r.ok) return null
      return await r.json()
    }catch(e){return null}
  }

  function ensureNavCta(){
    const navInner = document.querySelector('.nav .nav-inner') || document.querySelector('.nav-inner')
    if(!navInner) return null
    let cta = navInner.querySelector('.nav-cta')
    if(!cta){
      cta = document.createElement('div')
      cta.className = 'nav-cta'
      navInner.appendChild(cta)
    }
    return cta
  }

  function avatarUrl(user){
    if(!user) return ''
    if(user.avatar){
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    }
    const disc = Number(user.discriminator) || 0
    return `https://cdn.discordapp.com/embed/avatars/${disc % 5}.png`
  }

  function createAvatarButton(user){
    const wrapper = document.createElement('div')
    wrapper.className = 'auth-menu'
    const btn = document.createElement('button')
    btn.className = 'btn'
    btn.style.padding = '4px'
    btn.style.borderRadius = '999px'
    btn.style.display = 'inline-flex'
    btn.style.alignItems = 'center'
    btn.style.gap = '8px'

    const img = document.createElement('img')
    img.src = avatarUrl(user)
    img.alt = user.username
    img.style.width = '36px'
    img.style.height = '36px'
    img.style.borderRadius = '999px'
    img.style.display = 'block'

    btn.appendChild(img)
    wrapper.appendChild(btn)

    const menu = document.createElement('div')
    menu.className = 'auth-menu-dropdown'
    menu.style.position = 'absolute'
    menu.style.background = 'linear-gradient(180deg, rgba(18,18,18,0.98), rgba(10,10,10,0.98))'
    menu.style.border = '1px solid rgba(255,255,255,0.08)'
    menu.style.boxShadow = '0 18px 40px rgba(0,0,0,0.42)'
    menu.style.backdropFilter = 'blur(10px)'
    menu.style.padding = '8px'
    menu.style.borderRadius = '8px'
    menu.style.minWidth = '160px'
    menu.style.display = 'none'
    menu.style.right = '0'
    menu.style.marginTop = '8px'
    menu.style.zIndex = '60'

    const profile = document.createElement('a')
    profile.href = '/profile.html'
    profile.textContent = 'View profile'
    profile.className = 'btn'
    profile.style.display='block'
    profile.style.padding='8px'
    profile.style.textDecoration='none'

    const signout = document.createElement('a')
    signout.href = `${AUTH_SERVER}/logout`
    signout.textContent = 'Sign out'
    signout.className = 'btn'
    signout.style.display='block'
    signout.style.padding='8px'

    menu.appendChild(profile)
    menu.appendChild(signout)
    wrapper.appendChild(menu)

    btn.addEventListener('click', (e)=>{ e.preventDefault(); menu.style.display = menu.style.display==='none' ? 'block' : 'none' })
    document.addEventListener('click', (e)=>{ if(!wrapper.contains(e.target)) menu.style.display='none' })

    return wrapper
  }

  function createLoginButton(){
    const a = document.createElement('a')
    a.className = 'btn btn-primary'
    // Redirect back to site root after OAuth to avoid cross-origin next URLs causing 404.
    a.href = `${AUTH_SERVER}/auth/discord?next=/`
    a.textContent = 'Login'
    return a
  }

  function showAccessNoticeFromQuery(){
    const params = new URLSearchParams(window.location.search)
    const value = (params.get('access') || params.get('acess') || '').toLowerCase()
    if(value !== 'denied') return

    const host = document.querySelector('main') || document.body
    if(!host) return

    const notice = document.createElement('div')
    notice.className = 'access-notice'
    notice.setAttribute('role', 'alert')
    notice.innerHTML = `
      <div class="access-notice__content">
        <strong>Access denied.</strong> Your Discord account does not have the required role for the dashboard.
      </div>
      <button type="button" class="access-notice__close" aria-label="Dismiss access notice">Dismiss</button>
    `

    const closeBtn = notice.querySelector('.access-notice__close')
    closeBtn.addEventListener('click', ()=>{
      notice.remove()
      params.delete('access')
      params.delete('acess')
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`
      history.replaceState({}, '', next)
    })

    host.insertBefore(notice, host.firstChild)
  }

  async function init(){
    showAccessNoticeFromQuery()
    const cta = ensureNavCta()
    if(!cta) return
    cta.innerHTML = ''
    const user = await getUser()
    if(user && user.id){
      const avatar = createAvatarButton(user)
      cta.appendChild(avatar)
    }else{
      const login = createLoginButton()
      cta.appendChild(login)
    }
  }

  // run on load
  document.addEventListener('DOMContentLoaded', init)
})();