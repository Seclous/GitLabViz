// One budget is shared by all pages and project fallbacks in an operation.
export function createRequestBudget(limit = 1000) {
  const max = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 1000)))
  let used = 0
  return {
    get exhausted() { return used >= max },
    claim(signal) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      if (used >= max) {
        const error = new Error('Request budget reached; results are incomplete. Narrow the source and refresh.')
        error.code = 'GLV_REQUEST_BUDGET'
        throw error
      }
      used++
    }
  }
}

export function nextRestPage(response, page, size = 100) {
  if (!Array.isArray(response?.data)) throw new Error('Unexpected paginated GitLab response; results are incomplete.')
  const next = response.headers?.['x-next-page'] ?? response.headers?.['X-Next-Page']
  if (next == null) return response.data.length >= size ? page + 1 : 0
  if (!String(next).trim()) return 0
  const number = Number(next)
  if (!Number.isSafeInteger(number) || number <= page) throw new Error('GitLab pagination did not advance; results are incomplete.')
  return number
}

export function markPartial(value, reasons = []) {
  Object.defineProperty(value, '__glvPartial', { value: reasons.length > 0, enumerable: false })
  Object.defineProperty(value, '__glvWarnings', { value: [...new Set(reasons)], enumerable: false })
  return value
}
