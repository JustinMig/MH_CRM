import { mhRepository, supabase } from './supabase-repository.js';

let installed = false;

function formatDate(value) {
  if (!value) return 'Not entered';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-US');
}

function matchLabels(row) {
  return [
    row.name_match ? 'Name' : '',
    row.dob_match ? 'DOB' : '',
    row.phone_match ? 'Phone' : ''
  ].filter(Boolean).join(', ');
}

function duplicateMessage(rows) {
  const shown = rows.slice(0, 3).map((row, index) => {
    const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unnamed client';
    return `${index + 1}. ${name}\nDOB: ${formatDate(row.date_of_birth)}\nPhone: ${row.phone || 'Not entered'}\nMatched: ${matchLabels(row)}`;
  }).join('\n\n');
  const extra = rows.length > 3 ? `\n\n+ ${rows.length - 3} more possible match${rows.length - 3 === 1 ? '' : 'es'}.` : '';
  return `Possible duplicate client found.\n\n${shown}${extra}\n\nThis new client was NOT saved. Review the existing client before trying again.`;
}

export function installClientDuplicateCheck() {
  if (installed) return;
  installed = true;

  const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
  mhRepository.saveClient = async function saveClientWithDuplicateCheck(record, ...args) {
    if (!record?.id) {
      const firstName = String(record?.first_name || '').trim();
      const lastName = String(record?.last_name || '').trim();
      const dateOfBirth = record?.date_of_birth || null;
      const phone = String(record?.phone || '').trim();

      if ((firstName && lastName && dateOfBirth) || phone) {
        const { data, error } = await supabase.rpc('find_my_duplicate_clients', {
          p_first_name: firstName,
          p_last_name: lastName,
          p_date_of_birth: dateOfBirth,
          p_phone: phone
        });
        if (error) throw error;
        const matches = Array.isArray(data) ? data : [];
        if (matches.length) {
          window.alert(duplicateMessage(matches));
          throw new Error('Possible duplicate client found. The new client was not saved.');
        }
      }
    }

    return baseSaveClient(record, ...args);
  };
}
