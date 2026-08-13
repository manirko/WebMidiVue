const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(process.env.BIOTRON_DIST || path.join(__dirname, '..', 'dist'))
const port = Number(process.env.BIOTRON_PORT || 4173)
const host = '127.0.0.1'
const openBrowser = process.argv.includes('--open')
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2'
}

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`Missing ${path.join(root, 'index.html')}. Use the prebuilt test kit or run npm run build first.`)
  process.exit(1)
}

function open(url) {
  let command
  let args
  if (process.platform === 'win32') {
    command = 'cmd'
    args = ['/c', 'start', '', url]
  } else if (process.platform === 'darwin') {
    command = 'open'
    args = [url]
  } else {
    command = 'xdg-open'
    args = [url]
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${host}:${port}`)
  let relative = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname.slice(1))
  let file = path.resolve(root, relative)
  const insideRoot = file === root || file.startsWith(`${root}${path.sep}`)
  if (!insideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    relative = 'index.html'
    file = path.join(root, relative)
  }
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache, must-revalidate',
    'Service-Worker-Allowed': '/'
  })
  fs.createReadStream(file).pipe(response)
})

server.on('error', error => {
  console.error(`Could not start Biotron sandbox on ${host}:${port}: ${error.message}`)
  process.exitCode = 1
})

server.listen(port, host, () => {
  const url = `http://${host}:${port}/#/biotron`
  console.log('Biotron isolated Settings sandbox')
  console.log(`Open: ${url}`)
  console.log('This server is reachable only from this computer.')
  console.log('Keep this window open. Press Ctrl+C to stop.')
  if (openBrowser) open(url)
})
