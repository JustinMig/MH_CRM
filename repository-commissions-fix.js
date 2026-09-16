import { mhRepository, supabase } from './supabase-repository.js';

mhRepository.commissions = async function commissions({ agent } = {}) {
  let q = supabase.from('commissions').select('*').order('earned_date', { ascending: false }).limit(500);
  if (agent) q = q.eq('agent_id', agent);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  return { rows, total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) };
};
