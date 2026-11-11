import { sb } from "./supa.js";
import { initAuth } from "./auth.js";
import { createSample, downloads, IMG_MAX } from "./ai.js";
import { createCollection } from "./db.js";
import { startFaislaDesk } from "./app.js";

initAuth(sb, ({ profile, team, teamApi }) => {
  startFaislaDesk({
    sample: createSample(sb),
    col: createCollection(sb, team.id),
    downloads,
    profile,
    team,
    teamApi,
    imgMax: IMG_MAX,
  });
});

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Service worker:", e)));
}
