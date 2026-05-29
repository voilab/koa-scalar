const { readFile, writeFile, mkdtemp, readdir } = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { join, resolve, sep, basename, extname } = require('node:path')
const { tmpdir } = require('node:os')

const KoaTreeRouter = require('koa-tree-router')
const { dereference } = require('@scalar/openapi-parser')

const Validator = require('./validator.js')
const Parser = require('./parser.js')
const { RouterError } = require('./errors.js')

const rootDir = __dirname

const configValidatorSchema = {
    ctrlDir: 'string|convert|trim|empty:false',
    docDir: 'string|convert|trim|empty:false',
    version: 'string|convert|trim|empty:false',
    parseInput: 'boolean|convert|default:true',
    validateInput: 'boolean|convert|default:true',
    validateOutput: 'boolean|convert|default:false',
    routerConfig: 'object|optional',
    validatorConfig: 'object|optional',
    apiExplorer: {
        type: 'object',
        optional: true,
        properties: {
            envWhitelist: 'string[]|convert|optional',
            url: 'string|convert|trim|nullable:true|optional',
            rootUrl: 'string|convert|trim|nullable:true|optional',
            title: 'string|convert|trim|empty:false|default:Openapi specification',
            lang: 'string|convert|trim|empty:false|default:en',
            head: 'string|convert|nullable:true|optional',
            nonce: 'function|optional',
            config: 'object|optional'
        }
    }
}

async function loadMiddlewareModules(ctrlDir) {
    const path = resolve(join(ctrlDir, '/middleware'))
    if (!path.startsWith(ctrlDir + sep)) {
        throw new RouterError(`Path traversal detected: ${ctrlDir}`, 'middlewareLoadError', { ctrlDir })
    }
    const files = await readdir(path, {
        recursive: true,
        withFileTypes: true
    })

    return files.reduce((acc, file) => {
        if (file.isFile()) {
            const path = join(file.parentPath, file.name)
            const name = basename(file.name, extname(file.name))
            try {
                acc[name] = require(path)
            } catch (err) {
                throw new RouterError(`Unable to load middleware ${path}. Error is: ${err.message}`, 'middlewareLoadError', { path })
            }
        }
        return acc
    }, {})
}

function loadSecurityModules(schema, ctrlDir) {
    return Object.entries(schema.components?.securitySchemes || {}).reduce((acc, [name, securitySchema]) => {
        const path = resolve(join(ctrlDir, '/security', name))
        if (!path.startsWith(ctrlDir + sep)) {
            throw new RouterError(`Path traversal detected: ${name}`, 'securityLoadError', { name })
        }
        let mod
        try {
            mod = require(path)
        } catch (err) {
            throw new RouterError(`Unable to load security ${path}. Error is: ${err.message}`, 'securityLoadError', { path })
        }
        acc[name] = {
            schema: securitySchema,
            middleware: mod
        }
        return acc
    }, {})
}

function loadControllerModule(path, method, ctrlDir) {
    const modulePath = resolve(join(ctrlDir, path))
    if (!modulePath.startsWith(ctrlDir + sep)) {
        throw new RouterError(`Path traversal detected: ${path}`, 'moduleLoadError', { path })
    }
    let mod
    try {
        mod = require(modulePath)
    } catch (err) {
        throw new RouterError(`Unable to load ${modulePath}. Error is: ${err.message}`, 'moduleLoadError', { path })
    }
    if (!mod[method]) {
        throw new RouterError(`${modulePath}: Method ${method}() is not implemented!`, 'methodNotFound', { path, method })
    }
    return mod
}

function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

// little abstraction over router methods used in this lib
const routerAbstractor = {
    create : routerConfig => routerConfig instanceof KoaTreeRouter ? routerConfig : new KoaTreeRouter(routerConfig),
    clean  : router => null,
    routes : router => router.routes(),
    on     : (router, method, path, ...args) => router.on(method.toUpperCase(), path, ...args)
}

