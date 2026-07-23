(function(){
  const TAG_LABELS = {
    '1414718122971103333': 'Active warrant',
    '1414718407621873764': 'Light infraction',
    '1414718477612093571': 'Medium infraction',
    '1414718528774475786': 'Heavy infraction',
    '1414718868966080586': 'REQ reward',
    '1414719611378864168': 'Ribbon/medal award',
    '1414731884872728709': '30 day limit',
    '1525486629458804928': 'Approved'
  }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function formatDate(value){
    if(!value) return ''
    const text = String(value)
    const discordSnowflakeLike = /^\d{16,22}$/.test(text)
    if(discordSnowflakeLike){
      const epoch = Number((BigInt(text) >> 22n) + 1420070400000n)
      const date = new Date(epoch)
      if(!Number.isNaN(date.getTime())) return date.toLocaleString()
    }
    const maybeDate = new Date(text)
    return Number.isNaN(maybeDate.getTime()) ? text : maybeDate.toLocaleString()
  }

  function toArray(value){
    if(Array.isArray(value)) return value
    if(value == null) return []
    if(typeof value === 'string'){
      const text = value.trim()
      if(!text) return []
      try{
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : [parsed]
      }catch(e){
        return text.split(',').map(part => part.trim()).filter(Boolean)
      }
    }
    return [value]
  }

  function normalizeBoolean(value, fallback){
    if(typeof value === 'boolean') return value
    if(typeof value === 'string'){
      const text = value.trim().toLowerCase()
      if(text === 'true') return true
      if(text === 'false') return false
    }
    if(typeof value === 'number') return value !== 0
    return fallback
  }

  function normalizeWarrant(entry){
    const row = entry || {}
    const payload = row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : null
    const source = payload || row
    return {
      threadId: String(source.threadId || source.thread_id || row.threadId || row.thread_id || row.id || ''),
      guildId: String(source.guildId || source.guild_id || row.guildId || row.guild_id || ''),
      forumChannelId: String(source.forumChannelId || source.forum_channel_id || row.forumChannelId || row.forum_channel_id || ''),
      threadName: String(source.threadName || source.thread_name || row.threadName || row.thread_name || ''),
      url: String(source.url || row.url || ''),
      submitter: String(source.submitter || row.submitter || ''),
      username: String(source.username || row.username || ''),
      profile: String(source.profile || row.profile || ''),
      victims: String(source.victims || row.victims || ''),
      charges: String(source.charges || row.charges || ''),
      summary: String(source.summary || row.summary || ''),
      proof: String(source.proof || row.proof || ''),
      tags: toArray(source.tags || row.tags).map(tag => String(tag)).filter(Boolean),
      calculatedTimeMinutes: Number(source.calculatedTimeMinutes || source.calculated_time_minutes || row.calculatedTimeMinutes || row.calculated_time_minutes || 0) || 0,
      jailMinutes: Number(source.jailMinutes || source.jail_minutes || row.jailMinutes || row.jail_minutes || 0) || 0,
      postedByBot: normalizeBoolean(source.postedByBot ?? source.posted_by_bot ?? row.postedByBot ?? row.posted_by_bot, true),
      createdAt: String(source.createdAt || source.created_at || row.createdAt || row.created_at || ''),
      activatedAt: String(source.activatedAt || source.activated_at || row.activatedAt || row.activated_at || ''),
      lastSeenAt: String(source.lastSeenAt || source.last_seen_at || row.lastSeenAt || row.last_seen_at || '')
    }
  }

  function tagLabel(tagId){
    return TAG_LABELS[String(tagId)] || String(tagId)
  }

  function tagOrder(tagId){
    const order = {
      '1414718122971103333': 10,
      '1414718407621873764': 20,
      '1414718477612093571': 30,
      '1414718528774475786': 40,
      '1414718868966080586': 50,
      '1414719611378864168': 60,
      '1414731884872728709': 70,
      '1525486629458804928': 80
    }
    return order[String(tagId)] || 999
  }

  function uniqueTags(tags){
    return Array.from(new Set(toArray(tags).map(tag => String(tag)).filter(Boolean)))
  }

  function sortTags(tags){
    return uniqueTags(tags).sort((left, right) => {
      const diff = tagOrder(left) - tagOrder(right)
      return diff !== 0 ? diff : tagLabel(left).localeCompare(tagLabel(right))
    })
  }

  function groupByUsername(items){
    const groups = new Map()
    toArray(items).forEach(item => {
      const normalized = normalizeWarrant(item)
      const key = normalized.username || 'Unknown'
      const existing = groups.get(key) || []
      existing.push(normalized)
      groups.set(key, existing)
    })
    return Array.from(groups.entries()).map(([username, warrants]) => ({ username, warrants }))
  }

  window.AOS_UTILS = {
    escapeHtml,
    formatDate,
    groupByUsername,
    normalizeWarrant,
    sortTags,
    tagLabel,
    tagOrder,
    uniqueTags
  }
})()