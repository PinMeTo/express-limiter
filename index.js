module.exports = function (app, db) {
  return function (opts) {
    var middleware = function (req, res, next) {
      if (opts.whitelist && opts.whitelist(req)) return next()
      opts.onRateLimited = typeof opts.onRateLimited === 'function' ? opts.onRateLimited : function (req, res, next) {
        res.status(429).send('Rate limit exceeded')
      }
      var key
      if (opts.staticLookup) {
        key = opts.staticLookup
      } else {
        opts.lookup = Array.isArray(opts.lookup) ? opts.lookup : [opts.lookup]
        var lookups = opts.lookup.map(function (item) {
          return item + ':' + item.split('.').reduce(function (prev, cur) {
            return prev[cur]
          }, req)
        }).join(':')
        var path = opts.path || req.path
        var method = (opts.method || req.method).toLowerCase()
        key = 'ratelimit:' + path + ':' + method + ':' + lookups
      }
      db.get(key, function (err, limit) {
        if (err && opts.ignoreErrors) return next()
        var now = Date.now()
        limit = limit ? JSON.parse(limit) : {
          total: opts.total,
          remaining: opts.total,
          reset: now + opts.expire
        }

        if (now > limit.reset) {
          limit.reset = now + opts.expire
          limit.remaining = opts.total
          limit.total = opts.total
        }

        // do not allow negative remaining
        limit.remaining = Math.max(Number(limit.remaining) - 1, -1)
        db.set(key, JSON.stringify(limit), 'PX', opts.expire, function (e) {
          if (!opts.skipHeaders) {
            res.set('X-RateLimit-Limit', limit.total)
            res.set('X-RateLimit-Reset', Math.ceil(limit.reset / 1000)) // UTC epoch seconds
            res.set('X-RateLimit-Remaining', Math.max(limit.remaining,0))
          }
          req.remaining = limit.remaining;
          if (limit.remaining >= 0) return next()

          var after = (limit.reset - Date.now()) / 1000

          if (!opts.skipHeaders) res.set('Retry-After', after)

          opts.onRateLimited(req, res, next)
        })

      })
    }
    if (typeof(opts.lookup) === 'function') {
      var callableLookup = opts.lookup;
      middleware = function (middleware, req, res, next) {
        return callableLookup(req, res, opts, function () {
          return middleware(req, res, next)
        })
      }.bind(this, middleware)
    }
    if (opts.method && opts.path) app[opts.method](opts.path, middleware)
    return middleware
  }
}
