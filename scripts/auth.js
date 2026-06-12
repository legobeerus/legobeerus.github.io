(function(){
  async function getUser(){
    try{
      const r = await fetch('/api/me',{credentials:'same-origin'})
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
    menu.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))'
    menu.style.border = '1px solid rgba(255,255,255,0.04)'
    menu.style.padding = '8px'
    menu.style.borderRadius = '8px'
    menu.style.minWidth = '160px'
    menu.style.display = 'none'
    menu.style.right = '0'
    menu.style.marginTop = '8px'

    const profile = document.createElement('a')
    profile.href = '/profile.html'
    profile.textContent = 'View profile'
    profile.className = 'btn'
    profile.style.display='block'
    profile.style.padding='8px'
    profile.style.textDecoration='none'

    const signout = document.createElement('a')
    signout.href = '/logout'
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
    a.href = '/auth/discord'
    a.textContent = 'Login'
    return a
  }

  async function init(){
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