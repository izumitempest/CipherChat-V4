import { io } from "socket.io-client";
// Exactly like the app: gateway origin with XTransformPort in the query.
const d = io("http://localhost:81/?XTransformPort=3003", {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 900,
  reconnectionDelayMax: 4000,
  timeout: 10000,
});
d.on("connect", () => {
  console.log("DIAG-G connected via gateway, transport:", d.io.engine.transport.name);
  d.emit("room:join", { roomId: "31J4ZRKG7Z", memberId: "DIAG-G", alias: "DiagG", colorIdx: 0 });
});
d.on("room:state", ({ members }) => console.log("DIAG-G room:state:", members.map((m) => m.alias).join(", ")));
d.onAny((ev, ...args) => { if (!["ping","pong","room:state"].includes(ev)) console.log("DIAG-G saw:", ev, JSON.stringify(args).slice(0, 140)); });
d.on("connect_error", (e) => console.log("connect_error:", e.message));
setTimeout(() => { console.log("DIAG-G done (90s)"); process.exit(0); }, 90000);
