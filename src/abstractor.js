const { RouterError } = require('./errors.js')

const OPENAPI_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

class RouterAbstractor {
    constructor(routerInstance = null) {
        if (!routerInstance) {
            throw new RouterError('Router instance given in the RouterAbstractor constructor must not be null', 'abstractorError', {})
        }
        this.router = routerInstance
    }

    /**
     * Router cleanup
     *
     * @returns {void}
     */
    clean() {}

    /**
     * Returns koa middleware
     *
     * @returns {Function}
     */
    routes() {
        return this.router.routes()
    }

    /**
     * Replaces {varname} with router parameter :varname (or equivalent)
     *
     * @param {String} path
     * @returns {String}
     */
    path(path) {
        return path.replace(/\{(.[^}]*)\}/g, ':$1')
    }

    /**
     * Router event managment
     *
     * @param {String} method
     * @param {String} path
     * @param  {...any} args
     * @returns {void}
     */
    on(method, path, ...args) {
        method = method.toLowerCase()
        if (!OPENAPI_METHODS.includes(method)) {
            throw new RouterError(`HTTP method [${method}] is not allowed`, 'methodNotFound', {
                method,
                allowed: OPENAPI_METHODS
            })
        }
        this.router[method](path, ...args)
    }
}

module.exports = RouterAbstractor
