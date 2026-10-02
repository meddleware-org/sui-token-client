// Resolve hook for running the TypeScript sources directly under Node's type stripping: the sources
// import siblings as `./x.js` (for the declaration build), which map to `./x.ts` here.
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx)
  } catch (err) {
    if (spec.startsWith('.') && spec.endsWith('.js')) return next(spec.slice(0, -3) + '.ts', ctx)
    throw err
  }
}`),
)
