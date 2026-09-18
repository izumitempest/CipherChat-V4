import { io } from "socket.io-client";
const d = io("http://localhost:3003/", { transports: ["websocket"] });
const roomId = "31J4ZRKG7Z";
d.on("connect", () => {
  d.emit("room:join", { roomId, memberId: "DIAG-observer", alias: "Diag", colorIdx: 0 });
  console.log("DIAG ready");
});
d.onAny((ev, ...args) => { if (!["ping","pong"].includes(ev)) console.log("DIAG saw:", ev, JSON.stringify(args).slice(0, 200)); });
setTimeout(() => { console.log("DIAG done"); process.exit(0); }, 240000);
