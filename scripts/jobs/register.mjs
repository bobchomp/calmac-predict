// Lets the jobs import the site's lib/ modules, whose relative imports leave
// off the .js (as Next.js allows): node --import ./scripts/jobs/register.mjs
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith('./') || spec.startsWith('../')) && !/\\.[cm]?js$|\\.json$/.test(spec)) {
    try { return await next(spec + '.js', ctx); } catch (_) {}
  }
  return next(spec, ctx);
}`));
