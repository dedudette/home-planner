/**
 * What the assistant's words may not contain. These checks run on the server and again in the browser, on every sentence, before
 * anything is shown. The assistant is here to choose and to explain a choice in a few neutral words: it does not give medical or
 * nutrition advice, make safety claims about food or exercise, talk about weight, mention prices, pressure anyone, or claim to have
 * changed anything.
 */
const BANNED: { name: string; re: RegExp }[] = [
  { name: 'nutrition or health claim', re: /\b(calor\w*|kcal|protein\w*|carb\w*|fats?|sugars?|sodium|fib(re|er)|vitamins?|minerals?|nutri\w*|health\w*|unhealthy|wholesome|detox\w*|cleanse|boost\w*|immun\w*|inflammat\w*|gut|metabolism|superfood|clean eating|good for you|bad for you)\b/i },
  { name: 'body or weight talk', re: /\b(weight|slim\w*|bulk\w*|shred\w*|burn\w*|lose|losing|fat loss|physique)\b/i },
  { name: 'medical talk', re: /\b(diagnos\w*|cure\w*|treat\w*|therap\w*|medic\w*|doctor|disease|illness|condition|symptom\w*|injur\w*|pain|prescri\w*|diabet\w*|blood)\b/i },
  { name: 'safety claim', re: /\b(safe|safely|safety|allerg\w*|intoleran\w*|free from|gluten[- ]free|dairy[- ]free|nut[- ]free|guarantee\w*)\b/i },
  { name: 'price', re: /[$£€]|\b(cheap\w*|expensive|prices?|costs?|costing|afford\w*|saves? money)\b/i },
  { name: 'pressure or shame', re: /\b(should|must|need to|needs to|have to|ought|don'?t forget|make sure|always|never|lazy|fail\w*|behind|guilt\w*|streak\w*|slack\w*|excuse\w*|discipline|willpower)\b/i },
  { name: 'claims a change', re: /\b(i|i've|i have|i'll|i will|let me|we've|we have|we'll|we will)\b[^.!?]{0,40}\b(chang\w*|updat\w*|add(ed|ing)?|remov\w*|delet\w*|schedul\w*|plan(ned)?|sav(e|ed)|set|book(ed)?|order(ed)?|made)\b/i },
  { name: 'markup or link', re: /[<>`{}\\]|https?:|www\.|\]\(|\bjavascript:/i },
];

/**
 * Why a sentence is not acceptable, or null. `allowedNumbers` are the only numbers it may contain: figures that came from the request
 * (minutes, servings, how many days). A number the model made up would be a claim the app cannot stand behind.
 */
export const textProblem = (text: string, allowedNumbers: number[]): string | null => {
  for (const b of BANNED) if (b.re.test(text)) return b.name;
  const allowed = new Set(allowedNumbers);
  for (const tok of text.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!allowed.has(Number(tok.replace(',', '.')))) return `number ${tok} is not from the request`;
  // spelled-out quantities are a way round the number check
  if (/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|hundred|dozen|half|double|triple)\b[^.!?]{0,12}\b(minutes?|mins?|hours?|servings?|portions?|grams?|g|ml|litres?|cups?)\b/i.test(text)) return 'spelled-out quantity';
  return null;
};

/** Collapses whitespace and drops control characters; returns null for anything that is not a string. */
export const clean = (x: unknown): string | null => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : null);
