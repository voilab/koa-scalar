const FastestValidator = require('fastest-validator')

const { ValidatorError } = require('./errors.js')

function getStringTypeFromFormat(schema) {
    if (schema.enum) {
        // special case for enum
        return 'enum'
    }

    const format = (schema.format || '').split('|').shift()

    if (['email', 'equal', 'luhn', 'mac', 'uuid'].includes(format)) {
        return format
    }
    if (['date', 'date-time', 'datetime', 'timestamp'].includes(format)) {
        return 'date'
    }
    if (['uri', 'url'].includes(format)) {
        return 'url'
    }
    return 'string'
}

function setPropsFromFormat(props, type, formatWithOptions) {
    const valids = {
        'array': [
            'empty', 'contains', 'length', 'convert'
        ],
        'email': [
            'empty', 'mode', 'normalize'
        ],
        'equal': [
            'value', 'strict'
        ],
        'number': [
            'equal', 'notEqual', 'positive', 'negative', 'convert'
        ],
        'object': [
            'strict'
        ],
        'string': [
            'alpha', 'alphanum', 'numeric', 'alphadash', 'contains',
            'hex', 'singleLine', 'base64', 'empty',
            'trim', 'trimLeft', 'trimRight', 'length',
            'padStart', 'padEnd', 'padChar',
            'lowercase', 'uppercase', 'localeLowercase', 'localeUppercase',
            'convert'
        ],
        'url': [
            'empty'
        ],
        'uuid': [
            'version'
        ]
    }

    const formats = (formatWithOptions || '').split('|').map(f => {
        const [filter, value = undefined ] = (f || '').split(':')
        return {
            filter,
            value: value !== undefined ? value : true
        }
    })

    const valid = valids[type] || []
    const transform = { 'true': true, 'false': false, 'null': null, 'undefined': undefined }

    for (const { filter, value } of formats) {
        if (valid.includes(filter)) {
            props[filter] = transform[value] !== undefined ? transform[value] : value
        }
    }
}

