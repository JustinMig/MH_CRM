export function installUserAccessRepository(repository, supabase) {
  if (!repository || repository.__userAccessRepositoryInstalled) return;
  repository.__userAccessRepositoryInstalled = true;

  repository.listUsers = async function listUsersWithUsername() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,full_name,username,role,active,created_at')
      .order('full_name');
    if (error) throw error;
    return data || [];
  };

  repository.createCredentialUser = async function createCredentialUser({ full_name, username, password }) {
    const { data, error } = await supabase.functions.invoke('admin-user-access', {
      body: { action: 'create', full_name, username, password }
    });
    if (error) throw new Error(error.message || 'Unable to create user.');
    if (data?.error) throw new Error(data.error);
    const users = await repository.listUsers();
    repository.agents.splice(0, repository.agents.length, ...users.filter(user => user.active));
    return data || {};
  };

  repository.setUserActive = async function setUserActive(userId, active) {
    const { data, error } = await supabase.functions.invoke('admin-user-access', {
      body: { action: 'set_active', user_id: userId, active: !!active }
    });
    if (error) throw new Error(error.message || 'Unable to update user access.');
    if (data?.error) throw new Error(data.error);
    const users = await repository.listUsers();
    repository.agents.splice(0, repository.agents.length, ...users.filter(user => user.active));
    return data || {};
  };
}
