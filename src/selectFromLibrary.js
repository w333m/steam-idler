/**
 * 
 * Handling of library by https://github.com/w333m
 */

const readline = require("readline");
const fs = require("fs");
const path = require("path");

const SAVE_FILE = path.join(__dirname, "..", "saved-selections.json");

function loadSaved() {
    try {
        return JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveSaved(data) {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2));
}

// Serialize prompts so multiple accounts don't overlap on stdin
let promptQueue = Promise.resolve();

/**
 * Fetches owned games for a bot and prompts the user to select which ones to idle.
 * @param {object} bot The Bot instance
 * @returns {Promise<Array>} Resolves with the selected appIDs (numbers)
 */
function selectFromLibrary(bot) {
    promptQueue = promptQueue.then(() => _prompt(bot));
    return promptQueue;
}

function _prompt(bot) {
    return new Promise((resolve) => {
        const accountName = bot.logOnOptions.accountName;

        bot.client.getUserOwnedApps(bot.client.steamID, { includePlayedFreeGames: true, includeFreeSub: false }, (err, res) => {
            if (err || !res || !res.apps || res.apps.length === 0) {
                logger("warn", `[${accountName}] Could not fetch library (${err ? err.message : "empty"}). Falling back to config games.`);
                return resolve(null);
            }

            // Sort alphabetically by name
            const apps = res.apps.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));

            const PAGE = 20;
            let page = 0;

            const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

            const done = (result) => {
                rl.close();
                process.stdin.resume(); // Prevent readline from closing stdin and killing the event loop
                resolve(result);
            };

            const printPage = () => {
                const start = page * PAGE;
                const slice = apps.slice(start, start + PAGE);
                const total = apps.length;

                logger("", `\n[${accountName}] Library (${total} games) — page ${page + 1}/${Math.ceil(total / PAGE)}:`, true);

                slice.forEach((app, i) => {
                    logger("", `  ${String(start + i + 1).padStart(4)}. [${app.appid}] ${app.name || "Unknown"}`, true);
                });

                const totalPages = Math.ceil(total / PAGE);
                const navHints = [];
                if (page > 0) navHints.push("'p' prev");
                if (page + 1 < totalPages) navHints.push("'n' next");
                navHints.push(`'g <num>' goto page`);
                navHints.push("'done' confirm");

                logger("", `\nEnter game numbers or appIDs (e.g. 1,3,5 or 730,440) — or navigate: ${navHints.join(" | ")}`, true);
            };

            const selected = new Set();

            const savedAll = loadSaved();
            const savedIds = savedAll[accountName];

            const startPrompt = (cb) => {
                if (!savedIds || savedIds.length === 0) {
                    printPage();
                    return cb();
                }

                const savedNames = savedIds.map(id => {
                    const app = apps.find(a => a.appid === id);
                    return app ? `${app.name} (${id})` : String(id);
                });
                logger("", `\n[${accountName}] Previous selection: ${savedNames.join(", ")}`, true);
                rl.question(`Load previous selection? (y/n) > `, (ans) => {
                    if (ans.trim().toLowerCase() === "y") {
                        savedIds.forEach(id => selected.add(id));
                        logger("info", `[${accountName}] Loaded ${selected.size} saved game(s).`);
                    }
                    printPage();
                    cb();
                });
            };

            const ask = () => {

                if (selected.size > 0) {
                    const names = [...selected].map(id => {
                        const app = apps.find(a => a.appid === id);
                        return app ? `${app.name} (${id})` : String(id);
                    });
                    logger("", `Currently selected: ${names.join(", ")}\n`, true);
                }

                rl.question("> ", (input) => {
                    input = input.trim().toLowerCase();

                    if (input === "n") {
                        const totalPages = Math.ceil(apps.length / PAGE);
                        if (page + 1 < totalPages) { page++; } else { logger("warn", `[${accountName}] Already on the last page.`, true); }
                        printPage();
                        return ask();
                    }

                    if (input === "p") {
                        if (page > 0) { page--; } else { logger("warn", `[${accountName}] Already on the first page.`, true); }
                        printPage();
                        return ask();
                    }

                    if (input.startsWith("g ")) {
                        const totalPages = Math.ceil(apps.length / PAGE);
                        const target = parseInt(input.slice(2).trim(), 10);
                        if (!isNaN(target) && target >= 1 && target <= totalPages) {
                            page = target - 1;
                            printPage();
                        } else {
                            logger("warn", `[${accountName}] Invalid page number. Enter a number between 1 and ${totalPages}.`, true);
                        }
                        return ask();
                    }

                    if (input === "done") {
                        if (selected.size === 0) {
                            logger("warn", `[${accountName}] No games selected. Falling back to config games.`);
                            return done(null);
                        }

                        const result = [...selected];
                        const allSaved = loadSaved();
                        allSaved[accountName] = result;
                        saveSaved(allSaved);
                        logger("info", `[${accountName}] Selected ${selected.size} game(s) to idle. Selection saved.`);
                        return done(result);
                    }

                    // Parse entries — could be list indices (1-based) or raw appIDs
                    const entries = input.split(",").map(s => s.trim()).filter(Boolean);

                    for (const entry of entries) {
                        const num = parseInt(entry, 10);
                        if (isNaN(num)) continue;

                        // Treat as 1-based index if within list length, otherwise as raw appID
                        if (num >= 1 && num <= apps.length) {
                            selected.add(apps[num - 1].appid);
                        } else {
                            // Check if it's a valid appID in the library
                            const byId = apps.find(a => a.appid === num);
                            if (byId) selected.add(byId.appid);
                            else logger("warn", `[${accountName}] '${num}' is not a valid index or owned appID, skipping.`, true);
                        }
                    }

                    ask();
                });
            };

            startPrompt(ask);
        });
    });
}

module.exports = selectFromLibrary;
