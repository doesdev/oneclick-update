'use strict'

const guessPlatform = (ua = '') => {
  const uaPlatform = ((ua.match(/\((.+?)\)/) || [])[1] || '').toLowerCase()

  if (uaPlatform && uaPlatform.indexOf('windows') !== -1) return 'win32'
  if (uaPlatform && uaPlatform.indexOf('mac') !== -1) return 'darwin'

  return null
}

const filterByExt = (assets, ext) => {
  ext = ext.charAt(0) === '.' ? ext : `.${ext}`
  const extLen = ext.length
  return assets.filter((a) => a.name.indexOf(ext) === a.name.length - extLen)
}

const firstForArch = (assets, arch) => {
  assets.sort((a, b) => {
    a = a.name.indexOf('64') === -1 ? -1 : 1
    b = b.name.indexOf('64') === -1 ? -1 : 1
    return a - b
  })

  return arch === 'x64' ? assets[assets.length - 1] : assets[0]
}

const getPlatform = (repo, pathLower, channel, headers) => {
  const cached = repo.cacheByPath.platform[pathLower]
  if (cached) return cached

  let tmpPath = pathLower.replace(/^\/download|\/update/, '')
  if (channel.channel) tmpPath = tmpPath.replace(`/${channel.channel}`, '')

  const platform = tmpPath.split('/')[1] || guessPlatform(headers['user-agent'])
  repo.cacheByPath.platform[pathLower] = platform

  return platform
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
      if ((assets = filterByExt(assets, ext)).length < 2) return assets[0]
      return firstForArch(assets, arch)
    }

    const actions = { download, update: download, release }

    return actions[action] ? actions[action]() : null
  },
  darwin: (assets, action = 'download', arch, ext = 'dmg') => {
    const download = () => {
      let asset
      if (ext === 'dmg' && (asset = filterByExt(assets, 'dmg')[0])) return asset

      if ((assets = filterByExt(assets, 'zip')).length < 2) return assets[1]

      assets = assets.filter((a) => a.name.match(/mac|osx|darwin/i))

      if (assets.length < 2) return assets[0]

      return assets.filter((a) => a.name.indexOf('symbols') === -1)[0]
    }

    const update = () => {
      ext = 'zip'
      return download()
    }

    const actions = { download, update }

    return actions[action] ? actions[action]() : null
  }
}

const getPlatformAsset = (config, repo, channel, platform, action, arch) => {
  const assets = channel.assets.slice(0)
  let asset

  if (!config.platformFilters[platform] && !platformFilters[platform]) return

  if (config.platformFilters && config.platformFilters[platform]) {
    asset = config.platformFilters[platform](assets, action, arch)
  }

  asset = asset || platformFilters[platform](assets, action, arch)

  return asset
}

module.exports = { getPlatform, getPlatformAsset }
