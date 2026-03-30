const { writeFile, readFile } = require('node:fs/promises')
const { join } = require('node:path')

const rootDir = __dirname

const version = 'latest'
const url = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${version}`
const file = join(rootDir, '../src/docs/api-reference.js')
const readmeFile = join(rootDir, '../README.md')

console.log('Start update scalar JS API reference')

Promise
    .resolve()
    .then(async() => {
        console.log(`Download from ${url}`)
        const regexpVersion = /\/api-reference@([^/"'`]+)/

        const remote = await fetch(url).then(res => res.text())
        const remoteVersion = regexpVersion.exec(remote)[1]
        if (!remoteVersion) {
            throw new Error(`No version found in remote file ${url} (${regexpVersion.toString()})`)
        }

        const local = await readFile(file).then(res => res.toString())
        const localVersion = regexpVersion.exec(local)[1]
        if (!localVersion) {
            throw new Error(`No version found in local file ${file} (${regexpVersion.toString()})`)
        }

        if (local !== remote) {
            console.log(`Update available (${localVersion} -> ${remoteVersion})`)
            console.log(`Write new content in ${file}`)
            await writeFile(file, remote)

            // replace version in documentation
            console.log('Replace version in README.md file')
            const readme = await readFile(readmeFile).then(res => res.toString())
            const upd = readme.replace(/`api-reference@([^`]+)/, '`api-reference@' + remoteVersion)
            await writeFile(readmeFile, upd)
        } else {
            console.log(`Already at latest version (${localVersion})`)
        }

        console.log('Process done')
        process.exit(0)
    })
    .catch(err => {
        console.error(err)
        process.exit(1)
    })
