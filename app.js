import "dotenv/config";
import express from "express";
import nodeCleanup from "node-cleanup";
import routes from "./routes.js";
import { init, cleanup } from "./whatsapp.js";
import cors from "cors";

import { dirname } from "path";
import { fileURLToPath } from "url";
import path from "path"; // Importa el módulo 'path'

//login

// Routes
import "./login/src/database.js";
import usersRoutes from "./login/src/routes/auth.routes.js";
import authRoutes from "./login/src/routes/auth.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const host = process.env.HOST || undefined;
const port = parseInt(process.env.PORT ?? 8000);

app.use(express.static(path.join(__dirname, "public")));

// Configuración de la vista EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/api/users", usersRoutes);
app.use("/api/auth", authRoutes);
app.use("/", routes);

// Routes

const listenerCallback = () => {
    init();
    console.log(
        `Server is listening on http://${host ? host : "localhost"}:${port}`,
    );
};

if (host) {
    app.listen(port, host, listenerCallback);
} else {
    app.listen(port, listenerCallback);
}

nodeCleanup(cleanup);

export default app;
