import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://bogusfmvdrlvxscopgaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0g4-uBS_I8wJnBdLbtbriA_vFngXi46';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const clean = v => v === '' || v === undefined ? null : v;
const money = v => v === '' || v === undefined || v === null ? null : Number(v);
const one = async query => { const { data, error } = await query.maybeSingle(); if (error) throw error; return data; };
async function saveOne(table, clientId, existingId, payload) {
  const body = { ...payload, client_id: clientId };
  if (existingId) { const { data, error } = await supabase.from(table).update(body).eq('id', existingId).select().single(); if (error) throw error; return data; }
  const { data, error } = await supabase.from(table).insert(body).select().single(); if (error) throw error; return data;
}

export const mhRepository = {
  connected: true,
  agents: [],
  user: null,
  profile: null,
  async initialize() {
    const { data: { session } } = await supabase.auth.getSession();
    this.user = session?.user || null;
    if (!this.user) return false;
    this.profile = await one(supabase.from('profiles').select('id,full_name,role,active').eq('id', this.user.id));
    const { data, error } = await supabase.from('profiles').select('id,full_name,role,active').eq('active', true).order('full_name');
    if (error) throw error;
    this.agents.splice(0, this.agents.length, ...(data || []));
    return true;
  },
  async signIn(email, password) { const { data, error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; return data; },
  async signOut() { await supabase.auth.signOut(); location.reload(); },
  async listUsers() {
    const { data, error } = await supabase.from('profiles').select('id,full_name,role,active,created_at').order('full_name');
    if (error) throw error;
    return data || [];
  },
  async inviteUser({ full_name, email, role }) {
    const { data, error } = await supabase.functions.invoke('admin-invite-user', { body: { full_name, email, role } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const users = await this.listUsers();
    this.agents.splice(0, this.agents.length, ...users.filter(user => user.active));
    return data;
  },

  async searchClients({ query = '', product = '', agent = '', birthYear = '', limit = 50 }) {
    let q = supabase.from('clients').select('id,first_name,last_name,phone,email,date_of_birth,products,assigned_agent_id,updated_at').order('last_name').order('first_name').limit(limit);
    if (query) {
      const term = query.replace(/[,%]/g, ' ').trim();
      q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,address1.ilike.%${term}%,city.ilike.%${term}%`);
    }
    if (product) q = q.contains('products', [product.toLowerCase()]);
    if (agent) q = q.eq('assigned_agent_id', agent);
    if (birthYear) q = q.gte('date_of_birth', `${birthYear}-01-01`).lte('date_of_birth', `${birthYear}-12-31`);
    const { data, error } = await q; if (error) throw error;
    return { rows: data || [], nextCursor: null };
  },

  async getClient(id) {
    const client = await one(supabase.from('clients').select('*').eq('id', id));
    if (!client) return null;
    const [medicare, health, life, retirement] = await Promise.all([
      one(supabase.from('medicare_details').select('*').eq('client_id', id)),
      one(supabase.from('health_plans').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(1)),
      one(supabase.from('life_policies').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(1)),
      one(supabase.from('retirement_accounts').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(1))
    ]);
    const p = client.products || [];
    return {
      ...client, address: client.address1 || '', zip: client.zip_code || '', spouse: client.spouse || '', notes: client.notes || '',
      license_number: client.drivers_license_number || '', license_expiration: client.drivers_license_expiration || '', license_state: client.drivers_license_state || '',
      product_medicare: p.includes('medicare'), product_life: p.includes('life'), product_retirement: p.includes('retirement'),
      part_a_date: medicare?.part_a_date || '', part_b_date: medicare?.part_b_date || '', medicaid_level: medicare?.medicaid_level || '', _medicare_id: medicare?.client_id || null,
      health_carrier: health?.carrier || '', health_plan_id: health?.plan_id || '', health_member_id: health?.member_id || '', health_effective_date: health?.effective_date || '', health_premium: health?.premium ?? '', _health_id: health?.id || null,
      life_carrier: life?.carrier || '', life_product: life?.product || life?.policy_type || '', life_policy_number: life?.policy_number || '', life_face_amount: life?.face_amount ?? '', life_premium: life?.premium ?? '', life_frequency: life?.premium_mode || '', life_effective_date: life?.effective_date || '', life_notes: life?.notes || '', _life_id: life?.id || null,
      retirement_carrier: retirement?.carrier || '', retirement_product: retirement?.product || '', retirement_contract: retirement?.contract_number || '', retirement_effective_date: retirement?.effective_date || '', retirement_contribution: retirement?.contribution_amount ?? '', retirement_notes: retirement?.notes || '', _retirement_id: retirement?.id || null
    };
  },

  async saveClient(record) {
    const products = ['medicare','life','retirement'].filter(k => record[`product_${k}`]);
    const clientPayload = {
      assigned_agent_id: clean(record.assigned_agent_id) || this.user?.id || null,
      first_name: record.first_name?.trim(), last_name: record.last_name?.trim(), date_of_birth: clean(record.date_of_birth), gender: clean(record.gender),
      email: clean(record.email), phone: clean(record.phone), address1: clean(record.address), city: clean(record.city), county: clean(record.county), state: clean(record.state), zip_code: clean(record.zip),
      drivers_license_number: clean(record.license_number), drivers_license_expiration: clean(record.license_expiration), drivers_license_state: clean(record.license_state), spouse: clean(record.spouse), products, notes: clean(record.notes), status: 'active'
    };
    let client;
    if (record.id) { const { data, error } = await supabase.from('clients').update(clientPayload).eq('id', record.id).select().single(); if (error) throw error; client = data; }
    else { const { data, error } = await supabase.from('clients').insert(clientPayload).select().single(); if (error) throw error; client = data; }

    const { error: medErr } = await supabase.from('medicare_details').upsert({ client_id: client.id, part_a_date: clean(record.part_a_date), part_b_date: clean(record.part_b_date), medicaid_level: clean(record.medicaid_level) }, { onConflict: 'client_id' });
    if (medErr) throw medErr;
    if (record.health_carrier || record.health_plan_id || record.health_member_id || record.health_effective_date || record.health_premium) await saveOne('health_plans', client.id, record._health_id, { carrier: clean(record.health_carrier), plan_id: clean(record.health_plan_id), member_id: clean(record.health_member_id), effective_date: clean(record.health_effective_date), premium: money(record.health_premium), status: 'active' });
    if (record.life_carrier || record.life_product || record.life_policy_number || record.life_face_amount || record.life_premium) await saveOne('life_policies', client.id, record._life_id, { carrier: clean(record.life_carrier), product: clean(record.life_product), policy_number: clean(record.life_policy_number), policy_type: clean(record.life_product), face_amount: money(record.life_face_amount), premium: money(record.life_premium), premium_mode: clean(record.life_frequency), effective_date: clean(record.life_effective_date), notes: clean(record.life_notes), status: 'active' });
    if (record.retirement_carrier || record.retirement_product || record.retirement_contract || record.retirement_contribution) await saveOne('retirement_accounts', client.id, record._retirement_id, { carrier: clean(record.retirement_carrier), product: clean(record.retirement_product), contract_number: clean(record.retirement_contract), contribution_amount: money(record.retirement_contribution), effective_date: clean(record.retirement_effective_date), notes: clean(record.retirement_notes), status: 'active' });
    return this.getClient(client.id);
  },

  async listEvents({ start, end }) {
    const { data, error } = await supabase.from('appointments').select('*').gte('event_date', start).lte('event_date', end).order('event_date').order('start_time');
    if (error) throw error; return data || [];
  },
  async saveEvent(value) {
    const payload = { client_id: clean(value.client_id), assigned_agent_id: clean(value.assigned_agent_id) || this.user?.id || null, title: value.title?.trim() || `Appointment: ${value.person_name || 'Client'}`, event_type: value.event_type || 'appointment', event_date: value.event_date, start_time: clean(value.start_time), end_time: clean(value.end_time), notes: clean(value.notes), status: value.status || 'scheduled' };
    if (value.event_id) { const { data, error } = await supabase.from('appointments').update(payload).eq('id', value.event_id).select().single(); if (error) throw error; return data; }
    const { data, error } = await supabase.from('appointments').insert(payload).select().single(); if (error) throw error; return data;
  },

  async listNotes() { const { data, error } = await supabase.from('client_notes').select('*').order('created_at', { ascending: false }).limit(100); if (error) throw error; return data || []; },
  async saveNote(value) { const body = { client_id: clean(value.client_id), author_id: this.user?.id, title: value.title || 'Note', body: value.body || value.notes || '', pinned: !!value.pinned }; const { data, error } = value.id ? await supabase.from('client_notes').update(body).eq('id', value.id).select().single() : await supabase.from('client_notes').insert(body).select().single(); if (error) throw error; return data; },
  async searchContacts(query = '') { let q = supabase.from('company_contacts').select('*').order('company').limit(50); if (query) q = q.ilike('company', `%${query.replace(/[%]/g,' ')}%`); const { data, error } = await q; if (error) throw error; return data || []; },
  async commissions({ agent } = {}) { let q = supabase.from('commissions').select('*').order('earned_date', { ascending: false }).limit(500); if (agent) q = q.eq('agent_id', agent); const { data, error } = await q; if (error) throw error; const rows = data || []; return { rows, total: rows.reduce((s,r)=>s+Number(r.amount||0),0) }; },
  async getBuildChart() { return []; }
};
