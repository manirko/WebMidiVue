const fs = require('fs')
const http = require('http')
const path = require('path')

const mime = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2'
}

function chromePath() {
  const executable = [process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean).find(fs.existsSync)
  if (!executable) throw new Error('Chrome/Chromium not found; set CHROME_PATH')
  return executable
}

function createStaticServer(root, options = {}) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    if (pathname === '/api/telemetry' && request.method === 'POST') {
      request.resume()
      response.writeHead(202, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'})
      response.end('{"accepted":true}')
      return
    }
    let relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    let file = path.resolve(root, relative)
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      relative = 'index.html'
      file = path.join(root, relative)
    }
    let body = fs.readFileSync(file)
    if (options.transform) body = options.transform(relative, body)
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...options.headers
    })
    response.end(body)
  })
}

module.exports = {chromePath, createStaticServer}
