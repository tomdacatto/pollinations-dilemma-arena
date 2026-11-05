// The iterated prisoner's dilemma, free of the DOM and the network so node can test it.
// Two players choose, at the same time, to cooperate (C) or defect (D) for several rounds.
// Decision models and text models are asked what they play; four classic strategies are the baseline.

export const ROUNDS = 8;

/** Points for [me, them] by the pair of moves, mine first. */
export const PAYOFF = {
    CC: [3, 3],
    CD: [0, 5],
    DC: [5, 0],
    DD: [1, 1],
};

/** The classic strategies. `history` is the list of [mine, theirs] moves so far. */
export const BASELINES = {
    "tit-for-tat": { title: "Tit for tat", move: (history) => (history.length ? history.at(-1)[1] : "C") },
    "always-defect": { title: "Always defect", move: () => "D" },
    "always-cooperate": { title: "Always cooperate", move: () => "C" },
    grim: { title: "Grim trigger", move: (history) => (history.some(([, theirs]) => theirs === "D") ? "D" : "C") },
};

/** The same description of the game for every kind of player. */
export function describeGame({ rounds, history }) {
    const round = history.length + 1;
    const mine = history.reduce((sum, [a, b]) => sum + PAYOFF[a + b][0], 0);
    const theirs = history.reduce((sum, [a, b]) => sum + PAYOFF[a + b][1], 0);
    const word = (m) => (m === "C" ? "cooperate" : "defect");
    return [
        "You are playing a repeated game against another player. Each round you both choose, at the same time, to cooperate or to defect.",
        "Both cooperate: 3 points each. Both defect: 1 point each. One defects and the other cooperates: the defector gets 5 points and the cooperator 0.",
        `The game lasts ${rounds} rounds. This is round ${round} of ${rounds}. Your points so far: ${mine}. Their points so far: ${theirs}.`,
        history.length
            ? `History (you, them): ${history.map(([a, b], i) => `round ${i + 1}: ${word(a)}, ${word(b)}`).join("; ")}.`
            : "There is no history yet.",
    ].join(" ");
}

/** The request for a decision model: one choice question over the two moves. */
export function decisionRequest(game) {
    return {
        state: describeGame(game),
        questions: {
            move: {
                type: "choice",
                instructions: "What do you play this round?",
                criteria: { cooperate: "Choose to cooperate", defect: "Choose to defect" },
            },
        },
    };
}

/** The move and the probability of cooperating from a decision model's answer. */
export function readDecision(body) {
    const answer = body?.answers?.move;
    const choice = answer?.choice;
    if (choice !== "cooperate" && choice !== "defect") throw new Error("The decision model did not choose a move.");
    const pCooperate = Number(answer.probabilities?.cooperate);
    return { move: choice === "cooperate" ? "C" : "D", pCooperate: Number.isFinite(pCooperate) ? pCooperate : null };
}

/** The chat messages for a text model: the game, and a reply of one word. */
export function chatMessages(game) {
    return [
        {
            role: "user",
            content: `${describeGame(game)}\n\nWhat do you play this round? Reply with one word: cooperate or defect.`,
        },
    ];
}

/** The move in a text model's reply; when it names both, the first one counts. */
export function readMove(text) {
    const found = String(text)
        .toLowerCase()
        .match(/\b(cooperate|defect)\b/);
    if (!found) throw new Error("The reply was not cooperate or defect.");
    return { move: found[1] === "cooperate" ? "C" : "D", pCooperate: null };
}

/**
 * Plays one match. `play(player, view)` resolves to {move, pCooperate?} for a model; baselines are played here.
 * Both players see the same history and move at the same time.
 */
export async function playMatch({ a, b, rounds = ROUNDS, play, onRound }) {
    const history = { a: [], b: [] };
    const out = [];
    const mover = (player, side) => {
        const view = { rounds, history: history[side] };
        return player.kind === "baseline"
            ? Promise.resolve({ move: BASELINES[player.id].move(view.history), pCooperate: null })
            : play(player, view);
    };
    for (let i = 0; i < rounds; i++) {
        const [ma, mb] = await Promise.all([mover(a, "a"), mover(b, "b")]);
        history.a.push([ma.move, mb.move]);
        history.b.push([mb.move, ma.move]);
        const [pa, pb] = PAYOFF[ma.move + mb.move];
        out.push({ a: ma.move, b: mb.move, pa, pb, pCoopA: ma.pCooperate, pCoopB: mb.pCooperate });
        onRound?.(out);
    }
    return out;
}

/** Every pair of players, except two baselines, which are fixed rules and need no match. */
export function schedule(players) {
    const out = [];
    players.forEach((a, i) => {
        for (const b of players.slice(i + 1)) if (a.kind !== "baseline" || b.kind !== "baseline") out.push({ a, b });
    });
    return out;
}

const key = (player) => `${player.kind}:${player.id}`;

/** One row per player from the finished matches, best score per round first. */
export function standings(matches) {
    const rows = new Map();
    const row = (player) => {
        if (!rows.has(key(player)))
            rows.set(key(player), {
                player,
                rounds: 0,
                points: 0,
                cooperated: 0,
                firstMoves: 0,
                openedNicely: 0,
                exploited: 0,
                afterBetrayal: 0,
                retaliated: 0,
                failed: 0,
            });
        return rows.get(key(player));
    };
    for (const match of matches) {
        for (const side of ["a", "b"]) {
            const me = row(match[side]);
            const other = side === "a" ? "b" : "a";
            if (match.error) {
                me.failed++;
                continue;
            }
            match.rounds.forEach((round, i) => {
                me.rounds++;
                me.points += round[side === "a" ? "pa" : "pb"];
                if (round[side] === "C") me.cooperated++;
                if (round[side] === "D" && round[other] === "C") me.exploited++;
                if (i === 0) {
                    me.firstMoves++;
                    if (round[side] === "C") me.openedNicely++;
                } else if (match.rounds[i - 1][other] === "D") {
                    me.afterBetrayal++;
                    if (round[side] === "D") me.retaliated++;
                }
            });
        }
    }
    return [...rows.values()]
        .map((r) => ({
            ...r,
            perRound: r.rounds ? r.points / r.rounds : null,
            cooperationRate: r.rounds ? r.cooperated / r.rounds : null,
            retaliationRate: r.afterBetrayal ? r.retaliated / r.afterBetrayal : null,
        }))
        .sort((a, b) => (b.perRound ?? -1) - (a.perRound ?? -1));
}

const price = (model, key2) => Number(model?.pricing?.[key2] ?? 0);

/** A rough price in Pollen of one move: the game description in, a short answer out. */
export const moveCost = (model) => 260 * price(model, "promptTextTokens") + 25 * price(model, "completionTextTokens");

/** The estimated price of a tournament: every model move in every round of every match. */
export function tournamentCost(matches, rounds, models) {
    return matches.reduce(
        (sum, { a, b }) =>
            sum + [a, b].reduce((s, p) => (p.kind === "baseline" ? s : s + rounds * moveCost(models[p.id])), 0),
        0,
    );
}
