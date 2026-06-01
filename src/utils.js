const KoaTreeRouter = require('koa-tree-router')

const { readdir } = require('node:fs/promises')
const { join } = require('node:path')

function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

async function listFiles(dir, regex = null) {
    const files = await readdir(dir, {
        recursive: true,
        withFileTypes: true
    })

    return files.reduce((acc, file) => {
        if (file.isFile() && (!regex || file.name.match(regex))) {
            acc.push(join(file.parentPath, file.name))
        }
        return acc
    }, [])
}

function isObject(data) {
    return Object.prototype.toString.call(data) === '[object Object]'
}

// little abstraction over router methods used in this lib
const routerAbstractor = {
    // router instanciation
    create : routerConfig => routerConfig instanceof KoaTreeRouter ? routerConfig : new KoaTreeRouter(routerConfig),
    // router cleanup
    clean  : router => null,
    // routes creation for koa
    routes : router => router.routes(),
    // replaces {varname} with router parameter :varname
    path   : (router, path) => path.replace(/\{(.[^}]*)\}/g, ':$1'),
    // router event managment
    on     : (router, method, path, ...args) => router.on(method.toUpperCase(), path, ...args)
}

module.exports = {
    escapeHtml,
    listFiles,
    isObject,
    routerAbstractor
}
