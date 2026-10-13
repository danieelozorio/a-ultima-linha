// Visita o Supabase uma vez por dia para o projeto gratuito não ser pausado por falta de uso.
import { sb } from '../lib/supabase.mjs';
export default async () => {
  const r = await sb('/rest/v1/leitores?select=email&limit=1');
  console.log('manter-ativo', r.status);
  return new Response('ok');
};
export const config = { schedule: '@daily' };
