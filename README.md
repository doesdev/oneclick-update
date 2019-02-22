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

## Why use this over [hazel](https://github.com/zeit/hazel), [nuts](https://github.com/GitbookIO/nuts), etc...

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

## Routes

## API

## License

MIT © [Andrew Carpenter](https://github.com/doesdev)
