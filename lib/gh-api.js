'use strict'

const { get: httpsGet } = require('https')
const { repos } = require('jao')

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

const getReleaseList = async (config) => {
  const { repo, token } = config
  const rlsUrl = `${apiBaseUrl(repo)}/releases`
  const headers = getAuthHdrJson(token)
  const { data: releases, error } = await simpleGet(rlsUrl, { headers })

  if (error) return Promise.reject(error)

  repos[repo].releases = releases

  return Promise.resolve(releases)
}

module.exports = { isPrivate, getReleaseList }
