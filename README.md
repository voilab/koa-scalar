# Koa Scalar

## Introduction

This is a router for Koa, which parses a local directory of Openapi@3 files (`yaml` or `json`) to automatically generate routes and parameters validation (input and output).

- [Dependencies](#dependencies)
- [Basic usage](#basic-usage)
- [Configurations](#configurations)
- [Router abstraction](#router-abstraction)
- [Controllers and folders structure](#controllers-folders-structure)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Contribution](#contribution)
- [License](#license)

## Dependencies

| Dependency | Dependency type | What for? |
| --- | --- | --- |
| **koa** | Peer | used as main web framework |
| **{koa compatible router}** | Peer | used for routing. You can pick the one you want |
| **@scalar/openapi-parser** | Main | used for Openapi@3 validation, dereferencing, and web client documentation |
| **fastest-validator** | Main | used for parameters validation |
| **lodash** | Secondary | used for simplifing POJO manipulation (through `get`, `set` and `merge` exclusively) |
| **yaml** | Secondary | used to translate `*.yaml` files to POJO |

## Basic usage

```js
// index.js
const Koa = require('koa')
const KoaTreeRouter = require('koa-tree-router') // example with KoaTreeRouter
const { Router } = require('voilab/koa-scalar')

const app = new Koa()

const router = new Router({
  docDir: './openapi',
  ctrlDir: './controllers',
  version: 'v1',
  router: new KoaTreeRouter(),
  apiExplorer: {
    url: '/docs'
  }
})

// builds routes based on Openapi specification
router.build()
  .then(() => {
    // add these routes to koa
    app.use(router.routes())

    app.listen(3000)
    console.log('Documentation available on http://localhost:3000/docs')
    console.log('API available on http://localhost:3000/v1')
  })
  .catch(err => {
    console.error(err)
  })
```

## Configurations

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| docDir | `string` | `yes` || Relative or absolute path to Openapi specification files |
| ctrlDir | `string` | `yes` || Relative or absolute path to javascript controller files |
| version | `string` | `yes` || API version name |
| router | `object` | `yes*` | `undefined` | Instance of a koa compatible router. Optional if `routerAbstractor` is set |
| routerAbstractor | `RouterAbstractor` | `yes*` | `undefined` | Class which abstracts all methods used by the router in this lib. Optional if `router` is set |
| parseInput | `boolean` | `no` | `true` | Parse arrays and objects input parameters when they are defined as strings |
| validateInput | `boolean` | `no` | `true` | Validate input against Openapi definition before controller is called |
| validateOutput | `boolean` | `no` | `false` | Validate koa body content against Openapi response definition  |
| apiExplorer | `object` | `no` | `{}` | Api explorer documentation configuration |
| apiExplorer.**url** | `string` | `no` | `undefined` | Path url to documentation |
| apiExplorer.**rootUrl** | `string` | `no` | `undefined` | Root path url used for loading api reference js script in some edge cases |
| apiExplorer.**envWhitelist** | `string[]` | `no` | `[]` | Names of env vars, allowed to be replaced in documentation |
| apiExplorer.**title** | `string` | `no` | `undefined` | Documentation title |
| apiExplorer.**lang** | `string` | `no` | `undefined` | HTML tag language code |
| apiExplorer.**head** | `string` | `no` | `undefined` | Custom &lt;head&gt; for documentation (CSS mainly) |
| apiExplorer.**nonce** | `function` | `no` | `undefined` | Function with koa context as first argument, which returns the nonce |
| apiExplorer.**config** | `object` | `no` | vendor defaults| Custom configuration for `Scalar` (documentation on [Github](https://github.com/scalar/scalar/blob/main/documentation/configuration.md)) |
| validatorConfig | `object` | `no` | vendor defaults | Custom configuration for (or instance of) `FastestValidator` (documentation on [Github](https://github.com/icebob/fastest-validator])) |

> yes*:  One of `router` or `routerAbstractor` is needed.

## Router abstraction

The routers which have served as a base for this lib were `koa-tree-router` and `@koa/router`. But every method used here are abstracted,
so you should be able to use any other router available for `koa`.

You can safely use only `router` config if you use one of the tworouters abov. If you have another router, you may want to use the
`routerAbstractor` config.

### By router config

Use `router` config to just give an instance of your router. If the default abstractor is compatible, you
don't have to code anything else.

```js
const KoaTreeRouter = require('koa-tree-router') // example with KoaTreeRouter
const { Router } = require('voilab/koa-scalar')

const router = new Router({
  router: new KoaTreeRouter()
})
```

### By adapting the abstractor

If your router have different needs, the abstractor will need adjustment, by overriding methods.

```js
const { Router, RouterAbstractor } = require('voilab/koa-scalar')

class VerySpecialRouterAbstractor extends RouterAbstractor {
  constructor(router = null) {
    super(router ?? new VerySpecialRouter())
  }
  routes() {
    return this.router.middleware()  // some routers expose middleware() instead of routes()
  }
  path(path) {
    return path.replace(/\{(.[^}]*)\}/g, '<$1>')  // some routers use <param> instead of :param
  }
}

const router = new Router({
  routerAbstractor: new VerySpecialRouterAbstractor()
})
```

## Controllers folders structure

Consider Openapi documentation files such as this:

```
openapi
|-- index.yaml
|-- paths
    |-- users
        |-- search.yaml
```

Where the two files content are:

```yaml
# ./openapi/index.yaml
openapi: 3.1.1
info:
  title: Koa router test
  description: Koa router
security:
  - bearerAuth: []
servers:
  - url: /v1 # server must contain the version number

# ./openapi/paths/users/search.yaml
/users/search:
  head:
    summary: Count users
    security:
      - bearerAuth: []
  get:
    summary: Search users
    security:
      - bearerAuth: []
    x-middlewares:
      - custom
```

And a router config like that:

```js
const router = new Router({
  docDir: './openapi',
  ctrlDir: './controllers',
  version: 'v1',
  router: new KoaTreeRouter()
})
```

Controllers folder will look like this:

```
controllers
|-- middlewares
|   |-- custom.js
|-- security
|   |-- bearerAuth.js
|-- v1
    |-- users
        |-- search.js
```

The security module exports a function, itself returning a standard koa middleware:

```js
// ./controllers/security/bearerAuth.js
module.exports = (options, schema) => (ctx, next) => {
  console.log('bearer', options, schema, ctx.params)
  return next()
}
```

The defined route exports each HTTP lowercased method as a standard koa middleware:

```js
// ./controllers/v1/users/search.js
const { countUsers, listUsers } = require('some/user/service.js')

module.exports = {
  async head(ctx) {
    ctx.set('X-Total-Count', await countUsers())
    ctx.status = 204
  },
  async get(ctx) {
    ctx.body = await listUsers()
  }
}
```

### Middlewares

Middlewares modules are defined in the Openapi file like this. You can either just put
the name, or an object with name and options (which is itself an object).

```yaml
/test:
  get:
    x-middlewares:
      - name: koaBody
        options:
          limit: 50mb
      - custom
```

In controller folder structure, middlewares are placed inside `middlewares` subfolder (see controller folder
structure above).

The middleware consists of a function returning a standard koa middleware. The config argument is always an
object (it cannot be null or undefined).

```js
// ./controllers/middlewares/koaBody.js
const koaBody = require('koa-body')

module.exports = config => koaBody({
  includeUnparsed: true,
  ...config
})

// ----------------------------------------------

// ./controllers/middlewares/custom.js
module.exports = config => (ctx, next) => {
  console.log('my custom middleware')
  return next()
}
```

## Limitations

### Fixed Scalar API reference version

The version shipped with this library is fixed to `api-reference@1.59.3`.

If you need an other version, you will need to fork this repository and replace the file `/src/docs/api-reference.js`, and maybe `/src/docs/index.html` if this is needed by the new javascript version.

You can use the script `npm run scalar-update` to automatically download the latest Scalar API reference.

### Validation limited to Content-Type application/json

Openapi@3 lets you configure different content types for requests and responses bodies (`application/json`, `application/xml` and so on).
Only `application/json` is taken into account regarding validation.

### CSP and API explorer

If you have CSP enabled, you must accept inline stylesheets, since Scalar imports dynamically (and without nonce)
the Tailwind CSS.

For the inline javascript of the HTML index file, you can pass the nonce at config time:

```js
const router = new Router({
  docDir: './openapi',
  ctrlDir: './controllers',
  version: 'v1',
  router: new KoaTreeRouter(),
  apiExplorer: {
    nonce: koaCtx => koaCtx.state.myNonce // use any system you want to generate the nonce
  }
})
```

Check [this Scalar issue](https://github.com/scalar/scalar/issues/3973).

## FAQ

### How to disable documentation?

Just leave `apiExplorer.url` empty. This way, no route will point to documentation.

### How can I define a nullable parameter?

You can define [Scalar nullable schema property](https://swagger.io/specification/v3/#schema-object) to `true`, or add `null` in type array
(see [Openapi specification](https://datatracker.ietf.org/doc/html/draft-bhutton-json-schema-validation-01#name-type)).

### Do Openapi files support environment variables?

Yes, this library has a (very) simple environment vars replacement, working with both YAML and JSON files. It uses `process.env.*` to find the value.

```sh
ENV_VAR="test"
ENV_DEFAULT="default value"
ENV_URL="https://www.somesite.net/v1"
```

```yaml
info:
  title: "API docs for environment %env(ENV_VAR)%"
  description: "Some description: %env(ENV_DEFAULT:ENV_VAR)%, %env(ENV_DEFAULT:ENV_VAR_EMPTY)%"

servers:
  - url: %env(ENV_URL)%
```

Results in

```yaml
info:
  title: "API docs for environment test"
  description: "Some description: test, default value"

servers:
  - url: https://www.somesite.net/v1
```

> You need to whitelist **all** your env vars if you want the replacement to work
```js
new Router({
  apiExplorer: {
    envWhitelist: ['ENV_VAR', 'ENV_DEFAULT', 'ENV_URL']
  }
})
```

### Advanced validation

This lib uses `FastestValidator` for validation. You can use Openapi schema parameter `format` to use any of the validators available.

You must use the [shorthand](https://github.com/icebob/fastest-validator?tab=readme-ov-file#shorthand-definitions) method to add options to the validator.

```yaml
name: email
schema:
  type: string
  format: email|normalize

name: age
schema:
  type: integer
  format: positive
```

### I don't want to convert value (for arrays, boolean, integer, string, etc)

By default all values are converted into the defined type, because this lib defaults `convert` option in FastestValidator to `true`.

If you don't want to convert values, you have to force conversion to false.

```yaml
name: ids
schema:
  type: array
  format: convert:false
  items:
    type: string

name: age
schema:
  type: integer
  format: positive|convert:false
```

## Contribution

Please send pull requests improving the usage and fixing bugs, improving documentation and providing better examples, or providing some tests, because these things are important.

Run tests with `npm run test`. It uses `jest` behind the scene.

## License

`koa-scalar` is available under the MIT license.
