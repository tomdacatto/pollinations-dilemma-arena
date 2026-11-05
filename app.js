import {
    CONCURRENCY,
    DEFAULT_BASELINES,
    DEFAULT_DECISION_MODELS,
    DEFAULT_ROUNDS,
    DEFAULT_TEXT_MODELS,
    ROUND_CHOICES,
} from "./config.js";
import {
    BASELINES,
    chatMessages,
    decisionRequest,
    playMatch,
    readDecision,
    readMove,
    schedule,
    standings,
    tournamentCost,
} from "./dilemma.js";
import { loadModels } from "./models.js";
import { chat, clearSession, completeSignIn, decide, getSession, startSignIn } from "./pollen.js";
import { $, checked, el, money, notice, pool, renderModels, renderSession, SIGN_IN_PROBLEMS } from "./ui.js";

const state = { models: [], matches: [], controller: null };
const short = (name) => name.split("/").pop();
const label = (player) => (player.kind === "baseline" ? BASELINES[player.id].title : short(player.id));

function players() {
    return [
        ...checked($("#decision")).map((id) => ({ id, kind: "decision" })),
        ...checked($("#text")).map((id) => ({ id, kind: "text" })),
        ...checked($("#baselines")).map((id) => ({ id, kind: "baseline" })),
    ];
}

function estimate() {
    const list = players();
    const matches = schedule(list);
    if (list.length < 2 || !matches.length) {
        $("#estimate").textContent = "Pick at least two players, and at least one of them a model.";
        return;
    }
    const rounds = Number($("#rounds").value);
    const byName = Object.fromEntries(state.models.map((m) => [m.name, m]));
    $("#estimate").textContent =
        `${matches.length} matches of ${rounds} rounds: about ${money(tournamentCost(matches, rounds, byName))} Pollen (a rough estimate).`;
}

function renderStandings() {
    const rows = standings(state.matches.filter((m) => m.done));
    $("#summary").hidden = !rows.length;
    const table = $("#table");
    table.replaceChildren();
    const head = el("tr");
    for (const title of ["Player", "Kind", "Points per round", "Cooperates", "Opens nicely", "Exploited", "Retaliates"])
        head.append(el("th", "", title));
    table.append(head);
    const percent = (v) => (v === null ? "" : `${Math.round(v * 100)}%`);
    for (const row of rows) {
        const tr = el("tr");
        const cells = [
            label(row.player),
            row.player.kind,
            row.perRound === null ? "" : row.perRound.toFixed(2),
            percent(row.cooperationRate),
            row.firstMoves ? `${row.openedNicely} of ${row.firstMoves}` : "",
            `${row.exploited} round${row.exploited === 1 ? "" : "s"}`,
            row.afterBetrayal ? `${row.retaliated} of ${row.afterBetrayal} (${percent(row.retaliationRate)})` : "",
        ];
        for (const cell of cells) tr.append(el("td", "", String(cell)));
        table.append(tr);
    }
}

function paintMatch(match) {
    const { head, grid, badge } = match.ui;
    grid.replaceChildren();
    const lines = [
        ["a", match.a, "pCoopA"],
        ["b", match.b, "pCoopB"],
    ];
    for (const [side, player, pKey] of lines) {
        const row = el("div", "strip");
        row.append(el("span", "name", label(player)));
        for (const round of match.rounds ?? []) {
            const cell = el("span", `move ${round[side] === "C" ? "coop" : "defect"}`, round[side]);
            if (round[pKey] !== null && round[pKey] !== undefined)
                cell.title = `${label(player)} gave cooperate ${Math.round(round[pKey] * 100)}%`;
            row.append(cell);
        }
        grid.append(row);
    }
    const total = (key) => (match.rounds ?? []).reduce((sum, r) => sum + r[key], 0);
    badge.className = `badge ${match.error ? "v-error" : ""}`;
    badge.textContent = match.error
        ? match.error
        : `${total("pa")} to ${total("pb")}${match.done ? "" : ` after ${match.rounds?.length ?? 0} rounds`}`;
    head.textContent = `${label(match.a)} vs ${label(match.b)}`;
}

