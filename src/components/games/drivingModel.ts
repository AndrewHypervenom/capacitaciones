export interface RoadOption { id: string; text: string; correct: boolean; explanation: string }
export interface RoadQuestion { id: string; question: string; context: string; options: RoadOption[] }
export const DRIVING_ICON = '🚗'
export function validRoadQuestions(steps: RoadQuestion[]) {
  return steps.length > 0 && steps.every(s => s.question.trim() && s.options.length >= 2 && s.options.every(o => o.text.trim()) && s.options.filter(o => o.correct).length === 1)
}
export function shuffledQuestions(steps: RoadQuestion[]) {
  return steps.map(s => {
    const options = [...s.options]
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]
    }
    return { ...s, options }
  })
}
