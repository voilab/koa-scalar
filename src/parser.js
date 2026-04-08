const { readFile, readdir } = require('node:fs/promises')
const { join, resolve } = require('node:path')

const { parse } = require('yaml')
const { get, set, merge } = require('lodash')
const { validate } = require('@scalar/openapi-parser')

const { ParserError } = require('./errors.js')

function getKoaParameterSource(koaCtx, type) {
    if (type === 'path') {
        return koaCtx.params
    }
    if (type === 'query') {
        return koaCtx.request.query
    }
    if (type === 'header') {
        return koaCtx.request.headers
    }
    if (type === 'cookie') {
        return koaCtx.request.cookies
    }
    throw new ParserError(`Type ${type} unknown in koa context`, 'koaContextNotFound')
}

async function listFiles(dir, regex) {
    const files = await readdir(dir, {
        recursive: true,
        withFileTypes: true
    })

    return files.reduce((acc, file) => {
        if (file.isFile() && file.name.match(regex)) {
            acc.push(join(file.parentPath, file.name))
        }
        return acc
    }, [])
}

function isObject(data) {
    return Object.prototype.toString.call(data) === '[object Object]'
}

module.exports = class Parser {

    constructor({ docDir } = {}) {
        this.rootDir = resolve(docDir)
    }

    clean() {
        this.rootDir = null
    }

    async parse(loose = true) {
        const files = await listFiles(this.rootDir, /\.(ya?ml|json)$/i)

        const openapi = {}

        for await (const file of files) {
            try {
                // get file content as POJO
                const rawContent = (await readFile(file)).toString()
                const content = file.match(/\.json$/i) ? JSON.parse(rawContent) : parse(rawContent)

                // get path after rootDir
                const path = file.substring(this.rootDir.length + 1, file.lastIndexOf('.')).replace(/\//g, '.')

                // get parent path after rootDir
                const parts = path.split('.')
                const last = parts.pop()
                if (last === 'index') {
                    parts.pop()
                }
                const parentPath = parts.length && ['paths'].includes(parts[0])
                    ? parts[0] // special paths that flatten subfolders
                    : parts.join('.')

                // add content to main openapi data
                if (parentPath) {
                    const parent = get(openapi, parentPath, {})
                    set(openapi, parentPath, merge(parent, content))
                } else {
                    merge(openapi, content)
                }
            } catch (err) {
                throw new ParserError(`Error parsing file ${file}: ${err.message}`, 'fileParseError')
            }
        }

        const { valid, errors } = await validate(openapi)
        // valid can be false with no error, in case of missing schemas. These errors
        // will be detailed through the dereference call in router.js
        if (!valid && (!loose || errors.length)) {
            throw new ParserError(`Openapi specification is not valid (${valid}). ${errors.length} error(s) found`, 'schemaNotValid', errors)
        }

        return openapi
    }

    parseParameters(koaCtx, pathSchema) {
        if (!pathSchema.parameters) {
            return
        }
        const separators = {
            path: {},
            query: {
                form: ',',
                spaceDelimited: ' ',
                pipeDelimited: '|',
                $default: ','
            },
            header: {
                simple: ',',
                $default: ','
            },
            cookie: {
                form: ',',
                $default: ','
            }
        }

        // create real arrays and objects from structured strings
        // koaCtx is mutated if some parameters need transformation
        for (const parameter of pathSchema.parameters) {
            const source = getKoaParameterSource(koaCtx, parameter.in)
            const key = parameter.name

            // when param is defined as array with brackets, do the replacement automatically
            if (parameter.schema?.type === 'array' && !source[key] && source[`${key}[]`]) {
                source[key] = source[`${key}[]`]
                source[`${key}[]`] = undefined
            }

            const value = source[key]
            if (!value) {
                // required validation is done in validator validateInput middleware
                return
            }
            if (parameter.content) {
                if (parameter.content['application/json']) {
                    try {
                        // data structure validation is done in validator validateInput middleware
                        source[key] = !isObject(value)
                            ? JSON.parse(value)
                            : value
                    } catch (err) {
                        throw new ParserError(`Parameter ${key} cannot be parsed from JSON to object`, 'parameterUnserializable', {
                            key,
                            value,
                            error: err.message
                        })
                    }
                }
            } else if (parameter.schema?.type === 'array' && !Array.isArray(value)) {
                const separator = separators[parameter.in]
                source[key] = value.split(separator[parameter.style || separator.$default])
            } else if (parameter.schema?.type === 'object' && !isObject(value)) {
                const separator = separators[parameter.in]
                const data = value.split(separator[parameter.style || separator.$default])
                source[key] = {}
                for (let i = 0; i < data.length; i += 2) {
                    source[key][data[i]] = data[i + 1]
                }
            }
        }
    }
}
