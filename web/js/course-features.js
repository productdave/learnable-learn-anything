export const courseHasFlashcards = config => !Array.isArray(config?.components) || config.components.includes('flashcards');
export function flashcardEmptyCopy(config) {
  return courseHasFlashcards(config)
    ? { title: 'No flashcards available', body: 'This course doesn’t have any flashcards to review yet.' }
    : { title: 'Flashcards aren’t included', body: 'The creator chose a course without flashcards. Continue with the lessons instead.' };
}
