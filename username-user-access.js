import { mhRepository, supabase } from './supabase-repository.js';

mhRepository.listUsers = async function listUsersWithUsername() {
  const { data, error } = await supabase.from('profiles').select('id,full_name,username,role,active,created_at').order('full_name');
  if (error) throw error;
  return data || [];
};

mhRepository.createCredentialUser = async function createCredentialUser({ full_name, username, password }) {
  const { data, error } = await supabase.functions.invoke('admin-user-access', {
    body: { action: 'create', full_name, username, password }
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  const users = await this.listUsers();
  this.agents.splice(0, this.agents.length, ...users.filter(user => user.active));
  return data;
};

const baseSetUserActive = mhRepository.setUserActive?.bind(mhRepository);
if (!baseSetUserActive) {
  mhRepository.setUserActive = async function setUserActive(userId, active) {
    const { data, error } = await supabase.functions.invoke('admin-user-access', {
      body: { action: 'set_active', user_id: userId, active: !!active }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const users = await this.listUsers();
    this.agents.splice(0, this.agents.length, ...users.filter(user => user.active));
    return data;
  };
}