module.exports = class Router {

    constructor(options = {}) {
        this.validator = new Validator(options.validatorConfig)

        const configValidatorResult = this.validator.compile(configValidatorSchema)(options)
        if (configValidatorResult !== true) {
            throw new RouterError('Config validation error', 'configValidationError', configValidatorResult)
        }

        const {
            ctrlDir,
            docDir,
            version,
            parseInput,
            validateInput,
            validateOutput,
            apiExplorer = {},
            routerConfig = {}
        } = options

        this.router = routerAbstractor.create(routerConfig)

        this.parser = new Parser({ docDir })
        this.ctrlDir = resolve(ctrlDir)
        this.rootDir = rootDir
        this.version = version
        this.apiExplorer = apiExplorer
        this.parseInput = parseInput
        this.validateInput = validateInput
        this.validateOutput = validateOutput
    }

    clean() {
        routerAbstractor.clean(this.router)
        this.router = null
        this.validator.clean()
        this.validator = null
        this.parser.clean()
        this.parser = null
        this.apiExplorer = {}
    }

    async build() {
        const openapi = await this.parser.parse()

        const { schema, errors } = await dereference(openapi)
        if (errors.length) {
            throw new RouterError(`Found ${errors.length} error(s) when dereferencing OpenAPI schema`, 'schemaDereferenceError', { errors })
        }

        const securitySchemes = loadSecurityModules(schema, this.ctrlDir)
        const middlewaresModules = await loadMiddlewareModules(this.ctrlDir)

        for (let [path, methods] of Object.entries(schema.paths || [])) {
            path = join('/', this.version, path)

            for (let [method, data] of Object.entries(methods)) {
                const modulePath = path.replace(/\{(.[^}]*)\}/g, '_$1')
                const routePath = path.replace(/\{(.[^}]*)\}/g, ':$1')
                method = method.toLowerCase()

                const mod = loadControllerModule(modulePath, method, this.ctrlDir)

                const middlewares = []

                const securities = data.security || []
                for (const security of securities) {
                    for (const [name, options] of Object.entries(security)) {
                        const scheme = securitySchemes[name]
                        if (!scheme) {
                            throw new RouterError(`Security scheme ${name} is not defined in components/securitySchemes`, 'securityNotFound', {
                                modulePath,
                                method
                            })
                        }
                        middlewares.push(scheme.middleware(options, scheme.schema))
                    }
                }

                if (Array.isArray(data['x-middleware'])) {
                    for (const entry of data['x-middleware']) {
                        const mw = typeof entry === 'string' ? { name: entry } : entry
                        if (!middlewaresModules[mw.name]) {
                            throw new RouterError(`Middleware ${mw.name} not found in /middleware directory`, 'middlewareNotFound', {
                                name: mw.name,
                                modulePath,
                                method
                            })
                        }
                        middlewares.push(middlewaresModules[mw.name](mw.options || {}))
                    }
                }

                const inputValidatorSchema = this.validateInput ? this.validator.getInputValidatorSchema(data) : null
                const outputValidatorSchema = this.validateOutput ? this.validator.getOutputValidatorSchema(data) : null

                middlewares.push(async koaCtx => {
                    if (this.parseInput) {
                        this.parser.parseParameters(koaCtx, data)
                    }
                    if (this.validateInput) {
                        await this.validator.validateInput(koaCtx, inputValidatorSchema)
                    }

                    await mod[method](koaCtx)

                    if (this.validateOutput) {
                        await this.validator.validateOutput(koaCtx, outputValidatorSchema)
                    }
                })

                routerAbstractor.on(this.router, method, routePath, ...middlewares)
            }
        }

        await this.buildApiExplorer(openapi)
    }

    async buildApiExplorer(openapi) {
        if (!this.apiExplorer.url) {
            return
        }

        const pathDoc = this.apiExplorer.url
        const localDocDir = join(this.rootDir, '/docs')
        const whitelist = new Set(this.apiExplorer.envWhitelist || [])

        // replace environment vars
        const openapiString = JSON
            .stringify(openapi)
            .replace(/%env\(([^)]+)\)%/g, (match, envKey) => {
                const [defaultEnv, usedEnv] = envKey.split(':')
                const key = usedEnv || defaultEnv
                const value = process.env[key] ?? process.env[defaultEnv] ?? ''
                return whitelist.has(key) ? value : match
            })

        const tmpDir = await mkdtemp(`${tmpdir()}/node-koa-scalar-`)

        // write data to disk to avoid exessive RAM usage
        const openapiTmpFile = join(tmpDir, 'openapi.json')
        await writeFile(openapiTmpFile, openapiString)

        // manage index.html scalar file
        const index = (await readFile(join(localDocDir, 'index.html')))
            .toString()
            .replace(/\{lang\}|\{title\}|<!-- \{head\} -->|\{path\}|\/\/ \{config\},/g, match => {
                switch (match) {
                    case '{lang}': {
                        if (this.apiExplorer.lang && !/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(this.apiExplorer.lang)) {
                            throw new RouterError('Invalid lang tag', 'configValidationError')
                        }
                        return this.apiExplorer.lang
                    }
                    case '{title}': return escapeHtml(this.apiExplorer.title)
                    case '<!-- {head} -->': return (this.apiExplorer.head || '').replace(/<\/head>/gi, '<\\/head>')
                    case '{path}': return escapeHtml((this.apiExplorer.rootUrl || '') + pathDoc)
                    case '// {config},': return `...${JSON.stringify(this.apiExplorer.config || {}).replace(/<\/script>/gi, '<\\/script>')},`
                    default:
                        return match // fallback (should not be reached)
                }
            })

        // write data to disk to avoid exessive RAM usage
        const indexTmpFile = join(tmpDir, 'index.html')
        await writeFile(indexTmpFile, index)

        routerAbstractor.on(this.router, 'get', pathDoc, async koaCtx => {
            // add nonce
            const file = (await readFile(indexTmpFile))
                .toString()
                .replace(/\{nonce\}/g, match => {
                    switch (match) {
                        case '{nonce}': return this.apiExplorer.nonce ? this.apiExplorer.nonce(koaCtx) : ''
                        default:
                            return match // fallback (should not be reached)
                    }
                })

            koaCtx.set('Content-Type', 'text/html')
            koaCtx.body = file
        })

        routerAbstractor.on(this.router, 'get', join(pathDoc, '/api-reference.js'), async koaCtx => {
            const stream = createReadStream(join(localDocDir, '/api-reference.js'))
            koaCtx.set('Content-Type', 'text/javascript')
            koaCtx.body = stream
        })

        routerAbstractor.on(this.router, 'get', join(pathDoc, '/api-reference.json'), async koaCtx => {
            const stream = createReadStream(openapiTmpFile)
            koaCtx.set('Content-Type', 'application/json')
            koaCtx.body = stream
        })
    }

    routes() {
        return routerAbstractor.routes(this.router)
    }
}
