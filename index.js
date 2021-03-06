'use strict'

const userAgent = 'oneclick-update'
const { get: httpGet, createServer } = require('http')
const { get: httpsGet } = require('https')
const repos = {}
const platforms = ['win32', 'darwin', 'linux', 'nupkg']
const allowedRoots = { download: true, update: true, changelog: false }
const defaultPort = 8082
const defaultInterval = '15 mins'
const events = {}
const on = (evtName, cb) => { events[evtName] = cb }
const off = (evtName) => { delete events[evtName] }

const filterJoin = (ary, joinWith = '') => ary.filter((v) => v).join(joinWith)

const parseQs = (url) => {
  if (!url) return {}
  const qIdx = url.indexOf('?')
  if (qIdx === -1) return {}
  const q = url.slice(qIdx + 1)
  if (!q) return {}
  const obj = {}
  const ary = q.split('&')
  ary.forEach(function (q) {
    q = (q.split('=') || [q]).map(decodeURIComponent)
    if (q[0] !== (q[0] = q[0].replace(/\[]$/, ''))) obj[q[0]] = obj[q[0]] || []
    if (!obj[q[0]]) return (obj[q[0]] = q[1])
    if (Array.isArray(obj[q[0]])) obj[q[0]] = obj[q[0]].concat([q[1]])
    else obj[q[0]] = [obj[q[0]]].concat([q[1]])
  })
  return obj
}

const intvls = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
const picoMs = (str) => {
  const num = parseFloat(str)
  const intvl = `${str}`.replace(`${num}`, '').trim().charAt(0)
  return num * (intvls[intvl] || 1)
}

const semverRgx = new RegExp(
  '^v?(?<major>0|[1-9]\\d*)\\.(?<minor>0|[1-9]\\d*)\\.(?<patch>0|[1-9]\\d*)' +
  '(?:-(?<prerelease>(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.' +
  '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+(?<buildmetadata>' +
  '[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$'
)

const tagCache = {}
const toSemver = (t = '') => {
  if (tagCache[t]) return tagCache[t]

  const isSemver = true
  const matched = t.match(semverRgx)

  if (!matched) {
    tagCache[t] = {
      isSemver,
      valid: null,
      prerelease: null,
      weighted: 0,
      preWeighted: 0,
      eq: () => false,
      gt: () => false
    }
    return tagCache[t]
  }

  const toWeight = (accum, cur, i) => {
    if (Number.isNaN(+cur)) return accum || 0
    return accum + (+cur * parseFloat(`1e${Math.log(i + 1) * 10}`))
  }

  const versionAry = matched.slice(1, 4).map((n) => +n)
  const [major, minor, patch] = versionAry
  const { prerelease: pre } = matched.groups || {}
  const valid = `${major}.${minor}.${patch}${pre ? `-${pre}` : ''}`
  const weighted = versionAry.reverse().reduce(toWeight, 0)

  let prerelease = null
  let preWeighted = 0
  if (pre) {
    prerelease = pre.split('.').map((p) => Number.isNaN(+p) ? p : +p)
    preWeighted += prerelease.reduce(toWeight, 0)
    if (prerelease.includes('alpha')) preWeighted -= 1
  }

  const eq = (b) => {
    if (!b || !b.isSemver) b = toSemver(b)
    return valid === b.valid
  }

  const gt = (b) => {
    if (!b || !b.isSemver) b = toSemver(b)
    if (valid === b.valid || b.weighted > weighted) return false
    if (weighted > b.weighted) return true
    return preWeighted > b.preWeighted
  }

  tagCache[t] = {
    isSemver,
    valid,
    prerelease,
    weighted,
    preWeighted,
    eq,
    gt
  }
  return tagCache[t]
}

const {
  GITHUB_REPO,
  GITHUB_OAUTH_TOKEN,
  SERVER_URL,
  PORT,
  REFRESH_CACHE,
  LOG_DOWNLOADS
} = process.env

const contentType = {
  ghJson: 'application/vnd.github.v3+json',
  octet: 'application/octet-stream'
}

const ghHeader = (token, accept = 'ghJson') => {
  const header = { 'User-Agent': userAgent, Accept: contentType[accept] }

  if (token) header.Authorization = `token ${token}`

  return header
}

