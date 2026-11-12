// What a visitor's key may spend and for how long. Pollen is per visitor.
// Three decision models and a text model against two classic strategies cost a few hundredths of a Pollen.
export const BUDGET = 0.5;
export const EXPIRY_DAYS = 1;

// How many matches run at the same time.
export const CONCURRENCY = 6;

// Players ticked at the start, when the live list has them.
export const DEFAULT_DECISION_MODELS = ["microsoft/microsoft-decision-1", "vllm-sr/d3"];
export const DEFAULT_TEXT_MODELS = ["openai/gpt-5.4-nano"];
export const DEFAULT_BASELINES = ["tit-for-tat", "always-defect"];

export const ROUND_CHOICES = [5, 8, 12];
export const DEFAULT_ROUNDS = 8;
