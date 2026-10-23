import { EarnedPoints } from "../core/calcPoints";

// Ce qu'une bonne réponse vient de rapporter, en court : « +40 ⚡+40 🏆+200 »
// (le calcul, le bonus de réponse fluide, l'entrée en Boîte 5) ; vide si rien n'est gagné
export function earnedText(earned: EarnedPoints): string {
  if (earned.answer === 0) return "";
  return [`+${earned.answer}`, earned.bonus ? `⚡+${earned.bonus}` : "", earned.mastery ? `🏆+${earned.mastery}` : ""].filter(Boolean).join(" ");
}
