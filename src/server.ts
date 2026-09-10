import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'
import api from '../backend/app.js'

const startHandler = createStartHandler(defaultStreamHandler)

// This is a technical adapter only. Business logic remains exclusively in backend/.
const fetch: RequestHandler<Register> = async (request) => {
  const url = new URL(request.url)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
    return api.fetch(new Request(url, request))
  }
  return startHandler(request)
}

export default { fetch }
