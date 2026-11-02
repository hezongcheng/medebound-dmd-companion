const categoryCodes = new Set(require('./rehabLessonSchema').categories.map(([code]) => code));

function threshold(video) {
  const count = Number(video.unlock_after_count);
  return [3, 4, 5].includes(count) ? count : 3;
}

function buildCatalog(videos, counts = new Map()) {
  const sorted = videos.filter(video => categoryCodes.has(video.training_category)).slice().sort((a, b) =>
    (a.video_version === '2.0' ? 0 : 1) - (b.video_version === '2.0' ? 0 : 1) ||
    Number(a.sort_order) - Number(b.sort_order) || Number(a.id) - Number(b.id));
  const previousByCategory = new Map();
  return sorted.map(video => {
    const previous = previousByCategory.get(video.training_category);
    const completedCount = Number(counts.get(String(video.id)) || 0);
    const isUnlocked = !previous || previous.is_unlocked && previous.completed_count >= previous.unlock_after_count;
    const lesson = {
      ...video,
      unlock_after_count: threshold(video),
      required_watch_seconds: requiredSeconds(video),
      completed_count: completedCount,
      is_unlocked: Boolean(isUnlocked),
      prerequisite_id: previous?.id ?? null,
      prerequisite_title: previous?.title ?? null,
      prerequisite_count: previous?.completed_count ?? 0,
      prerequisite_required: previous?.unlock_after_count ?? 0
    };
    previousByCategory.set(video.training_category, lesson);
    return lesson;
  });
}

function lessonError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function positiveId(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw lessonError('无效的视频或学习记录编号');
  return number;
}

function requiredSeconds(video) {
  const duration = Number(video.duration);
  return duration >= 45 ? 45 : Math.max(1, duration - 2);
}

module.exports = { threshold, buildCatalog, lessonError, positiveId, requiredSeconds };
