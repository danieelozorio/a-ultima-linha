// Visita o Supabase uma vez por dia para o projeto gratuito não ser pausado por falta de uso.
function cfg() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  if (!url || !key) throw new Error('Faltam SUPABASE_URL ou SUPABASE_SERVICE_KEY nas variáveis do Netlify');
  return { url, key };
}
function headers(extra = {}) {
  const { key } = cfg();
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  return h;
}
async function sb(path, opts = {}) {
  const { url } = cfg();
  const r = await fetch(url + path, { ...opts, headers: headers(opts.headers || {}) });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}
export default async () => {
  const r = await sb('/rest/v1/leitores?select=email&limit=1');
  console.log('manter-ativo', r.status);
  return new Response('ok');
};
export const config = { schedule: '@daily' };
