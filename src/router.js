const { readFile, writeFile, mkdtemp } = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { join, resolve } = require('node:path')
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
            url: 'string|convert|trim|nullable:true|optional',
            rootUrl: 'string|convert|trim|nullable:true|optional',
            title: 'string|convert|trim|empty:false|default:Openapi specification',
            lang: 'string|convert|trim|empty:false|default:en',
            head: 'string|convert|nullable:true|optional',
            config: 'object|optional'
        }
    }
}

function loadSecurityModules(schema, ctrlDir) {
    return Object.entries(schema.components?.securitySchemes || {}).reduce((acc, [name, securitySchema]) => {
        const path = join(ctrlDir, '/security', name)
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
    const modulePath = join(ctrlDir, path)
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

module.exports = class Router {

    constructor(options = {}) {
        this.validator = new Validator(options.validatorConfig)

        const configValidatorResult = this.validator.validator.compile(configValidatorSchema)(options)
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

        this.router = routerConfig instanceof KoaTreeRouter
            ? routerConfig
            : new KoaTreeRouter(routerConfig)

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
        this.validator.clean()
        this.validator = null
        this.router = null
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

        for (let [path, methods] of Object.entries(schema.paths || [])) {
            path = join(this.version, path)

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

                this.router.on(method.toUpperCase(), routePath, ...middlewares)
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

        // replace environment vars
        const openapiString = JSON
            .stringify(openapi)
            .replace(/%env\(([^)]+)\)%/g, (match, envKey) => {
                const [defaultEnv, usedEnv] = envKey.split(':')
                return process.env[usedEnv || defaultEnv] || ''
            })

        // write data to disk to avoid exessive RAM usage
        const openapiTmpFile = (await mkdtemp(`${tmpdir()}/node-koa-scalar-openapi'`)) + '.json'
        await writeFile(openapiTmpFile, openapiString)

        // manage index.html scalar file
        const index = (await readFile(join(localDocDir, 'index.html')))
            .toString()
            .replace(/\{lang\}|\{title\}|<!-- \{head\} -->|\{path\}|\/\/ \{config\},/g, match => {
                switch (match) {
                    case '{lang}': return this.apiExplorer.lang
                    case '{title}': return this.apiExplorer.title
                    case '<!-- {head} -->': return this.apiExplorer.head || ''
                    case '{path}': return (this.apiExplorer.rootUrl || '') + pathDoc
                    case '// {config},': return `...${JSON.stringify(this.apiExplorer.config || {})},`
                    default:
                        return match // fallback (should not be reached)
                }
            })

        // write data to disk to avoid exessive RAM usage
        const indexTmpFile = (await mkdtemp(`${tmpdir()}/node-koa-scalar-index-`)) + '.html'
        await writeFile(indexTmpFile, index)

        this.router.get(pathDoc, async koaCtx => {
            const stream = createReadStream(indexTmpFile)
            koaCtx.set('Content-Type', 'text/html')
            koaCtx.body = stream
        })

        this.router.get(join(pathDoc, '/api-reference.js'), async koaCtx => {
            const stream = createReadStream(join(localDocDir, '/api-reference.js'))
            koaCtx.set('Content-Type', 'text/javascript')
            koaCtx.body = stream
        })

        this.router.get(join(pathDoc, '/api-reference.json'), async koaCtx => {
            const stream = createReadStream(openapiTmpFile)
            koaCtx.set('Content-Type', 'application/json')
            koaCtx.body = stream
        })
    }

    routes() {
        return this.router.routes()
    }
}