const apiBaseUrl = (repo) => `https://api.github.com/repos/${repo}`

class GithubApiError extends Error {
  constructor (message, res) {
    super(message)
    if (res.error) this.serverError = res.error
    this.statusCode = res.statusCode
    this.body = (res.data || {}).message || res.data
  }
}

const simpleGet = (url, opts = {}) => new Promise((resolve, reject) => {
  const getter = url.indexOf('http://') ? httpsGet : httpGet
  const { redirect = true } = opts

  getter(url, opts, (res) => {
    const location = res.headers.location

    if (res.statusCode === 302 && location) {
      if (redirect === false) return resolve(res)
      return simpleGet(location, { redirect }).then(resolve)
    }

    if (opts.noBody) return resolve(res)

    const isJson = (res.headers['content-type'] || '').indexOf('json') !== -1
    if (isJson) res.setEncoding('utf8')

    let data = ''
    res.on('data', (d) => { data += d })
    res.on('end', () => {
      if (isJson) {
        try {
          data = JSON.parse(data)
        } catch (ex) {
          res.error = ex
        }
      } else {
        data = data.charCodeAt(0) === 0xFEFF ? data.slice(1) : data
      }

      res.data = data
      resolve(res)
    })
    res.on('error', (error) => resolve({ statusCode: 500, error }))
  })
})

const isPrivate = async (repo, token) => {
  const url = apiBaseUrl(repo)

  const res = await simpleGet(url, { headers: ghHeader() })
  if (res.statusCode === 200) return { private: false }

  if (token) {
    const headers = ghHeader(token)
    const privRes = await simpleGet(url, { headers })
    if (privRes.statusCode === 200) return { private: true }
  }

  throw new GithubApiError(`Repo not found on Github: ${repo}`, res)
}

const initCacheForRepo = (repo) => {
  repo.lastCacheRefresh = Date.now()
  repo.resetCache = () => initCacheForRepo(repo)

  delete repo.releases
  delete repo.channels

  repo.cache = {
    channel: {},
    platform: {},
    serverUrl: {},
    version: {},
    platformAsset: {},
    releaseFile: {}
  }
}

