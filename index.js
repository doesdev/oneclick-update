'use strict'

const { get: httpsGet } = require('https')
const repos = {}

const {
  GITHUB_ACCOUNT,
  GITHUB_PROJECT,
  GITHUB_REPO,
  GITHUB_OAUTH_TOKEN
} = process.env

const hdrUa = { 'User-Agent': `oneclick-update` }
const hdrGhJson = { Accept: `application/vnd.github.v3+json` }
const uaJsonHeader = Object.assign({}, hdrUa, hdrGhJson)

const setUaJson = (h) => Object.assign({}, h, hdrUa, hdrGhJson)
const getAuthHdr = (token) => (token ? { Authorization: `token ${token}` } : {})
const getAuthHdrJson = (token) => setUaJson(getAuthHdr(token))

const apiBaseUrl = (repo) => `https://api.github.com/repos/${repo}`

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
  const noBody = true

  const res = await simpleGet(url, { headers: uaJsonHeader, noBody })
  if (res.statusCode === 200) return { private: false }

  if (token) {
    const headers = getAuthHdrJson(token)
    const privRes = await simpleGet(url, { headers, noBody })
    if (privRes.statusCode === 200) return { private: true }
  }

  throw new Error(`Repo not found on Github: ${repo}`)
}

const getConfig = async (configIn = {}) => {
  const config = Object.assign({}, configIn)

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

  return Promise.resolve(releases)
}

module.exports = { getReleaseList }
