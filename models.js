// The live text model list: public, no key needed.
const LIST = "https://gen.pollinations.ai/text/models";

/** Text models with their prices, cheapest first. `vision` marks the ones that can look at a picture. */
export async function loadModels() {
    const res = await fetch(LIST);
    if (!res.ok) throw new Error(`The model list answered ${res.status}.`);
    const body = await res.json();
    return (body.data ?? body)
        .filter((model) => model.output_modalities?.includes("text") && model.pricing)
        .map((model) => ({
            name: model.name,
            title: model.title ?? model.name,
            pricing: model.pricing,
            vision: Boolean(model.input_modalities?.includes("image")),
            paidOnly: Boolean(model.paid_only),
            decision: Boolean(model.supported_endpoints?.includes("/alpha/decisions")),
        }))
        .sort((a, b) => outPrice(a) - outPrice(b));
}

// Decision models are billed on input tokens only, so they have no output price.
const outPrice = (model) => Number(model.pricing.completionTextTokens ?? model.pricing.promptTextTokens ?? 0);
