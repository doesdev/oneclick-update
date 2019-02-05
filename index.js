'use strict'

const { get: httpsGet } = require('https')
const repos = {}

const {
  GITHUB_ACCOUNT,
  GITHUB_PROJECT,
  GITHUB_REPO,
  GITHUB_OAUTH_TOKEN
} = process.env

const uaHeader = () => ({ 'User-Agent': `oneclick-update` })
const authHeader = (token) => ({ Authorization: `token ${token}` })
const jsonHeader = () => ({ Accept: `application/json` })
const jsonAuth = (token) => Object.assign(
  authHeader(token),
  jsonHeader(),
  uaHeader()
)

const simpleGet = (url, opts = {}) => new Promise((resolve, reject) => {
  const { redirect } = opts
  httpsGet(url, opts, (res) => {
    console.log(url, res.statusCode)
    if (res.statusCode !== 302 || redirect === 'manual') return resolve(res)
    const location = res.headers.Location || res.headers.location
    return simpleGet(location, { redirect }).then(resolve)
  })
})

const isPrivate = async (repo, token) => {
  const url = `https://api.github.com/repos/${repo}`

  const res = await simpleGet(url)
  if (res.statusCode === 200) return { private: false }

  if (token) {
    const privRes = await simpleGet(url, { headers: jsonAuth(token) })
    if (privRes.statusCode === 200) return { private: true }
  }

  throw new Error(`Repo not found on Github: ${repo}`)
}

const getConfig = async (configIn = {}) => {
  const config = Object.assign({}, configIn)

  config.token = config.token || GITHUB_OAUTH_TOKEN
  config.account = config.account || GITHUB_ACCOUNT
  config.project = config.project || GITHUB_PROJECT
  config.repo = config.repo || GITHUB_REPO

  if (!config.repo) {
    if (!(config.account && config.project)) throw new Error(`Repo is required`)
    config.repo = `${config.account}/${config.project}`
  }

  if (config.repo.indexOf('https://github.com/') !== -1) {
    config.repo = config.repo.replace('https://github.com/', '')
  }

  if (repos[config.repo]) return config

  repos[config.repo] = await isPrivate(config.repo, config.token)

  return config
}

const getLatestRealase = async (config) => {
  try {
    config = await getConfig(config)
  } catch (ex) {
    console.error(ex)
  }
  console.log('config', config)
  console.log('repos', repos)
}

module.exports = { getLatestRealase }

getLatestRealase()
