'use strict'

const { get: httpsGet } = require('https')
const semver = require('semver')
const repos = {}

const {
  GITHUB_ACCOUNT,
  GITHUB_PROJECT,
  GITHUB_REPO,
  GITHUB_OAUTH_TOKEN,
  SERVER_URL
} = process.env

const hdrUa = { 'User-Agent': `oneclick-update` }
const hdrGhJson = { Accept: `application/vnd.github.v3+json` }
const uaJsonHeader = Object.assign({}, hdrUa, hdrGhJson)

const setUaJson = (h) => Object.assign({}, h, hdrUa, hdrGhJson)
const getAuthHdr = (token) => (token ? { Authorization: `token ${token}` } : {})
const getAuthHdrJson = (token) => setUaJson(getAuthHdr(token))

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
  const { redirect } = opts
  httpsGet(url, opts, (res) => {
    const location = res.headers.location

    if (res.statusCode === 302 && redirect !== 'manual' && location) {
      return simpleGet(location, { redirect }).then(resolve)
    }

    if (opts.noBody) return resolve(res)

    const isJson = res.headers['content-type'].indexOf('json') !== -1
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
      }
      res.data = data
      resolve(res)
    })
    res.on('error', (error) => resolve({ statusCode: 500, error }))
  })
})

const isPrivate = async (repo, token) => {
  const url = apiBaseUrl(repo)

  const res = await simpleGet(url, { headers: uaJsonHeader })
  if (res.statusCode === 200) return { private: false }

  if (token) {
    const headers = getAuthHdrJson(token)
    const privRes = await simpleGet(url, { headers })
    if (privRes.statusCode === 200) return { private: true }
  }

  throw new GithubApiError(`Repo not found on Github: ${repo}`, res)
}

const getConfig = async (configIn = {}) => {
  if (repos[configIn.repos]) return configIn

  const config = Object.assign({}, configIn)
  config.serverUrl = (config.serverUrl || SERVER_URL || '').trim()
  config.token = (config.token || GITHUB_OAUTH_TOKEN || '').trim()
  config.account = (config.account || GITHUB_ACCOUNT || '').trim()
  config.project = (config.project || GITHUB_PROJECT || '').trim()
  config.repo = (config.repo || GITHUB_REPO || '').trim()

  if (!config.repo) {
    if (!(config.account && config.project)) throw new Error(`Repo is required`)
    config.repo = `${config.account}/${config.project}`
  }

  if (config.repo.indexOf('github.com/') !== -1) {
    config.repo = config.repo.replace(/.*github.com\//, '')
  }

  if (repos[config.repo]) return config

  repos[config.repo] = await isPrivate(config.repo, config.token)
  repos[config.repo].cacheByPath = { channel: {}, platform: {}, serverUrl: {} }

  if (repos[config.repo].private && !config.serverUrl) {
    let msg = `\nFor private repos we recommend setting serverUrl / SERVER_URL\n`
    msg += ` - If not set we will try to extract that info from each request\n`
    msg += ` - That isn't guaranteed to produce the correct return URL\n`
    msg += ` - That also adds overhead to each request\n`
    console.log(msg)
  }

  return config
}

const getReleaseList = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    return Promise.reject(ex)
  }

  const { repo, token } = config
  const rlsUrl = `${apiBaseUrl(repo)}/releases`
  const headers = getAuthHdrJson(token)
  const { data: releases, error } = await simpleGet(rlsUrl, { headers })

  if (error) return Promise.reject(error)

  repos[repo].releases = releases

  return Promise.resolve(releases)
}