module.exports = class Validator {

    constructor(config = {}) {
        this.validator = config instanceof FastestValidator
            ? config
            : new FastestValidator(config)
    }

    clean() {
        this.validator = null
    }

    getInputValidatorSchema(data) {
        const schema = (data.parameters || []).reduce((acc, param) => {
            const paramSchema = (param.content && param.content['application/json']?.schema) || param.schema
            if (!paramSchema) {
                return acc
            }
            try {
                if (!acc[param.in]) {
                    acc[param.in] = {
                        type: 'object',
                        properties: {}
                    }
                }
                acc[param.in].properties[param.name] = this.matchSchema(paramSchema, {
                    mode: 'write',
                    required: param.required
                })
            } catch (err) {
                throw new ValidatorError(`Error in matchSchema for param [${param.name}]: ${err.message}`, 'generalError', {
                    key: param.name,
                    param,
                    error: err
                })
            }
            return acc
        }, {
            $$async: true
        })

        if (data.requestBody?.content && data.requestBody.content['application/json']) {
            const param = data.requestBody.content['application/json']
            schema.body = this.matchSchema(param.schema, {
                mode: 'write',
                required: data.requestBody.required
            })
        }

        return this.validator.compile(schema)
    }

    async validateInput(koaCtx, schema) {
        // koaCtx is mutated through schema validators
        const result = await schema({
            path: koaCtx.params,
            query: koaCtx.request.query,
            header: koaCtx.request.headers,
            cookie: koaCtx.request.cookies,
            body: koaCtx.request.body
        })

        if (result !== true) {
            const messages = result.map(r => r.message).join(', ')
            throw new ValidatorError(`Input parameters validation error: ${messages}`, 'parameterValidationError', result)
        }
    }

    getOutputValidatorSchema(data) {
        return Object.entries(data.responses || {}).reduce((acc, [code, response]) => {
            const schema = {
                $$async: true
            }
            if (response.content && response.content['application/json']) {
                const param = response.content['application/json']
                schema.body = this.matchSchema(param.schema, {
                    mode: 'read',
                    required: true
                })
            }
            if (response.headers) {
                schema.header = {
                    type: 'object',
                    properties: Object.entries(response.headers).reduce((acc, [key, param]) => {
                        acc[key] = this.matchSchema(param.schema, {
                            mode: 'read',
                            required: param.required
                        })
                        return acc
                    }, {})
                }
            }
            if (Object.keys(schema).length > 1) {
                acc[code] = this.validator.compile(schema)
            }
            return acc
        }, {})
    }

    async validateOutput(koaCtx, schema) {
        const schemaUsed = schema[koaCtx.status] || schema.default

        if (!schemaUsed) {
            return
        }
        // koaCtx is mutated through schema validators
        const result = await schemaUsed({
            header: koaCtx.headers,
            body: koaCtx.body
        })

        if (result !== true) {
            const messages = result.map(r => r.message).join(', ')
            throw new ValidatorError(`Output parameters validation error: ${messages}`, 'parameterValidationError', result)
        }
    }

    matchSchema(baseSchema, config = {}) {
        const schemas = baseSchema.oneOf || baseSchema.anyOf || [baseSchema]

        const propsDef = schemas.reduce((acc, schema) => {
            const types = Array.isArray(schema.type) ? schema.type : [schema.type]
            const notNullTypes = types.filter(type => type !== null)

            const baseProps = {
                nullable: !!schema.nullable || types.length > notNullTypes.length,
                optional: !config.required,
                default: schema.default
            }

            for (const type of notNullTypes) {
                const props = { ...baseProps }

                props.type = (config.mode === 'write' && schema.readOnly) || (config.mode === 'read' && schema.writeOnly)
                    ? 'forbidden'
                    : type

                switch (props.type) {
                    case 'integer':
                    case 'number':
                        props.type = 'number'
                        props.convert = true
                        setPropsFromFormat(props, props.type, schema.format)
                        props.integer = type === 'integer'
                        props.min = schema.minimum
                        props.max = schema.maximum
                        break
                    case 'string':
                        props.type = getStringTypeFromFormat(schema)
                        props.convert = true
                        setPropsFromFormat(props, props.type, schema.format)
                        props.min = schema.minLength
                        props.max = schema.maxLength
                        props.pattern = schema.pattern
                        props.values = schema.enum?.filter(value => value !== null)
                        break
                    case 'boolean':
                        props.type = 'boolean'
                        props.convert = true
                        setPropsFromFormat(props, props.type, schema.format)
                        break
                    case 'array':
                        props.type = 'array'
                        props.convert = true
                        setPropsFromFormat(props, props.type, schema.format)
                        props.min = schema.minItems
                        props.max = schema.maxItems
                        props.unique = schema.uniqueItems
                        props.items = this.matchSchema(schema.items, config)
                        break
                    case 'object':
                        props.type = 'object'
                        setPropsFromFormat(props, props.type, schema.format)
                        props.minProps = schema.minProperties
                        props.maxProps = schema.maxProperties
                        props.properties = Object
                            .entries(schema.properties || {})
                            .reduce((p, [key, value]) => {
                                p[key] = this.matchSchema(value, {
                                    ...config,
                                    required: (schema.required || []).includes(key)
                                })
                                return p
                            }, {})
                        break
                    case 'forbidden':
                        props.type = 'forbidden'
                        props.remove = true
                        break
                    case 'any':
                    case '':
                    case null:
                    case undefined:
                        props.type = 'any'
                        break
                    default: {
                        throw new ValidatorError(
                            `Type ${schema.type} doesn't exists in [matchSchema] method. Use one of [integer, number, string, boolean, array, object, any]`,
                            'schemaTypeMismatch',
                            schema
                        )
                    }
                }

                acc.push(props)
            }
            return acc
        }, [])

        return propsDef.length === 1 ? propsDef[0] : propsDef
    }
}
