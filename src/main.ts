import { createApp } from "./app.js";
import { loadAppConfig } from "./configs/app.config.js";

const config = loadAppConfig();
const app = await createApp(config);
app.enableShutdownHooks();
await app.listen(config.port);
