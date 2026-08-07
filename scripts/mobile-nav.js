(function(){
  function setupMobileNav(){
    const nav = document.querySelector('.nav')
    const brand = document.querySelector('.nav .brand')
    const links = document.querySelector('.nav .nav-links')

    if(!nav || !brand || !links) return

    function isMobile(){
      return window.matchMedia('(max-width: 900px)').matches
    }

    function isOpen(){
      return nav.classList.contains('nav-mobile-open')
    }

    function setOpen(next){
      nav.classList.toggle('nav-mobile-open', Boolean(next))
      brand.setAttribute('aria-expanded', next ? 'true' : 'false')
    }

    brand.setAttribute('aria-haspopup', 'true')
    brand.setAttribute('aria-expanded', 'false')

    brand.addEventListener('click', function(event){
      if(!isMobile()) return

      if(isOpen()){
        // When already open, allow the brand link to navigate home.
        return
      }

      event.preventDefault()
      setOpen(true)
    })

    document.addEventListener('click', function(event){
      if(!isMobile() || !isOpen()) return
      if(nav.contains(event.target)) return
      setOpen(false)
    })

    links.addEventListener('click', function(event){
      const target = event.target
      if(!(target instanceof Element)) return
      if(target.closest('a')) setOpen(false)
    })

    document.addEventListener('keydown', function(event){
      if(event.key === 'Escape') setOpen(false)
    })

    window.addEventListener('resize', function(){
      if(!isMobile()) setOpen(false)
    })
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', setupMobileNav)
  }else{
    setupMobileNav()
  }
})()