function addMatch(pair) {
    const node = el("article", "call");
    const head = el("h3");
    const badge = el("span", "badge");
    const grid = el("div", "strips");
    node.append(head, badge, grid);
    $("#matches").append(node);
    return { ...pair, rounds: [], ui: { head, grid, badge } };
}

async function run() {
    if (!getSession()) return startSignIn();
    const list = schedule(players());
    if (!list.length) return notice("Pick at least two players, and at least one of them a model.", "error");
    const rounds = Number($("#rounds").value);
    $("#matches").replaceChildren();
    notice(null);
    state.controller = new AbortController();
    const { signal } = state.controller;
    $("#run").disabled = true;
    $("#stop").hidden = false;
    let done = 0;
    const progress = () => ($("#progress").textContent = `${done} of ${list.length} matches finished`);
    progress();
    state.matches = list.map(addMatch);
    // A model move: a decision model gets a typed question, a text model gets the game and answers in a word.
    const play = async (player, view) => {
        if (player.kind === "decision") return readDecision(await decide(player.id, decisionRequest(view), { signal }));
        return readMove(await chat(player.id, chatMessages(view), { signal, seed: Math.floor(Math.random() * 1e9) }));
    };
    await pool(
        state.matches,
        CONCURRENCY,
        async (match) => {
            try {
                match.rounds = await playMatch({
                    a: match.a,
                    b: match.b,
                    rounds,
                    play,
                    onRound: (rows) => {
                        match.rounds = [...rows];
                        paintMatch(match);
                    },
                });
            } catch (error) {
                if (signal.aborted) return;
                match.error = error.message;
                if (/sign-in expired|Out of Pollen/.test(error.message)) state.controller.abort();
            }
            match.done = true;
            done++;
            progress();
            paintMatch(match);
            renderStandings();
        },
        signal,
    );
    $("#run").disabled = false;
    $("#stop").hidden = true;
    const firstError = state.matches.find((m) => m.error)?.error;
    if (firstError) notice(`Some matches failed. The first error: ${firstError}`, "error");
    renderSession();
}

// Start.
$("#sign-in").onclick = () => startSignIn();
$("#sign-out").onclick = () => {
    clearSession();
    renderSession();
};
$("#run").onclick = run;
$("#stop").onclick = () => state.controller?.abort();
for (const n of ROUND_CHOICES)
    $("#rounds").append(Object.assign(el("option", "", String(n)), { value: n, selected: n === DEFAULT_ROUNDS }));
$("#rounds").onchange = estimate;
const strategies = Object.entries(BASELINES).map(([name, { title }]) => ({
    name,
    title,
    pricing: { completionTextTokens: 0 },
}));
$("#baselines").replaceChildren(
    ...strategies.map(({ name, title }) => {
        const label2 = el("label");
        label2.append(
            Object.assign(document.createElement("input"), {
                type: "checkbox",
                value: name,
                checked: DEFAULT_BASELINES.includes(name),
                onchange: estimate,
            }),
            el("span", "", title),
        );
        return label2;
    }),
);

const outcome = completeSignIn();
if (outcome && outcome !== "ok") notice(SIGN_IN_PROBLEMS[outcome], "error");
renderSession();
loadModels()
    .then((models) => {
        state.models = models;
        renderModels(
            $("#decision"),
            models.filter((m) => m.decision),
            DEFAULT_DECISION_MODELS,
            estimate,
        );
        renderModels(
            $("#text"),
            models.filter((m) => !m.decision),
            DEFAULT_TEXT_MODELS,
            estimate,
        );
        estimate();
    })
    .catch((error) => notice(`Could not load the model list: ${error.message}`, "error"));
