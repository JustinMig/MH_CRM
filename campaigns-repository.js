import { CONTACT_OUTCOMES, memberOrders, safeSearchPattern } from './campaigns-model.js';

const check = ({ data, error }) => { if (error) throw error; return data; };
const pageOffset = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const MEMBER_PAGE_SIZE = 500;
export function createCampaignRepository(db) {
  return {
    async list({ status = 'active', cursor = null } = {}) {
      let query = db.from('campaign_summaries').select('*').order('created_at', { ascending: false }).order('id');
      if (status !== 'all') query = query.eq('status', status);
      const offset = pageOffset(cursor);
      const rows = check(await query.range(offset, offset + 40)) || [];
      return { rows: rows.slice(0, 40), nextCursor: rows.length > 40 ? String(offset + 40) : null };
    },
    async get(id) {
      return check(await db.from('campaign_summaries').select('*').eq('id', id).single());
    },
    async save({ id, name, topic = 'general', description = '', assigned_agent_id }, userId) {
      const payload = { name: String(name || '').trim(), topic, description: String(description || '').trim() };
      if (!payload.name || payload.name.length > 120) throw new Error('Enter a campaign name of 1–120 characters.');
      const existing = check(await db.from('campaigns').select('id').eq('id', id).maybeSingle());
      if (existing) return check(await db.from('campaigns').update(payload).eq('id', id).select('*').single());
      return check(await db.from('campaigns').insert({ ...payload, id, owner_id: userId, assigned_agent_id: assigned_agent_id || userId }).select('*').single());
    },
    async setStatus(id, status) {
      if (!['active', 'archived'].includes(status)) throw new Error('Invalid campaign status.');
      return check(await db.from('campaigns').update({ status }).eq('id', id).select('id,status').single());
    },
    async members(id, { status = 'all', query = '', sort = 'name', direction = 'asc', cursor = null } = {}) {
      let q = db.from('campaign_member_results').select('*').eq('campaign_id', id);
      if (status !== 'all') q = q.eq('contact_status', status);
      const pattern = safeSearchPattern(query);
      if (pattern) q = q.or(['full_name', 'phone', 'county', 'state'].map(k => `${k}.ilike.${pattern}`).join(','));
      for (const [field, ascending] of memberOrders(sort, direction)) q = q.order(field, { ascending, nullsFirst: false });
      const offset = pageOffset(cursor);
      const rows = check(await q.range(offset, offset + MEMBER_PAGE_SIZE)) || [];
      return { rows: rows.slice(0, MEMBER_PAGE_SIZE), nextCursor: rows.length > MEMBER_PAGE_SIZE ? String(offset + MEMBER_PAGE_SIZE) : null };
    },
    async existingClients(campaignId, clientIds) {
      if (!clientIds.length) return [];
      return check(await db.from('campaign_members').select('client_id').eq('campaign_id', campaignId).in('client_id', clientIds)) || [];
    },
    async addClients(campaignId, clientIds, actorId) {
      const ids = [...new Set(clientIds)];
      if (!ids.length || ids.length > 500) throw new Error('Select between 1 and 500 clients.');
      const rows = check(await db.from('campaign_members').upsert(ids.map(client_id => ({ campaign_id: campaignId, client_id, added_by: actorId })), { onConflict: 'campaign_id,client_id', ignoreDuplicates: true }).select('id')) || [];
      return rows.length;
    },
    async availability(agentId, day) {
      if (!agentId || !day) throw new Error('Choose an agent and valid date.');
      return check(await db.from('appointments').select('id,start_time,end_time,status').eq('assigned_agent_id', agentId).eq('event_date', day).eq('status', 'scheduled')) || [];
    },
    async history(memberId) {
      return check(await db.from('campaign_contact_log').select('id,outcome,note,next_action,created_at,appointment_id').eq('member_id', memberId).order('created_at', { ascending: false }).limit(30)) || [];
    },
    async returnToStepOne({ p_member_id, p_operation_id, p_expected_version, p_note = '' }) {
      return check(await db.rpc('campaign_return_to_step_one', { p_member_id, p_operation_id, p_expected_version, p_note }));
    },
    async recordContact(payload) {
      if (!CONTACT_OUTCOMES.some(([key]) => key === payload.p_outcome)) throw new Error('Choose a contact result.');
      return check(await db.rpc('campaign_record_contact', payload));
    }
  };
}