const latestByChannel = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    return Promise.reject(ex)
  }

  const { repo } = config

  const releases = repos[repo].releases || await getReleaseList(config)
  const channels = repos[repo].channels = repos[repo].channels || {}

  const setLatestForChannel = (release, channel) => {
    release.channel = channel = channel.toLowerCase()
    const currentTag = (channels[channel] || {}).tag_name
    if (currentTag && semver.gt(currentTag, release.tag_name)) return
    channels[channel] = release
  }

  releases.forEach((r) => {
    const { tag_name: tag } = r
    const cleanTag = semver.valid(tag)

    if (!cleanTag) return

    const tagMeta = tag.indexOf('+') >= 0 ? tag.slice(tag.indexOf('+') + 1) : ''
    const tagPreAry = semver.prerelease(cleanTag) || []
    const tagPre = tagPreAry.find((p) => Number.isNaN(+p))
    const rlsPre = r.prerelease ? `prerelease` : null

    const channel = [tagMeta, tagPre, rlsPre].filter((c) => c).join('/')
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

const getPlatformUrl = () => {}

const getUpdateUrl = () => {}

const getReleasesUrl = () => {}

const getDownloadUrl = () => {}

const redirectToUrl = () => {}

const getChannel = (repo, channels, pathLower) => {
  const cached = repo.cacheByPath.channel[pathLower]
  if (cached) return cached

  let channel
  Object.entries(channels).forEach(([channelName, release]) => {
    if (!channelName || pathLower.indexOf(channelName) === -1) return
    if (!channel) return (channel = release)

    const useCurrent = channel.split('/').length > channelName.split('/').length
    channel = useCurrent ? channel : release
  })

  channel = channel || channels['']
  repo.cacheByPath.channel[pathLower] = channel

  return channel
}

const getPlatform = (repo, pathLower, channel, headers) => {
  const cached = repo.cacheByPath.platform[pathLower]
  if (cached) return cached

  let tmpPath = pathLower.replace(/^\/download|update/, '')
  if (channel.channel) tmpPath = tmpPath.replace(`/${channel.channel}`, '')

  const platform = tmpPath.split('/')[1] || guessPlatform(headers['user-agent'])
  repo.cacheByPath.platform[pathLower] = platform

  return platform
}

const getServerUrl = (repo, pathLower, req) => {
  const cached = repo.cacheByPath.serverUrl[pathLower]
  if (cached) return cached

  const { socket } = req
  const unsecure = socket.localPort === 80 || socket.remotePort === 80

  if (!req.headers.host) return

  const serverUrl = `${unsecure ? 'http' : 'https'}://${req.headers.host}`
  repo.cacheByPath.serverUrl[pathLower] = serverUrl

  return serverUrl
}

const requestHandler = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    return Promise.reject(ex)
  }

  const channels = await latestByChannel(config)
  const repo = repos[config.repo]

  let { serverUrl } = config

  const noContent = (res) => {
    res.statusCode = 204
    return res.end()
  }

  return (req, res) => {
    const { headers, url: path } = req
    const pathLower = path.toLowerCase()

    if (repo.private && !serverUrl) {
      serverUrl = getServerUrl(repo, pathLower, req)

      if (!serverUrl) {
        const err = new Error('Unable to determine serverUrl for private repo')
        console.error(err)

        return noContent(res)
      }
    }

    const isUpdate = !path.indexOf('/update')
    const isRelease = path.indexOf('/RELEASES') !== -1

    const channel = getChannel(repo, channels, pathLower)

    if (!channel) return noContent(res)

    const platform = getPlatform(repo, pathLower, channel, headers)

    if (!platform) return noContent(res)

    console.log('isUpdate', isUpdate)
    console.log('serverUrl', serverUrl)
    console.log('isRelease', isRelease)
    console.log('channel.tag_name', channel.tag_name)
    console.log('platform', platform)
    /* ROUTES
      /
      /download[/channel]
      /download[/channel]/:platform
      /update[/channel]/:platform/:version
      /update[/channel]/win32/:version/RELEASES
    */
  }
}

module.exports = {
  getReleaseList,
  latestByChannel,
  requestHandler,
  guessPlatform,
  getPlatformUrl,
  getUpdateUrl,
  getReleasesUrl,
  getDownloadUrl,
  redirectToUrl
}
