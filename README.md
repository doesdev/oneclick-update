<div align="center">
  <img src="oneclick.png" alt="SCRUD" width="200" />
  <h1>Oneclick Update</h1>
  <a href="https://npmjs.org/package/oneclick-update">
    <img src="https://badge.fury.io/js/oneclick-update.svg" alt="NPM version" />
  </a>
  <a href="https://github.com/feross/standard">
    <img src="https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat" alt="js-standard-style" />
  </a>
</div>

# oneclick-update

> Simple installer downloads and update server

## What it does

Serves updates and installers following the common Squirrel + Electron pattern via Github releases.

In addition to the standard fare of these types of libraries it adds the ability to serve different release channels based on semver build metadata.

`1.0.0+channelName` -> `/download/channelName/win32`

It similarly handles prerelease channels, even prereleases on alternate channels.

`2.0.0-1` -> `/download/prerelease/win32`

`2.0.0-1+channelName` -> `/download/channelName/prerelease/win32`

## Why use this over [hazel](https://github.com/zeit/hazel), [nuts](https://github.com/GitbookIO/nuts), etc...

#### TL;DR (in order of design priorities)

- private repos are a first class citizen, not an afterthought
- it handles multiple builds of the same version (i.e. vendor specific builds)
- it has separate prerelease channels, even vendor specific prerelease channels
- it allows user defined platforms, for custom asset filtering
- It's a singular standalone script
- It has exactly 0 dependencies
- Serves `DMG` files for `download/darwin` routes
- It is maintained

#### Respect where due

Both nuts and hazel are great. I used nuts for the last couple years until I ran into some needs it didn't cover. Since it is scarcely maintained I thought I would patch in those needs to another library, hazel. That worked, but still left some things out I desired and patching those in would require major design changes that wouldn't make sense as a first time contributor to the project. I'm in a crunch to get out features and a fresh lib made the most sense to me.

All that to say, either is probably sufficient for most needs. Now that I've gotten that out of the way, the TL;DR above is why this ~~library~~ script is totes better ;)


## Where it is lacking

It currently only has built-in support for OSX and Windows. There are two reasons for this.

Firstly, the projects I need it for don't require \*nix builds.

Secondly, I have had difficulty finding consistent patterns in how \*nix builds are distributed amongst the Squirrel / Electron type of update libs.

Pull requests are very welcome or even just some guidance on common \*nix update distribution patterns.

## Install

Just running as a server, use any of these options to download the script. It's standalone.

- [CLICK HERE](https://raw.githubusercontent.com/doesdev/oneclick-update/master/index.js) and save the script where you please
- `curl -o oneclick.js https://raw.githubusercontent.com/doesdev/oneclick-update/master/index.js`

If you're using it as a module, you know the drill.

`npm i -s oneclick-update`

## Usage

Just running as a server, couldn't be simpler.

```sh
curl -o oneclick.js https://raw.githubusercontent.com/doesdev/oneclick-update/master/index.js
SET GITHUB_REPO=doesdev/oneclick-release-test
node oneclick.js
```

Using a private repo, also simple.
```sh
curl -o oneclick.js https://raw.githubusercontent.com/doesdev/oneclick-update/master/index.js
curl -o secrets.json https://raw.githubusercontent.com/doesdev/oneclick-update/master/secrets.example.json
# modify the secrets.json file with your Github oauth token, repo, port, and return URL
node oneclick.js
```

## Environment variables

- `GITHUB_REPO` - Path to Github repo (i.e. `doesdev/oneclick-update`)
- `GITHUB_OAUTH_TOKEN` - [Your Github oauth token](https://help.github.com/en/articles/git-automation-with-oauth-tokens)
- `PORT` - The port you want to run the server on
- `SERVER_URL` - The URL of the update server (for proxying private release assets)
- `REFRESH_CACHE` - Interval to check for new releases as string or ms (default `15 mins`)

## Routes

Detect platform via `user-agent` and download latest installer  
`/download[/channel][/prerelease]`

Download latest installer for specified platform  
`/download[/channel][/prerelease]/:platform`

Get update JSON for specified version, if version matches latest returns no content  
`/update[/channel][/prerelease]/:platform/:version`

Get RELEASES file with `nupkg` download info (Windows only)  
`/update[/channel][/prerelease]/win32/:version/RELEASES`

## API

```js
const { requestHandler } = require('oneclick-update')
const config = {
  repo: 'doesdev/oneclick-release-test',
  port: 8082,
  token: 'yourGithubOauthToken',
  serverUrl: 'https://updates.example.com',
  refreshCache: '15 mins',
  platformFilters: {},
  hostToChannel: {
    'updates.otherhost.com': {
      name: 'otherhost',
      serverUrl: 'https://updates.otherhost.com'
    }
  }
}

const startServer = async () => {
  const handler = await requestHandler(config)
  createServer(handler).listen(config.port, () => {
    console.log(`Update server running on port ${config.port}`)
  })
}

startServer()
```

## License

MIT © [Andrew Carpenter](https://github.com/doesdev)