const getConfig = async (configIn = {}) => {
  if (repos[configIn.repo]) return configIn

  const config = Object.assign({}, configIn)
  const intvl = (config.refreshCache || REFRESH_CACHE || '').toString().trim()
  config.refreshCache = picoMs(intvl || defaultInterval)
  config.port = (config.port || PORT || '').toString().trim() || defaultPort
  config.serverUrl = (config.serverUrl || SERVER_URL || '').trim()
  config.token = (config.token || GITHUB_OAUTH_TOKEN || '').trim()
  config.repo = (config.repo || GITHUB_REPO || '').trim()
  config.logDownloads = !!(config.logDownloads || LOG_DOWNLOADS)
  config.platformFilters = config.platformFilters || {}
  config.hostToChannel = config.hostToChannel || {}

  if (!config.repo) throw new Error('Repo is required')

  if (config.repo.indexOf('github.com/') !== -1) {
    config.repo = config.repo.replace(/.*github.com\//, '')
  }

  if (repos[config.repo]) return config

  repos[config.repo] = await isPrivate(config.repo, config.token)
  initCacheForRepo(repos[config.repo])

  if (repos[config.repo].private && !config.serverUrl) {
    let msg = '\nFor private repos we recommend setting serverUrl / SERVER_URL\n'
    msg += ' - If not set we will try to extract that info from each request\n'
    msg += ' - That isn\'t guaranteed to produce the correct return URL\n'
    msg += ' - That also adds overhead to each request\n'
    msg += ' - HTTPS is assumed unless running on port 80\n'
    console.log(msg)
  }

  return config
}

const getReleaseList = async (config) => {
  const { repo, token } = config
  const rlsUrl = `${apiBaseUrl(repo)}/releases`
  const headers = ghHeader(token)
  const { data: releases, error } = await simpleGet(rlsUrl, { headers })

  if (error) return Promise.reject(error)

  return releases.filter((r) => !r.draft)
}

const latestByChannel = async (config) => {
  const repo = repos[config.repo]

  const releases = repo.releases = repo.releases || await getReleaseList(config)
  const channels = repo.channels = repo.channels || {}

  const setLatestForChannel = (release, channel) => {
    release.channel = channel = channel.toLowerCase()
    const currentTag = toSemver((channels[channel] || {}).tag_name)
    if (currentTag.valid && currentTag.gt(release.tag_name)) return
    channels[channel] = release
  }

  releases.forEach((r) => {
    const { tag_name: tag } = r
    const semver = toSemver(tag)

    if (!semver.valid) return

    const tagMeta = tag.indexOf('+') >= 0 ? tag.slice(tag.indexOf('+') + 1) : ''
    const tagPreAry = semver.prerelease || []
    const tagPre = tagPreAry.find((p) => Number.isNaN(+p))
    const rlsPre = r.prerelease ? 'prerelease' : null

    const channel = filterJoin([tagMeta, tagPre, rlsPre], '/')
    setLatestForChannel(r, channel)
  })

  return channels
}

const guessPlatform = (ua = '') => {
  const uaPlatform = ((ua.match(/\((.+?)\)/) || [])[1] || '').toLowerCase()

  if (uaPlatform && uaPlatform.indexOf('windows') !== -1) return 'win32'
  if (uaPlatform && uaPlatform.indexOf('mac') !== -1) return 'darwin'

  return null
}

const getChannel = (repo, channels, pathLower, hostConfig = {}) => {
  const cacheKey = `${hostConfig.name || ''}:${pathLower}`
  const cached = repo.cache.channel[cacheKey]
  if (cached) return cached

  let channel = hostConfig.name ? channels[hostConfig.name] : null

  if (!channel) {
    Object.entries(channels).forEach(([channelName, release]) => {
      if (!channelName || pathLower.indexOf(channelName) === -1) return
      if (!channel) return (channel = release)

      const slashLen = (name) => name.split('/').length
      const useCurrent = slashLen(channel.channel) > slashLen(channelName)
      channel = useCurrent ? channel : release
    })
  }

  channel = channel || channels['']
  repo.cache.channel[cacheKey] = channel

  return channel
}

const getPlatform = (config, path, channel, action, headers) => {
  const useCache = action !== 'download'
  const repo = repos[config.repo]
  const cacheKey = `${channel.channel || ''}:${path}`
  const cached = useCache ? repo.cache.platform[cacheKey] : null

  if (cached) return cached

  const chInPath = channel.channel && path.indexOf(channel.channel) !== -1
  const ch = chInPath ? `/${channel.channel}` : ''
  const cut = `/${action === 'release' ? 'update' : action}${ch}`
  const tmpPath = path.indexOf(cut) ? path : path.slice(cut.length + 1)
  const customPlatforms = Object.keys(config.platformFilters)
  const valid = (p) => platforms.concat(customPlatforms).includes(p) ? p : null
  const pathPlatform = valid(tmpPath.split('/')[0])
  const platform = pathPlatform || guessPlatform(headers['user-agent'])

  if (pathPlatform && useCache) repo.cache.platform[cacheKey] = platform

  return platform
}

const getVersion = (config, path, channel, action, platform) => {
  const repo = repos[config.repo]
  const cached = repo.cache.version[path]

  if (cached || action === 'download') return cached

  const ch = channel.channel ? `/${channel.channel}` : ''
  const cut = `/${action === 'release' ? 'update' : action}${ch}/${platform}`
  const tmpPath = path.indexOf(cut) ? path : path.slice(cut.length + 1)
  const version = toSemver(tmpPath.split('/')[0]).valid

  repo.cache.version[path] = version

  return version
}

const getServerUrl = (repo, pathLower, req) => {
  const cached = repo.cache.serverUrl[pathLower]
  if (cached) return cached

  const { socket } = req
  const unsecure = socket.localPort === 80 || socket.remotePort === 80

  if (!req.headers.host) return

  const serverUrl = `${unsecure ? 'http' : 'https'}://${req.headers.host}`
  repo.cache.serverUrl[pathLower] = serverUrl

  return serverUrl
}

const filterByExt = (assets, ext) => {
  if (ext.charAt(0) === '.') ext = ext.slice(1)
  return assets.filter(({ name }) => {
    return ext === name.substr(name.lastIndexOf('.') + 1, name.length)
  })
}

const firstForArch = (assets, arch) => {
  assets.sort((a, b) => {
    a = a.name.indexOf('64') === -1 ? -1 : 1
    b = b.name.indexOf('64') === -1 ? -1 : 1
    return a - b
  })

  return arch === 'x64' ? assets[assets.length - 1] : assets[0]
}

const platformFilters = {
  win32: (assets, action = 'download', arch, ext) => {
    const download = () => {
      ext = ext || 'exe'
      if ((assets = filterByExt(assets, ext)).length < 2) return assets[0]
      return firstForArch(assets, arch)
    }

    const release = () => {
      assets = assets.filter((a) => !a.name.indexOf('RELEASES'))
      if (assets.length < 2) return assets[0]
      return firstForArch(assets, arch)
    }

    const actions = { download, update: download, release }

    return actions[action] ? actions[action]() : null
  },
  darwin: (assetsIn, action = 'download', arch = 'x64', ext) => {
    const osxExts = ['dmg', 'pkg', 'zip']

    const download = (noExt) => {
      let assets = assetsIn.filter(({ name }) => name.indexOf('symbols') === -1)

      if (ext === 'zip' && !noExt) {
        assets = assets.filter((a) => a.name.match(/mac|osx|darwin/i))
      }

      if (ext && !noExt) return filterByExt(assets, ext)[0] || download(true)

      return osxExts.map((extName) => {
        return firstForArch(filterByExt(assets, extName), arch)
      }).filter((v) => v)[0]
    }

    const update = () => {
      ext = 'zip'
      return download()
    }

    const actions = { download, update }

    return actions[action] ? actions[action]() : null
  },
  linux: (assets, action = 'download', arch = 'x64', ext) => {
    const nixExts = ['deb', 'rpm', 'AppImage', 'gz', 'zip']

    const download = (noExt) => {
      if (ext === 'zip' && !noExt) {
        assets = assets.filter((a) => a.name.indexOf('linux') !== -1)
      }

      if (ext && !noExt) return filterByExt(assets, ext)[0] || download(true)

      return nixExts.map((extName) => {
        return firstForArch(filterByExt(assets, extName), arch)
      }).filter((v) => v)[0]
    }

    return download()
  },
  nupkg: (assets) => filterByExt(assets, 'nupkg')[0]
}

const getPlatformAsset = (config, channel, platform, action, query) => {
  const arch = query.arch
  const ext = query.filetype
  const file = query.filename
  const repo = repos[config.repo]
  const key = [channel.tag_name, action, platform, arch, ext, file].join(':')
  const cached = repo.cache.platformAsset[key]

  if (cached) return cached

  const assets = channel.assets.slice(0)
  const nativePlatform = platformFilters[platform]
  const userPlatform = config.platformFilters[platform]
  let asset

  if (file && (asset = assets.find((a) => a.name === file))) return asset

  if (!userPlatform && !nativePlatform) return

  if (userPlatform) {
    asset = config.platformFilters[platform](assets, action, arch, ext)
  }

  asset = asset || (nativePlatform || (() => {}))(assets, action, arch, ext)

  repo.cache.platformAsset[key] = asset

  return asset
}

const getReleasesFile = async (config, channel, asset, serverUrl) => {
  const { channel: chName, assets } = channel
  const cacheKeyAry = [config.repo, chName, asset.tag_name, serverUrl]
  const cacheKey = filterJoin(cacheKeyAry)
  const repo = repos[config.repo]
  const cached = repo.cache.releaseFile[cacheKey]
  const version = channel.tag_name

  if (cached) return cached

  const url = repo.private ? asset.url : asset.browser_download_url
  const headers = ghHeader(config.token, 'octet')
  const { data } = await simpleGet(url, { headers })

  const getUrlOut = (v) => {
    const nupkg = assets.find((a) => a.name === v) || {}
    const { name, browser_download_url: publicUrl } = nupkg
    if (!repo.private && publicUrl) return publicUrl
    const urlEls = [serverUrl, 'download', chName, 'nupkg', version, name || v]
    return encodeURI(filterJoin(urlEls, '/'))
  }

  const releases = data.split('\n').map((l) => {
    return l.split(' ').map((v, i) => i === 1 ? getUrlOut(v) : v).join(' ')
  }).join('\n')

  repo.cache.releaseFile[cacheKey] = releases

  return releases
}

const requestHandler = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    return Promise.reject(ex)
  }

  const repo = repos[config.repo]

  return async (req, res) => {
    const hostConfig = config.hostToChannel[req.headers.host] || {}
    let serverUrl = hostConfig.serverUrl || config.serverUrl

    const { headers } = req
    const query = parseQs(req.url)
    const [path] = (req.url.length < 2 ? '/download' : req.url).split('?')
    const pathLower = path.toLowerCase()

    const finish = (location, noContent) => {
      if (location) res.writeHead(302, { Location: location })
      if (noContent) res.statusCode = 204
      return res.end()
    }

    if (!allowedRoots[path.split('/')[1]]) return finish(null, true)

    const nextRefresh = repo.lastCacheRefresh + config.refreshCache
    if (nextRefresh < Date.now()) repo.resetCache()

    if (repo.private && !serverUrl) {
      serverUrl = getServerUrl(repo, pathLower, req)

      if (!serverUrl) {
        const err = new Error('Unable to determine serverUrl for private repo')
        console.error(err)

        return finish(null, true)
      }
    }

    const isUpdate = !pathLower.indexOf('/update')
    const isRelease = pathLower.indexOf('/releases') !== -1
    const action = isUpdate ? (isRelease ? 'release' : 'update') : 'download'

    const channels = await latestByChannel(config)

    const channel = getChannel(repo, channels, pathLower, hostConfig)

    if (!channel) return finish(null, true)

    const platform = getPlatform(config, pathLower, channel, action, headers)

    if (!platform && !query.filename) return finish(null, true)

    const version = getVersion(config, pathLower, channel, action, platform)
    const samesies = version && toSemver(channel.tag_name).eq(version)

    if (samesies && action !== 'release') return finish(null, true)

    const asset = getPlatformAsset(config, channel, platform, action, query)

    if (!asset) return finish(null, true)

    if (action === 'download') {
      const hasDlListener = typeof events.download === 'function'
      if ((hasDlListener || config.logDownloads) && asset.name !== 'RELEASES') {
        const connection = req.connection || {}
        const ip = req.headers['x-forwarded-for'] || connection.remoteAddress
        const args = {
          ip,
          requestUrl: req.url,
          asset: asset.name,
          channel: channel.channel,
          platform,
          version: channel.tag_name
        }

        if (hasDlListener) events.download(args)
        if (config.logDownloads) {
          const fType = query.filetype
          const fName = query.filename
          const info = filterJoin([args.channel, platform, fType, fName], '/')
          console.log(`Download for ${info}: ${args.asset}`)
        }
      }

      if (!repo.private) return finish(asset.browser_download_url)

      const headers = ghHeader(config.token, 'octet')
      const privRes = await simpleGet(asset.url, { headers, redirect: false })

      return finish(privRes.headers.location)
    }

    if (action === 'update') {
      res.setHeader('Content-Type', 'application/json')

      let url = asset.browser_download_url

      if (repo.private) {
        const ch = channel.channel ? `/${channel.channel}` : ''
        const qs = platform === 'darwin' ? '?filetype=zip' : ''
        url = `${serverUrl}/download${ch}/${platform}${qs}`
      }

      const { tag_name: name, body: notes, name: title } = channel

      return res.end(JSON.stringify({ name, notes, title, url }, null, 2))
    }

    if (action === 'release') {
      return res.end(await getReleasesFile(config, channel, asset, serverUrl))
    }
  }
}

module.exports = {
  getConfig,
  getReleaseList,
  latestByChannel,
  requestHandler,
  simpleGet,
  on,
  off
}

if (require.main === module) {
  const startServer = async () => {
    let config
    try {
      config = require('./secrets.json')
    } catch (ex) {}

    config = await getConfig(config)
    const handler = await requestHandler(config)
    createServer(handler).listen(config.port, () => {
      console.log(`Update server running on port ${config.port}`)
    })
  }

  startServer()
}
