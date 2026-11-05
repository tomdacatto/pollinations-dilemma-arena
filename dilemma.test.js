import assert from "node:assert/strict";
import test from "node:test";
import {
    BASELINES,
    chatMessages,
    decisionRequest,
    describeGame,
    moveCost,
    playMatch,
    readDecision,
    readMove,
    schedule,
    standings,
    tournamentCost,
} from "./dilemma.js";

const base = (id) => ({ id, kind: "baseline" });
const model = (id) => ({ id, kind: "text" });

test("the game text states the rules, the round, the points and the history from the player's side", () => {
    const text = describeGame({
        rounds: 8,
        history: [
            ["C", "D"],
            ["D", "D"],
        ],
    });
    assert.ok(text.includes("round 3 of 8"));
    assert.ok(text.includes("Your points so far: 1. Their points so far: 6."));
    assert.ok(text.includes("round 1: cooperate, defect; round 2: defect, defect"));
    assert.ok(describeGame({ rounds: 5, history: [] }).includes("no history yet"));
});

test("the classic strategies play as defined", () => {
    assert.equal(BASELINES["tit-for-tat"].move([]), "C");
    assert.equal(BASELINES["tit-for-tat"].move([["C", "D"]]), "D");
    assert.equal(BASELINES["always-defect"].move([]), "D");
    assert.equal(BASELINES["always-cooperate"].move([["C", "D"]]), "C");
    assert.equal(
        BASELINES.grim.move([
            ["C", "C"],
            ["C", "D"],
            ["C", "C"],
        ]),
        "D",
    );
    assert.equal(BASELINES.grim.move([["C", "C"]]), "C");
});

test("a decision model's answer gives a move and the probability of cooperating", () => {
    const body = {
        answers: { move: { type: "choice", choice: "defect", probabilities: { cooperate: 0.2, defect: 0.8 } } },
    };
    assert.deepEqual(readDecision(body), { move: "D", pCooperate: 0.2 });
    assert.deepEqual(readDecision({ answers: { move: { choice: "cooperate" } } }), { move: "C", pCooperate: null });
    assert.throws(() => readDecision({ answers: { move: { choice: "maybe" } } }), /did not choose/);
    const request = decisionRequest({ rounds: 8, history: [] });
    assert.deepEqual(Object.keys(request.questions.move.criteria), ["cooperate", "defect"]);
    assert.equal(request.questions.move.type, "choice");
});

test("a text model's reply is read as one move, the first named, or rejected", () => {
    assert.equal(readMove("Defect.").move, "D");
    assert.equal(readMove("I will cooperate, not defect").move, "C");
    assert.throws(() => readMove("I refuse to play"), /not cooperate or defect/);
    assert.equal(chatMessages({ rounds: 3, history: [] })[0].role, "user");
});

test("tit for tat against always defect: cooperate once, then defect, with the right points", async () => {
    const rounds = await playMatch({
        a: base("tit-for-tat"),
        b: base("always-defect"),
        rounds: 4,
        play: () => assert.fail(),
    });
    assert.deepEqual(
        rounds.map((r) => r.a + r.b),
        ["CD", "DD", "DD", "DD"],
    );
    assert.deepEqual([rounds[0].pa, rounds[0].pb, rounds[1].pa, rounds[1].pb], [0, 5, 1, 1]);
});

test("models see their own history, move at the same time, and report their probability", async () => {
    const seen = [];
    const rounds = await playMatch({
        a: model("m"),
        b: base("always-defect"),
        rounds: 3,
        play: async (player, view) => {
            seen.push(view.history.map((h) => h.join("")).join(","));
            return { move: view.history.length ? "D" : "C", pCooperate: 0.9 };
        },
    });
    assert.deepEqual(seen, ["", "CD", "CD,DD"]);
    assert.deepEqual(
        rounds.map((r) => r.a + r.b),
        ["CD", "DD", "DD"],
    );
    assert.equal(rounds[0].pCoopA, 0.9);
    assert.equal(rounds[0].pCoopB, null);
});

test("schedule pairs every player once and skips two fixed strategies", () => {
    const players = [model("x"), base("tit-for-tat"), base("always-defect")];
    const matches = schedule(players);
    assert.equal(matches.length, 2);
    assert.ok(matches.every(({ a, b }) => a.kind !== "baseline" || b.kind !== "baseline"));
});

test("standings counts points, cooperation, exploitation, retaliation and failed matches", () => {
    const x = model("x");
    const d = base("always-defect");
    const rows = standings([
        {
            a: x,
            b: d,
            rounds: [
                { a: "C", b: "D", pa: 0, pb: 5 },
                { a: "D", b: "D", pa: 1, pb: 1 },
                { a: "C", b: "D", pa: 0, pb: 5 },
            ],
        },
        { a: x, b: model("y"), error: "boom" },
    ]);
    const mine = rows.find((r) => r.player.id === "x");
    assert.equal(mine.points, 1);
    assert.equal(mine.rounds, 3);
    assert.equal(mine.cooperated, 2);
    assert.equal(mine.openedNicely, 1);
    assert.equal(mine.afterBetrayal, 2);
    assert.equal(mine.retaliated, 1);
    assert.equal(mine.retaliationRate, 0.5);
    assert.equal(mine.failed, 1);
    const defector = rows.find((r) => r.player.id === "always-defect");
    assert.equal(defector.exploited, 2);
    assert.equal(rows[0].player.id, "always-defect", "best points per round first");
});

test("the price counts only the model moves", () => {
    const priced = { x: { pricing: { promptTextTokens: 1, completionTextTokens: 2 } } };
    assert.equal(moveCost(priced.x), 260 + 50);
    const matches = [
        { a: model("x"), b: base("tit-for-tat") },
        { a: model("x"), b: model("x") },
    ];
    assert.equal(tournamentCost(matches, 2, priced), 2 * 310 + 4 * 310);
});
