// Recebe o aviso de compra (webhook) da Hotmart ou da Kiwify e libera ou bloqueia o leitor.
// Liberação manual:  ...compra?key=SEGREDO&liberar=email@exemplo.com&nome=Fulano
// Bloqueio manual:   ...compra?key=SEGREDO&bloquear=email@exemplo.com
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

const LIBERA = ['purchase_approved', 'purchase_complete', 'order_approved', 'approved', 'paid', 'complete', 'completed'];
const BLOQUEIA = ['purchase_refunded', 'purchase_chargeback', 'purchase_canceled', 'purchase_cancelled', 'purchase_protest',
  'order_refunded', 'refunded', 'chargeback', 'chargedback', 'canceled', 'cancelled'];

const resp = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

function achaEmail(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(o)) {
    if (/e-?mail/i.test(k) && emailOk(v)) return v;
  }
  for (const v of Object.values(o)) {
    const e = achaEmail(v, depth + 1); if (e) return e;
  }
  return null;
}

function interpreta(body) {
  const d = body || {};
  const email = (d?.data?.buyer?.email || d?.Customer?.email || d?.customer?.email || d?.buyer?.email || achaEmail(d) || '').trim().toLowerCase();
  const nome = (d?.data?.buyer?.name || d?.Customer?.full_name || d?.Customer?.name || d?.customer?.name || d?.buyer?.name || '').toString().trim().slice(0, 120);
  const sinais = [d.event, d.webhook_event_type, d.order_status, d.status, d?.data?.purchase?.status]
    .filter(Boolean).map((s) => String(s).toLowerCase());
  let acao = null;
  for (const s of sinais) {
    if (BLOQUEIA.includes(s)) { acao = 'bloquear'; break; }
    if (LIBERA.includes(s)) { acao = 'liberar'; break; }
  }
  const plataforma = d.hottok || d?.data?.purchase ? 'hotmart' : (d.Customer || d.order_status ? 'kiwify' : 'outra');
  return { email, nome, acao, plataforma, sinais };
}

async function liberar(email, nome, plataforma) {
  const agora = new Date().toISOString();
  const up = await sb('/rest/v1/leitores?on_conflict=email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ email, nome: nome || null, plataforma, ativo: true, atualizado_em: agora }]),
  });
  if (!up.ok) throw new Error('Erro ao gravar leitor: ' + up.status + ' ' + JSON.stringify(up.data));
  const u = await sb('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, email_confirm: true, user_metadata: { nome: nome || '' } }),
  });
  const jaExiste = !u.ok && (u.status === 422 || /already|registered|exists/i.test(JSON.stringify(u.data)));
  if (!u.ok && !jaExiste) throw new Error('Erro ao criar login: ' + u.status + ' ' + JSON.stringify(u.data));
  return { conta: u.ok ? 'criada' : 'já existia' };
}

async function bloquear(email) {
  const r = await sb('/rest/v1/leitores?email=eq.' + encodeURIComponent(email), {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ativo: false, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('Erro ao bloquear: ' + r.status + ' ' + JSON.stringify(r.data));
}

export default async (req) => {
  const url = new URL(req.url);
  const SEGREDO = process.env.WEBHOOK_SECRET || '';
  const chave = url.searchParams.get('key') || '';
  const hottok = req.headers.get('x-hotmart-hottok') || '';
  if (!SEGREDO || (chave !== SEGREDO && hottok !== SEGREDO)) return resp(401, { erro: 'não autorizado' });

  try {
    const manualL = url.searchParams.get('liberar');
    const manualB = url.searchParams.get('bloquear');
    if (manualL || manualB) {
      const email = (manualL || manualB).trim().toLowerCase();
      if (!emailOk(email)) return resp(400, { erro: 'e-mail inválido' });
      if (manualL) { const r = await liberar(email, url.searchParams.get('nome') || '', 'manual'); return resp(200, { ok: true, liberado: email, ...r }); }
      await bloquear(email); return resp(200, { ok: true, bloqueado: email });
    }

    if (req.method !== 'POST') return resp(200, { ok: true, info: 'webhook do 16:12 funcionando' });
    let body = null;
    const tipo = req.headers.get('content-type') || '';
    const raw = await req.text();
    if (tipo.includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(raw));
    else { try { body = JSON.parse(raw); } catch { return resp(400, { erro: 'corpo inválido' }); } }

    const { email, nome, acao, plataforma, sinais } = interpreta(body);
    if (!acao) return resp(200, { ok: true, ignorado: true, sinais });
    if (!emailOk(email)) return resp(200, { ok: true, ignorado: true, motivo: 'sem e-mail' });
    if (acao === 'liberar') { const r = await liberar(email, nome, plataforma); return resp(200, { ok: true, acao, email, ...r }); }
    await bloquear(email); return resp(200, { ok: true, acao, email });
  } catch (e) {
    console.error(e);
    return resp(500, { erro: String(e.message || e) });
  }
};
