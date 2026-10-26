// Keep profile validation self-contained: the server is deployed independently.
function normalizeContentPreference(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(100, value))) : 40;
}

export function businessToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function ageFromBirthDate(birthDate, today = businessToday()) {
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [year, month, day] = birthDate.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || birthDate > today) return null;
  const age = Number(today.slice(0, 4)) - year - (today.slice(5) < birthDate.slice(5) ? 1 : 0);
  return age >= 0 && age <= 120 ? age : null;
}

export function normalizeProfile(profile, today = businessToday()) {
  const result = { ...profile };
  result.contentPreference = normalizeContentPreference(result.contentPreference);
  if (result.birthDate) {
    const age = ageFromBirthDate(result.birthDate, today);
    if (age === null) throw new Error('请填写有效的出生日期，不能晚于今天，年龄须在0—120周岁之间');
    result.age = age;
  } else {
    result.birthDate = null;
    if (!Number.isInteger(result.age) || result.age < 0 || result.age > 120) throw new Error('请填写出生日期；历史年龄必须为0—120的整数');
  }
  if (['deletion', 'duplication'].includes(result.mutationType)) {
    const start = result.exonStart == null || result.exonStart === '' ? null : result.exonStart;
    const end = result.exonEnd == null || result.exonEnd === '' ? null : result.exonEnd;
    if ((start === null) !== (end === null)) throw new Error('请同时选择起始和终止外显子，不清楚时可同时留空');
    if (start !== null && (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 79 || start > end)) throw new Error('外显子范围须在1—79之间，起始值不能大于终止值');
    result.exonStart = start; result.exonEnd = end;
    const label = result.mutationType === 'duplication' ? '重复' : '缺失';
    result.geneticProfile = start === null ? `外显子${label}（范围未填写）` : `外显子 ${start}-${end} ${label}`;
  } else {
    result.exonStart = null; result.exonEnd = null;
  }
  return result;
}

export function profileForAI(submitted, stored, today = businessToday()) {
  const profile = normalizeProfile({ ...submitted, age: stored.age, birthDate: stored.birthday,
    mutationType: stored.mutation_type || undefined, exonStart: stored.exon_start, exonEnd: stored.exon_end,
    geneticProfile: stored.genetic_profile || '' }, today);
  // Older profiles may only contain a free-text genetic description.
  if (stored.exon_start == null && stored.exon_end == null && stored.genetic_profile) profile.geneticProfile = stored.genetic_profile;
  delete profile.birthDate;
  return profile;
}
